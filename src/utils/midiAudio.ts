import { velocityFraction } from './midiNotes';

/**
 * Equal-temperament frequency for a MIDI note number, with A4 (note 69) at 440Hz.
 */
export function midiNoteToFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

/** Shortest and longest note the synth will sound, in milliseconds. */
const MIN_DURATION_MS = 80;
const MAX_DURATION_MS = 1600;

/** Headroom so a handful of simultaneous notes do not clip. */
const MASTER_GAIN = 0.5;
const PEAK_GAIN = 0.22;

/** Beyond this many notes sounding at once, new ones are dropped. */
const MAX_VOICES = 12;

/**
 * A small Web Audio synth for sounding recorded MIDI notes during analysis replay.
 *
 * This is deliberately not a sampled piano. The point is to let an analyst *hear*
 * what a participant played -- the order, the rhythm and the dynamics -- not to
 * reproduce the instrument's timbre. Velocity maps to loudness, which is the one
 * expressive dimension the data actually carries.
 *
 * The `AudioContext` is created lazily by {@link unlock}, which must be called
 * from a user gesture: browsers start audio contexts suspended otherwise, and a
 * replay that silently failed to make noise would be worse than no feature.
 */
export class MidiNoteSynth {
  private context: AudioContext | null = null;

  private master: GainNode | null = null;

  private voices = 0;

  /** True once an AudioContext exists and is running. */
  get ready(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Creates or resumes the audio context. Call from a user gesture. */
  async unlock(): Promise<boolean> {
    if (typeof window === 'undefined') {
      return false;
    }
    const AudioContextCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return false;
    }

    if (!this.context) {
      this.context = new AudioContextCtor();
      this.master = this.context.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }

    return this.context.state === 'running';
  }

  /**
   * Sounds one note. `durationMs` should be the recorded note duration where one
   * is known, so a held chord sounds held and a staccato run sounds short.
   */
  play(note: number, velocity: number, durationMs = 450): void {
    const { context, master } = this;
    if (!context || !master || context.state !== 'running') {
      return;
    }
    if (this.voices >= MAX_VOICES) {
      return;
    }

    const duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, durationMs)) / 1000;
    const frequency = midiNoteToFrequency(note);
    const now = context.currentTime;
    const peak = PEAK_GAIN * velocityFraction(velocity);
    if (peak <= 0) {
      return;
    }

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    envelope.connect(master);

    // A touch of lowpass keeps the triangle from sounding harsh, and tracking the
    // cutoff with pitch stops high notes turning into whistles.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(12000, frequency * 6);
    filter.connect(envelope);

    const fundamental = context.createOscillator();
    fundamental.type = 'triangle';
    fundamental.frequency.value = frequency;
    fundamental.connect(filter);

    // A quiet octave above, which reads as "struck" rather than as a test tone.
    const overtone = context.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = frequency * 2;
    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.3;
    overtone.connect(overtoneGain);
    overtoneGain.connect(filter);

    this.voices += 1;
    fundamental.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      filter.disconnect();
      envelope.disconnect();
      overtoneGain.disconnect();
    };

    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + duration);
    overtone.stop(now + duration);
  }

  /** Releases the audio context. Safe to call more than once. */
  dispose(): void {
    const { context } = this;
    this.context = null;
    this.master = null;
    this.voices = 0;
    if (context) {
      context.close().catch(() => undefined);
    }
  }
}
