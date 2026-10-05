// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { act } from 'react';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
  useMidi, type MidiControlChangeMessage, type MidiNoteMessage, type UseMidiOptions,
} from '../useMidi';

/**
 * A synthetic MIDI input port.
 *
 * Real instruments cannot be attached to a test runner, so this stands in for
 * `MIDIInput`. It is a genuine `EventTarget`, which matters: the hook subscribes
 * with `addEventListener` rather than by assigning `onmidimessage`, so that
 * reVISit's study-wide capture and a stimulus can both receive from one port.
 * Everything above the Web MIDI boundary is the production code path.
 */
class FakeMidiInput extends EventTarget {
  id: string;

  name: string;

  manufacturer = 'Loog';

  type = 'input';

  version = '1.0';

  state = 'connected';

  connection = 'closed';

  openCalls = 0;

  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }

  open() {
    this.openCalls += 1;
    this.connection = 'open';
    return Promise.resolve(this as unknown as MIDIInput);
  }

  close() {
    this.connection = 'closed';
    return Promise.resolve(this as unknown as MIDIInput);
  }

  /** Delivers a raw MIDI message, as the browser would. */
  send(bytes: number[], timeStamp = 1000) {
    const event = new Event('midimessage') as Event & { data: Uint8Array };
    event.data = new Uint8Array(bytes);
    // `Event.timeStamp` is read-only, so override it on this instance.
    Object.defineProperty(event, 'timeStamp', { value: timeStamp, configurable: true });
    act(() => {
      this.dispatchEvent(event);
    });
  }
}

class FakeMidiAccess extends EventTarget {
  sysexEnabled = false;

  inputs: { forEach: (callback: (input: MIDIInput, key: string) => void) => void };

  outputs = { forEach: () => undefined };

  onstatechange = null;

  private ports: FakeMidiInput[];

  constructor(ports: FakeMidiInput[]) {
    super();
    this.ports = ports;
    this.inputs = {
      forEach: (callback) => {
        this.ports.forEach((port) => callback(port as unknown as MIDIInput, port.id));
      },
    };
  }

  setPorts(ports: FakeMidiInput[]) {
    this.ports = ports;
    act(() => {
      this.dispatchEvent(new Event('statechange'));
    });
  }
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
/** Note-on on channel 3: the low nibble of the status byte is the channel. */
const NOTE_ON_CHANNEL_3 = 0x92;
const SUSTAIN_PEDAL = 64;

// React needs this to accept the bare `act()` calls the fake port dispatches from.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness(props: UseMidiOptions) {
  useMidi(props);
  return null;
}

let piano: FakeMidiInput;
let access: FakeMidiAccess;
let requestCalls: MIDIOptions[];

