import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useParams } from 'react-router';
import { useStudyConfig } from './useStudyConfig';
import { useIsAnalysis } from './useIsAnalysis';
import { useStoreSelector } from '../store';

/**
 * Connection to a local Lab Streaming Layer bridge.
 *
 * Browsers cannot speak LSL, so a helper process on the participant machine
 * translates between this WebSocket and the LSL network. reVISit sends trial
 * lifecycle markers out and receives connection health plus a per-task trace
 * back. See tools/lsl-bridge in this repository.
 */

/** Health of the bridge and the sensor stream behind it, as reported once per second. */
export interface LslStatus {
  connected: boolean;
  streamName: string | null;
  channels: number | null;
  channelLabels: string[] | null;
  /** Channel indices grouped by chromophore, resolved from labels by the bridge. */
  chromophores: Record<string, number[]> | null;
  nominalRate: number | null;
  effectiveRate: number | null;
  secondsSinceSample: number | null;
  gaps: number;
  bufferedSeconds: number;
  timeCorrection: number | null;
  labRecorder: { available: boolean; recording: boolean; error: string | null } | null;
  /**
   * Whether the pipe is intact: inlet attached, samples arriving, observed rate
   * near nominal. This is NOT signal quality — optode coupling and saturation
   * are judged by the vendor's acquisition software and are invisible here.
   */
  healthy: boolean;
}

/** A per-task slice of the sensor stream, widened past the task bounds. */
export interface LslWindow {
  task: string;
  /** Seconds relative to task onset; negative values are the lead-in. */
  times: number[];
  /** One array per channel, parallel to `times`. */
  values: number[][];
  channelLabels: string[];
  chromophores: Record<string, number[]>;
  taskStart: number;
  taskEnd: number;
  leadIn: number;
  leadOut: number;
  truncatedStart: boolean;
  truncatedEnd: boolean;
  streamName: string;
  nominalRate: number;
  /** Declared by the bridge so the analysis view can label the trace honestly. */
  processing: string;
}

export interface LslState {
  /** Whether the study config asks for a bridge at all. */
  enabled: boolean;
  /** Whether the WebSocket to the bridge is open. */
  bridgeConnected: boolean;
  status: LslStatus | null;
  /** Windows received so far, keyed by task identifier. */
  windows: Record<string, LslWindow>;
  /** Last transport-level error, for the setup page. */
  error: string | null;
  sendMarker: (event: string, task: string, detail?: unknown) => void;
  startRecording: () => void;
  stopRecording: () => void;
}

const EMPTY_STATE: LslState = {
  enabled: false,
  bridgeConnected: false,
  status: null,
  windows: {},
  error: null,
  sendMarker: () => {},
  startRecording: () => {},
  stopRecording: () => {},
};

export const LslContext = createContext<LslState>(EMPTY_STATE);

export function useLslContext(): LslState {
  return useContext(LslContext);
}

