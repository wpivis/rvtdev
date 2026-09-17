import { renderHook, act, waitFor } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { useLsl, useLslTrialMarkers, LslState } from '../useLsl';
import { useStudyConfig } from '../useStudyConfig';
import { useIsAnalysis } from '../useIsAnalysis';
import { useStoreSelector } from '../../store';

vi.mock('../useStudyConfig', () => ({ useStudyConfig: vi.fn() }));
vi.mock('../useIsAnalysis', () => ({ useIsAnalysis: vi.fn(() => false) }));
vi.mock('../../store', () => ({ useStoreSelector: vi.fn() }));

const useStudyConfigMock = vi.mocked(useStudyConfig);
const useIsAnalysisMock = vi.mocked(useIsAnalysis);
const useStoreSelectorMock = vi.mocked(useStoreSelector);

/** Minimal stand-in for the browser WebSocket, so tests can drive the socket. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  static CONNECTING = 0;

  static OPEN = 1;

  static CLOSED = 3;

  url: string;

  readyState = FakeWebSocket.CONNECTING;

  sent: string[] = [];

  closed = false;

  onopen: (() => void) | null = null;

  onmessage: ((e: { data: string }) => void) | null = null;

  onerror: (() => void) | null = null;

  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) { this.sent.push(data); }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }

  get parsedSent() { return this.sent.map((s) => JSON.parse(s)); }

  static latest() { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]; }
}

const withBridge = (overrides: Record<string, unknown> = {}) => ({
  uiConfig: { lslBridge: { enabled: true, ...overrides } },
});

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  useIsAnalysisMock.mockReturnValue(false);
  // The hook selects studyId and participantId separately, so run the real
  // selector against a fake slice rather than returning one fixed value.
  useStoreSelectorMock.mockImplementation(((
    selector: (s: { studyId: string; participantId: string }) => unknown,
  ) => selector({ studyId: 'demo', participantId: 'p001' })) as never);
  useStudyConfigMock.mockReturnValue(withBridge() as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useLsl connection', () => {
  test('opens no socket when the study does not configure a bridge', () => {
    useStudyConfigMock.mockReturnValue({ uiConfig: {} } as never);
    const { result } = renderHook(() => useLsl());
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.enabled).toBe(false);
  });

  test('opens no socket in analysis mode, where there is no live sensor', () => {
    useIsAnalysisMock.mockReturnValue(true);
    const { result } = renderHook(() => useLsl());
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.enabled).toBe(false);
  });

  test('connects to the configured host and port', () => {
    useStudyConfigMock.mockReturnValue(withBridge({ host: '127.0.0.1', port: 9999 }) as never);
    renderHook(() => useLsl());
    expect(FakeWebSocket.latest().url).toBe('ws://127.0.0.1:9999');
  });

  test('identifies the session to the bridge on open', () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    expect(result.current.bridgeConnected).toBe(true);
    expect(FakeWebSocket.latest().parsedSent[0]).toMatchObject({
      type: 'hello', studyId: 'demo', participantId: 'p001',
    });
  });

  test('drops the socket on unmount without leaving it open', () => {
    const { unmount } = renderHook(() => useLsl());
    const ws = FakeWebSocket.latest();
    act(() => { ws.open(); });
    unmount();
    expect(ws.closed).toBe(true);
  });

  test('unmount does not schedule a reconnect', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    unmount();
    const countAtUnmount = FakeWebSocket.instances.length;
    act(() => { vi.advanceTimersByTime(60_000); });
    // A closing socket must not resurrect the connection after teardown.
    expect(FakeWebSocket.instances).toHaveLength(countAtUnmount);
  });

  test('reconnects with backoff after the bridge goes away', () => {
    vi.useFakeTimers();
    renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => { FakeWebSocket.latest().close(); });
    act(() => { vi.advanceTimersByTime(499); });
    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second failure waits longer than the first.
    act(() => { FakeWebSocket.latest().close(); });
    act(() => { vi.advanceTimersByTime(999); });
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(FakeWebSocket.instances).toHaveLength(3);
  });
});

describe('useLsl messages', () => {
  test('exposes bridge status', async () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => {
      FakeWebSocket.latest().emit({
        type: 'status', connected: true, healthy: true, streamName: 'SimNIRS', gaps: 0,
      });
    });
    await waitFor(() => expect(result.current.status?.streamName).toBe('SimNIRS'));
    expect(result.current.status?.healthy).toBe(true);
  });

  test('collects windows keyed by task', async () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => {
      FakeWebSocket.latest().emit({
        type: 'window', task: 'barChart_2', times: [0], values: [[1]],
      });
      FakeWebSocket.latest().emit({
        type: 'window', task: 'scatter_3', times: [0], values: [[2]],
      });
    });
    await waitFor(() => expect(Object.keys(result.current.windows)).toHaveLength(2));
    expect(result.current.windows.barChart_2.task).toBe('barChart_2');
  });

  test('surfaces bridge warnings and ignores malformed frames', async () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => { FakeWebSocket.latest().onmessage?.({ data: 'not json' }); });
    expect(result.current.error).toBeNull();
    act(() => { FakeWebSocket.latest().emit({ type: 'warning', message: 'no sensor data' }); });
    await waitFor(() => expect(result.current.error).toBe('no sensor data'));
  });

  test('markers carry the task and are stamped for reference', () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => { result.current.sendMarker('trialStart', 'barChart_2'); });
    const marker = FakeWebSocket.latest().parsedSent.at(-1);
    expect(marker).toMatchObject({ type: 'marker', event: 'trialStart', task: 'barChart_2' });
    expect(typeof marker.browserTime).toBe('number');
  });

  test('a stopped trial is owed a window until one arrives', async () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });

    act(() => { result.current.sendMarker('trialStop', 'barChart_2'); });
    await waitFor(() => expect(result.current.pendingWindows).toEqual(['barChart_2']));

    act(() => {
      FakeWebSocket.latest().emit({
        type: 'window', task: 'barChart_2', times: [0], values: [[1]],
      });
    });
    await waitFor(() => expect(result.current.pendingWindows).toEqual([]));
  });

  test('several outstanding trials are tracked independently', async () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => {
      result.current.sendMarker('trialStop', 'a_1');
      result.current.sendMarker('trialStop', 'b_2');
    });
    await waitFor(() => expect(result.current.pendingWindows).toEqual(['a_1', 'b_2']));
    act(() => {
      FakeWebSocket.latest().emit({
        type: 'window', task: 'b_2', times: [0], values: [[1]],
      });
    });
    // Windows arrive a lead-out after their task, so out-of-order is normal.
    await waitFor(() => expect(result.current.pendingWindows).toEqual(['a_1']));
  });

  test('a trialStart does not create a pending window', () => {
    const { result } = renderHook(() => useLsl());
    act(() => { FakeWebSocket.latest().open(); });
    act(() => { result.current.sendMarker('trialStart', 'barChart_2'); });
    expect(result.current.pendingWindows).toEqual([]);
  });

  test('sending before the socket opens does not throw', () => {
    const { result } = renderHook(() => useLsl());
    expect(() => act(() => { result.current.sendMarker('trialStart', 'x'); })).not.toThrow();
    expect(FakeWebSocket.latest().sent).toHaveLength(0);
  });
});

describe('useLslTrialMarkers', () => {
  const makeLsl = (overrides: Partial<LslState> = {}): LslState => ({
    enabled: true,
    pendingWindows: [],
    bridgeConnected: true,
    status: null,
    windows: {},
    error: null,
    sendMarker: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    ...overrides,
  });

  test('opens a trial when the identifier appears', () => {
    const lsl = makeLsl();
    renderHook(({ id }) => useLslTrialMarkers(lsl, id), { initialProps: { id: 'intro_0' } });
    expect(lsl.sendMarker).toHaveBeenCalledWith('trialStart', 'intro_0');
  });

  test('closes the previous trial before opening the next', () => {
    const lsl = makeLsl();
    const { rerender } = renderHook(
      ({ id }) => useLslTrialMarkers(lsl, id),
      { initialProps: { id: 'intro_0' } },
    );
    rerender({ id: 'task_1' });
    expect(vi.mocked(lsl.sendMarker).mock.calls).toEqual([
      ['trialStart', 'intro_0'],
      ['trialStop', 'intro_0'],
      ['trialStart', 'task_1'],
    ]);
  });

  test('a re-render on the same trial does not emit a duplicate start', () => {
    const lsl = makeLsl();
    const { rerender } = renderHook(
      ({ id }) => useLslTrialMarkers(lsl, id),
      { initialProps: { id: 'intro_0' } },
    );
    rerender({ id: 'intro_0' });
    rerender({ id: 'intro_0' });
    expect(vi.mocked(lsl.sendMarker)).toHaveBeenCalledTimes(1);
  });

  test('closes the open trial on unmount, so the last window is still cut', () => {
    const lsl = makeLsl();
    const { unmount } = renderHook(
      ({ id }) => useLslTrialMarkers(lsl, id),
      { initialProps: { id: 'task_1' } },
    );
    unmount();
    expect(vi.mocked(lsl.sendMarker).mock.calls.at(-1)).toEqual(['trialStop', 'task_1']);
  });

  test('emits nothing while the bridge is unreachable', () => {
    const lsl = makeLsl({ bridgeConnected: false });
    renderHook(() => useLslTrialMarkers(lsl, 'intro_0'));
    expect(lsl.sendMarker).not.toHaveBeenCalled();
  });

  test('emits nothing when the bridge is not enabled', () => {
    const lsl = makeLsl({ enabled: false });
    renderHook(() => useLslTrialMarkers(lsl, 'intro_0'));
    expect(lsl.sendMarker).not.toHaveBeenCalled();
  });
});
