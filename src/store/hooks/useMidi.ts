import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';

/** Identifying information for one MIDI input port. */
export interface MidiDevice {
  /** Stable per-origin port id. Not a hardware serial number. */
  id: string;
  /** Device name as the OS reports it, e.g. "Loog Piano". */
  name: string;
  manufacturer: string;
  /** `"connected"` or `"disconnected"`. */
  state: string;
  /** `"open"`, `"pending"` or `"closed"` -- whether this page is receiving from it. */
  connection: string;
}

/** A note-on or note-off message. */
export interface MidiNoteMessage {
  /** MIDI note number, 0-127. 60 is C4. */
  note: number;
  /**
   * 0-127. For a note-on this is how hard the key was struck. For a note-off it
   * is release velocity, which most keyboards report as 0.
   */
  velocity: number;
  /** MIDI channel, 0-15. */
  channel: number;
  /**
   * The message's own timestamp, on the same clock as `performance.now()`.
   *
   * This is the interesting field. It comes from the MIDI stack rather than from
   * when JavaScript got around to looking, so it is not quantised to the display
   * refresh the way a polled input's timestamps are.
   */
  timeStamp: number;
  /** The same instant in epoch milliseconds, for `windowEvents`. */
  epochMs: number;
  /** The port the message arrived on. */
  device: MidiDevice;
}

/** A control-change message: pedals, mod wheel, knobs. */
export interface MidiControlChangeMessage {
  /** Controller number, 0-127. 64 is the sustain pedal. */
  controller: number;
  /** Controller value, 0-127. */
  value: number;
  channel: number;
  timeStamp: number;
  epochMs: number;
  device: MidiDevice;
}

export type MidiStatus =
  /** `navigator.requestMIDIAccess` does not exist in this browser. */
  | 'unsupported'
  /** Supported, but access has not been requested yet. */
  | 'idle'
  | 'requesting'
  | 'granted'
  /** The request was refused, either by the participant or by policy. */
  | 'denied';

export interface UseMidiOptions {
  /** Fires for every note-on with a non-zero velocity. */
  onNoteOn?: (message: MidiNoteMessage) => void;
  /**
   * Fires for every note-off, including the note-on-with-velocity-0 form that
   * many keyboards send instead.
   */
  onNoteOff?: (message: MidiNoteMessage) => void;
  /** Fires for every control-change message. */
  onControlChange?: (message: MidiControlChangeMessage) => void;
  /** Fires whenever the set of input ports changes, with the full current list. */
  onDeviceChange?: (devices: MidiDevice[], epochMs: number) => void;
  /**
   * Request access as soon as the hook is enabled, instead of waiting for
   * {@link UseMidiResult.requestAccess}. Chrome grants non-sysex access without
   * a prompt, so this is safe mid-study, but a study is still better off doing
   * it on a setup page where a prompt would not interrupt a task.
   */
  autoRequest?: boolean;
  /** Set false to detach from every port. Defaults to true. */
  enabled?: boolean;
}

export interface UseMidiResult {
  status: MidiStatus;
  /** True when `navigator.requestMIDIAccess` exists. False on Safari, every version. */
  supported: boolean;
  /** Input ports currently connected. Empty until access is granted. */
  devices: MidiDevice[];
  /** The `DOMException` name from a refused request, e.g. `"SecurityError"`. */
  error: string | null;
  /** Requests access. Safe to call more than once; later calls are no-ops. */
  requestAccess: () => void;
}

/** A port this hook is subscribed to, paired with the listener to detach. */
interface AttachedPort {
  input: MIDIInput;
  listener: (event: Event) => void;
}

const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

function toDevice(port: MIDIPort): MidiDevice {
  return {
    id: port.id,
    name: port.name ?? '',
    manufacturer: port.manufacturer ?? '',
    state: port.state,
    connection: port.connection,
  };
}

function collectInputs(access: MIDIAccess): MIDIInput[] {
  // MIDIInputMap exposes forEach but not an iterator in the DOM typings.
  const inputs: MIDIInput[] = [];
  access.inputs.forEach((input) => inputs.push(input));
  return inputs;
}

/**
 * `MIDIMessageEvent.timeStamp` is relative to the page's time origin, like
 * `performance.now()`. `windowEvents` stores epoch milliseconds, so shift it.
 */
function toEpochMs(timeStamp: number): number {
  if (typeof performance === 'undefined' || typeof performance.timeOrigin !== 'number') {
    return Date.now();
  }
  return Math.round(performance.timeOrigin + timeStamp);
}