// Reconnect backoff. The bridge is a process a human starts, so a study can
// outlive a restart of it; we keep retrying rather than failing the session.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export function useLsl(): LslState {
  const studyConfig = useStudyConfig();
  const isAnalysis = useIsAnalysis();
  const { studyId } = useParams();
  const participantId = useStoreSelector((state) => state.participantId);

  const config = studyConfig?.uiConfig?.lslBridge;
  // Never open a socket while reviewing data: analysis has no live sensor.
  const enabled = useMemo(() => !!config?.enabled && !isAnalysis, [config, isAnalysis]);
  const url = useMemo(
    () => `ws://${config?.host ?? '127.0.0.1'}:${config?.port ?? 8765}`,
    [config],
  );

  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [status, setStatus] = useState<LslStatus | null>(null);
  const [windows, setWindows] = useState<Record<string, LslWindow>>({});
  const [error, setError] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  // Guards every state write, so a socket event that lands after teardown is dropped.
  const mounted = useRef(true);

  // Identity is read at send time rather than captured, so a participant id that
  // arrives after the socket opens still reaches the bridge.
  const identity = useRef({ studyId, participantId });
  identity.current = { studyId, participantId };

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;

    if (!enabled) {
      return () => { mounted.current = false; };
    }

    const clearReconnect = () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    const connect = () => {
      if (!mounted.current) {
        return;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        // Construction throws on a malformed URL; retrying will not fix that.
        if (mounted.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      socket.current = ws;

      ws.onopen = () => {
        if (!mounted.current) {
          return;
        }
        attempts.current = 0;
        setBridgeConnected(true);
        setError(null);
        send({
          type: 'hello',
          studyId: identity.current.studyId ?? 'study',
          participantId: identity.current.participantId ?? 'unknown',
        });
      };

      ws.onmessage = (event) => {
        if (!mounted.current) {
          return;
        }
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'status' || msg.type === 'hello') {
          setStatus(msg as unknown as LslStatus);
        } else if (msg.type === 'window') {
          const win = msg as unknown as LslWindow;
          setWindows((prev) => ({ ...prev, [win.task]: win }));
        } else if (msg.type === 'error' || msg.type === 'warning') {
          setError(typeof msg.message === 'string' ? msg.message : 'bridge reported a problem');
        }
      };

      ws.onerror = () => {
        if (mounted.current) {
          setError(`could not reach the LSL bridge at ${url}`);
        }
      };

      ws.onclose = () => {
        socket.current = null;
        if (!mounted.current) {
          return;
        }
        setBridgeConnected(false);
        setStatus(null);
        attempts.current += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts.current - 1), RECONNECT_MAX_MS);
        clearReconnect();
        reconnectTimer.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      mounted.current = false;
      clearReconnect();
      const ws = socket.current;
      socket.current = null;
      if (ws) {
        // Drop handlers before closing so the close event cannot schedule a reconnect.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    };
  }, [enabled, url, send]);

  const sendMarker = useCallback((event: string, task: string, detail?: unknown) => {
    // browserTime is recorded for reference only. The bridge applies the LSL
    // timestamp on arrival, because the browser's epoch clock is not LSL's.
    send({
      type: 'marker', event, task, detail, browserTime: Date.now(),
    });
  }, [send]);

  const startRecording = useCallback(() => send({ type: 'startRecording' }), [send]);
  const stopRecording = useCallback(() => send({ type: 'stopRecording' }), [send]);

  return useMemo(() => ({
    enabled,
    bridgeConnected,
    status,
    windows,
    error,
    sendMarker,
    startRecording,
    stopRecording,
  }), [enabled, bridgeConnected, status, windows, error, sendMarker, startRecording, stopRecording]);
}

/**
 * Emits trial lifecycle markers as the participant moves through the sequence.
 *
 * Driven by the current identifier rather than by the next-step handler, so a
 * trial is bounded the same way however it was left — next, previous, or a jump
 * from the study browser.
 */
export function useLslTrialMarkers(lsl: LslState, identifier: string | undefined): void {
  // The trial we have an open trialStart for, so a reconnect or an unrelated
  // re-render cannot emit a duplicate start for the same trial.
  const openTrial = useRef<string | null>(null);
  const { enabled, bridgeConnected, sendMarker } = lsl;

  useEffect(() => {
    if (!enabled || !bridgeConnected || !identifier) {
      return;
    }
    if (openTrial.current === identifier) {
      return;
    }
    if (openTrial.current) {
      sendMarker('trialStop', openTrial.current);
    }
    sendMarker('trialStart', identifier);
    openTrial.current = identifier;
  }, [enabled, bridgeConnected, identifier, sendMarker]);

  useEffect(() => {
    // Close the final trial on teardown, so the last window is still cut.
    if (!enabled) {
      return undefined;
    }
    return () => {
      if (openTrial.current) {
        sendMarker('trialStop', openTrial.current);
        openTrial.current = null;
      }
    };
  }, [enabled, sendMarker]);
}