/** Resolves the pending `requestMIDIAccess` promise and flushes React updates. */
async function grantAccess() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useMidi', () => {
  beforeEach(() => {
    piano = new FakeMidiInput('port-1', 'Loog Piano');
    access = new FakeMidiAccess([piano]);
    requestCalls = [];

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: (options: MIDIOptions = {}) => {
        requestCalls.push(options);
        return Promise.resolve(access as unknown as MIDIAccess);
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'requestMIDIAccess');
  });

  test('reports the instrument once access is granted, and opens the port', async () => {
    const onDeviceChange = vi.fn();
    render(<Harness onDeviceChange={onDeviceChange} autoRequest />);

    await grantAccess();

    expect(onDeviceChange).toHaveBeenCalledTimes(1);
    const devices = onDeviceChange.mock.calls[0][0];
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('Loog Piano');
    expect(devices[0].state).toBe('connected');
    // Opened explicitly rather than relying on the implicit open that assigning
    // `onmidimessage` performs.
    expect(piano.openCalls).toBe(1);
  });

  test('does not request access at all until asked', async () => {
    render(<Harness onNoteOn={vi.fn()} />);
    await grantAccess();

    expect(requestCalls).toHaveLength(0);
  });

  test('never asks for sysex, which would turn a silent grant into a prompt', async () => {
    render(<Harness autoRequest />);
    await grantAccess();

    expect(requestCalls).toEqual([{ sysex: false }]);
  });

  test('delivers a note-on with its note, velocity, channel and own timestamp', async () => {
    const onNoteOn = vi.fn();
    render(<Harness onNoteOn={onNoteOn} autoRequest />);
    await grantAccess();

    // Middle C, hard, on channel 3.
    piano.send([NOTE_ON_CHANNEL_3, 60, 118], 4242.75);

    expect(onNoteOn).toHaveBeenCalledTimes(1);
    const message = onNoteOn.mock.calls[0][0] as MidiNoteMessage;
    expect(message.note).toBe(60);
    expect(message.velocity).toBe(118);
    expect(message.channel).toBe(2);
    // The fractional part survives: this timestamp came from the message, not
    // from a polling loop quantised to an animation frame.
    expect(message.timeStamp).toBe(4242.75);
    expect(message.epochMs).toBe(Math.round(performance.timeOrigin + 4242.75));
  });

  test('a note-on with velocity 0 is treated as a note-off', async () => {
    const onNoteOn = vi.fn();
    const onNoteOff = vi.fn();
    render(<Harness onNoteOn={onNoteOn} onNoteOff={onNoteOff} autoRequest />);
    await grantAccess();

    piano.send([NOTE_ON, 64, 90]);
    piano.send([NOTE_ON, 64, 0]);

    expect(onNoteOn).toHaveBeenCalledTimes(1);
    expect(onNoteOff).toHaveBeenCalledTimes(1);
    expect((onNoteOff.mock.calls[0][0] as MidiNoteMessage).note).toBe(64);
  });

  test('an explicit note-off is reported with its release velocity', async () => {
    const onNoteOff = vi.fn();
    render(<Harness onNoteOff={onNoteOff} autoRequest />);
    await grantAccess();

    piano.send([NOTE_OFF, 67, 12]);

    expect(onNoteOff).toHaveBeenCalledTimes(1);
    const message = onNoteOff.mock.calls[0][0] as MidiNoteMessage;
    expect(message.note).toBe(67);
    expect(message.velocity).toBe(12);
  });

  test('reports control changes such as the sustain pedal', async () => {
    const onControlChange = vi.fn();
    render(<Harness onControlChange={onControlChange} autoRequest />);
    await grantAccess();

    piano.send([CONTROL_CHANGE, SUSTAIN_PEDAL, 127]);
    piano.send([CONTROL_CHANGE, SUSTAIN_PEDAL, 0]);

    expect(onControlChange).toHaveBeenCalledTimes(2);
    const first = onControlChange.mock.calls[0][0] as MidiControlChangeMessage;
    expect(first.controller).toBe(SUSTAIN_PEDAL);
    expect(first.value).toBe(127);
    expect((onControlChange.mock.calls[1][0] as MidiControlChangeMessage).value).toBe(0);
  });

  test('ignores messages that are too short to parse', async () => {
    const onNoteOn = vi.fn();
    const onControlChange = vi.fn();
    render(<Harness onNoteOn={onNoteOn} onControlChange={onControlChange} autoRequest />);
    await grantAccess();

    // A lone active-sensing byte, which real hardware emits constantly.
    piano.send([0xfe]);

    expect(onNoteOn).not.toHaveBeenCalled();
    expect(onControlChange).not.toHaveBeenCalled();
  });

  test('two consumers of the same port both receive every note', async () => {
    const capture = vi.fn();
    const stimulus = vi.fn();
    render(
      <>
        <Harness onNoteOn={capture} autoRequest />
        <Harness onNoteOn={stimulus} autoRequest />
      </>,
    );
    await grantAccess();

    piano.send([NOTE_ON, 72, 64]);

    // Assigning `input.onmidimessage` -- the form every Web MIDI example shows --
    // would let the second subscriber silently clobber the first, breaking
    // reVISit's two-layer capture. addEventListener is what makes this pass.
    expect(capture).toHaveBeenCalledTimes(1);
    expect(stimulus).toHaveBeenCalledTimes(1);
  });

  test('picks up an instrument plugged in after access was granted', async () => {
    const onDeviceChange = vi.fn();
    const onNoteOn = vi.fn();
    access = new FakeMidiAccess([]);
    render(<Harness onDeviceChange={onDeviceChange} onNoteOn={onNoteOn} autoRequest />);
    await grantAccess();

    expect(onDeviceChange).toHaveBeenLastCalledWith([], expect.any(Number));

    access.setPorts([piano]);
    expect(onDeviceChange).toHaveBeenLastCalledWith(
      [expect.objectContaining({ name: 'Loog Piano' })],
      expect.any(Number),
    );

    piano.send([NOTE_ON, 60, 80]);
    expect(onNoteOn).toHaveBeenCalledTimes(1);
  });

  test('detaches from a port that goes away, and stops reporting it', async () => {
    const onDeviceChange = vi.fn();
    const onNoteOn = vi.fn();
    render(<Harness onDeviceChange={onDeviceChange} onNoteOn={onNoteOn} autoRequest />);
    await grantAccess();

    access.setPorts([]);
    expect(onDeviceChange).toHaveBeenLastCalledWith([], expect.any(Number));

    // A message from the detached port must not reach the handlers.
    piano.send([NOTE_ON, 60, 80]);
    expect(onNoteOn).not.toHaveBeenCalled();
  });

  test('does nothing at all when disabled', async () => {
    const onNoteOn = vi.fn();
    const onDeviceChange = vi.fn();
    render(<Harness onNoteOn={onNoteOn} onDeviceChange={onDeviceChange} autoRequest enabled={false} />);
    await grantAccess();

    piano.send([NOTE_ON, 60, 80]);

    expect(requestCalls).toHaveLength(0);
    expect(onDeviceChange).not.toHaveBeenCalled();
    expect(onNoteOn).not.toHaveBeenCalled();
  });

  test('unsubscribes on unmount', async () => {
    const onNoteOn = vi.fn();
    const { unmount } = render(<Harness onNoteOn={onNoteOn} autoRequest />);
    await grantAccess();

    piano.send([NOTE_ON, 60, 80]);
    expect(onNoteOn).toHaveBeenCalledTimes(1);

    unmount();
    piano.send([NOTE_ON, 62, 80]);
    expect(onNoteOn).toHaveBeenCalledTimes(1);
  });

  test('reports an unsupported browser instead of throwing', async () => {
    Reflect.deleteProperty(navigator, 'requestMIDIAccess');

    let result: ReturnType<typeof useMidi> | null = null;
    function Probe() {
      result = useMidi({ autoRequest: true });
      return null;
    }
    render(<Probe />);
    await grantAccess();

    // This is the Safari path, on every version and platform.
    expect(result!.supported).toBe(false);
    expect(result!.status).toBe('unsupported');
    expect(result!.devices).toEqual([]);
  });

  test('surfaces a refused request', async () => {
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: () => Promise.reject(new DOMException('denied', 'SecurityError')),
      configurable: true,
      writable: true,
    });

    let result: ReturnType<typeof useMidi> | null = null;
    function Probe() {
      result = useMidi({ autoRequest: true });
      return null;
    }
    render(<Probe />);
    await grantAccess();

    expect(result!.status).toBe('denied');
    expect(result!.error).toBe('SecurityError');
  });
});