/**
 * Subscribes to the Web MIDI API and turns incoming messages into typed events.
 *
 * This is the event-driven counterpart to `useGamepad`, and the contrast is the
 * point of the comparison:
 *
 * - **There is no polling loop.** MIDI messages arrive as DOM events on each
 *   input port, so there is no `requestAnimationFrame`, no snapshot to diff, and
 *   no synthesising of transitions from state changes. A note-on *is* an event.
 * - **Timestamps are not quantised to the frame.** Every message carries its own
 *   `timeStamp` from the MIDI stack, on the `performance.now()` clock. The
 *   one-frame (8-16 ms) error that limits `useGamepad` for reaction-time work
 *   does not apply here, so timing-sensitive studies are genuinely viable.
 * - **Velocity is free.** Every note-on reports how hard the key was struck, a
 *   continuous expressive dimension that buttons simply do not have.
 * - **Capture also keeps running in a hidden tab**, because events are delivered
 *   rather than polled on animation frames.
 *
 * Two things to know about the implementation:
 *
 * - It attaches with `addEventListener('midimessage', ...)`, not by assigning
 *   `input.onmidimessage`. The assignment form -- which is what most examples
 *   show -- allows exactly one handler per port, so reVISit's study-wide capture
 *   and a stimulus that also calls this hook would silently clobber each other.
 *   Ports are also opened explicitly with `open()` rather than relying on the
 *   implicit open that setting `onmidimessage` performs.
 * - **Browser support is the real constraint.** Chrome and Edge only. Safari has
 *   no Web MIDI on any platform or version; Firefox 108+ has it but prompts to
 *   install a Site Permission Add-On first, which is too much friction for study
 *   participants. {@link UseMidiResult.supported} is how a study detects this,
 *   and the `$midi.components.midiConnection` library component explains it to
 *   the participant.
 */
export function useMidi(options: UseMidiOptions = {}): UseMidiResult {
  const { autoRequest = false, enabled = true } = options;

  // Held in a ref so handler identity does not force a resubscribe.
  const handlersRef = useRef(options);
  useLayoutEffect(() => {
    handlersRef.current = options;
  });

  const supported = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function',
    [],
  );

  const [status, setStatus] = useState<MidiStatus>(supported ? 'idle' : 'unsupported');
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<MIDIAccess | null>(null);

  // Guards against a second request while the first promise is still pending.
  const requestedRef = useRef(false);

  const requestAccess = useCallback(() => {
    if (!supported || requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    setStatus('requesting');

    // sysex is not requested: nothing here needs it, and asking for it turns a
    // silent grant into a permission prompt in Chrome.
    navigator.requestMIDIAccess({ sysex: false })
      .then((midiAccess) => {
        setAccess(midiAccess);
        setStatus('granted');
        setError(null);
      })
      .catch((reason: unknown) => {
        requestedRef.current = false;
        setStatus('denied');
        // A refusal arrives as a DOMException, whose `name` ("SecurityError",
        // "NotAllowedError") is the part worth recording. Read the property
        // rather than testing `instanceof Error`, which DOMException fails in
        // some environments.
        const name = typeof reason === 'object' && reason !== null && typeof (reason as { name?: unknown }).name === 'string'
          ? (reason as { name: string }).name
          : String(reason);
        setError(name);
      });
  }, [supported]);

  useEffect(() => {
    if (enabled && autoRequest) {
      requestAccess();
    }
  }, [autoRequest, enabled, requestAccess]);

  useEffect(() => {
    if (!access || !enabled) {
      return undefined;
    }

    const handleMessage = (event: MIDIMessageEvent, device: MidiDevice) => {
      const { data, timeStamp } = event;
      if (!data || data.length < 2) {
        return;
      }

      /* eslint-disable-next-line no-bitwise */
      const command = data[0] & 0xf0;
      /* eslint-disable-next-line no-bitwise */
      const channel = data[0] & 0x0f;
      const epochMs = toEpochMs(timeStamp);

      if (command === NOTE_ON || command === NOTE_OFF) {
        const note = data[1];
        const velocity = data[2] ?? 0;
        const message: MidiNoteMessage = {
          note, velocity, channel, timeStamp, epochMs, device,
        };
        // A note-on with velocity 0 is the note-off form most keyboards send.
        if (command === NOTE_ON && velocity > 0) {
          handlersRef.current.onNoteOn?.(message);
        } else {
          handlersRef.current.onNoteOff?.(message);
        }
        return;
      }

      if (command === CONTROL_CHANGE) {
        handlersRef.current.onControlChange?.({
          controller: data[1],
          value: data[2] ?? 0,
          channel,
          timeStamp,
          epochMs,
          device,
        });
      }
    };

    // Ports currently attached, so a disappearing port can be detached cleanly.
    const attached: Map<string, AttachedPort> = new Map();

    const syncPorts = () => {
      const inputs = collectInputs(access);
      const presentIds = new Set(inputs.map((input) => input.id));

      attached.forEach((entry, id) => {
        if (!presentIds.has(id)) {
          entry.input.removeEventListener('midimessage', entry.listener);
          attached.delete(id);
        }
      });

      inputs.forEach((input) => {
        if (attached.has(input.id)) {
          return;
        }
        const listener = (event: Event) => handleMessage(event as MIDIMessageEvent, toDevice(input));
        input.addEventListener('midimessage', listener);
        attached.set(input.id, { input, listener });
        // Explicit open rather than relying on the implicit open that assigning
        // `onmidimessage` would perform. A rejection here is not fatal: the port
        // is simply unavailable, which `state` already reports.
        if (typeof input.open === 'function') {
          input.open().catch(() => undefined);
        }
      });

      const nextDevices = inputs.map(toDevice);
      setDevices(nextDevices);
      handlersRef.current.onDeviceChange?.(nextDevices, Date.now());
    };

    syncPorts();
    access.addEventListener('statechange', syncPorts);

    return () => {
      access.removeEventListener('statechange', syncPorts);
      attached.forEach((entry) => {
        entry.input.removeEventListener('midimessage', entry.listener);
      });
      attached.clear();
    };
  }, [access, enabled]);

  return {
    status, supported, devices, error, requestAccess,
  };
}
