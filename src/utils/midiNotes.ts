/**
 * Shared vocabulary for MIDI input.
 *
 * Both the study stimulus (which draws a keyboard in pitch-class colors) and the
 * analysis provenance timeline (which colors nodes by the note that was played)
 * import from here, so the two always agree on what "C sharp" looks like.
 *
 * This is the MIDI counterpart to `gamepadButtons.ts` on `claude/gamepad-demo`.
 * The gamepad has sixteen arbitrary buttons whose colors are a hardware
 * convention; a keyboard has twelve pitch classes arranged in a circle, so the
 * colors here are *derived* rather than looked up.
 */

/** Display names for the twelve pitch classes, indexed by `note % 12`. */
export const PITCH_CLASS_NAMES = [
  'C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B',
] as const;

/**
 * Identifier-safe names for the same twelve classes. These end up inside Trrack
 * action types, so they avoid the sharp sign and anything the provenance color
 * lookup would normalize away.
 */
export const PITCH_CLASS_SLUGS = [
  'c', 'c-sharp', 'd', 'd-sharp', 'e', 'f', 'f-sharp', 'g', 'g-sharp', 'a', 'a-sharp', 'b',
] as const;

export type PitchClassSlug = typeof PITCH_CLASS_SLUGS[number];

/** Which of the twelve classes are the black keys, used for drawing a keyboard. */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** The lowest and highest note numbers MIDI can express. */
export const MIDI_NOTE_MIN = 0;
export const MIDI_NOTE_MAX = 127;

/** The highest value a MIDI velocity or controller byte can carry. */
export const MIDI_VALUE_MAX = 127;

export function pitchClassOf(note: number): number {
  // Negative inputs would otherwise produce a negative remainder in JS.
  return ((note % 12) + 12) % 12;
}

/**
 * Octave number in scientific pitch notation, where note 60 is C4 -- the
 * convention MIDI keyboards and DAWs label their keys with.
 */
export function octaveOf(note: number): number {
  return Math.floor(note / 12) - 1;
}

export function isBlackKey(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(pitchClassOf(note));
}

/** Human-readable note name, e.g. `60` becomes `C4` and `61` becomes `C#4`. */
export function noteName(note: number): string {
  return `${PITCH_CLASS_NAMES[pitchClassOf(note)]}${octaveOf(note)}`;
}

/**
 * Hue for a pitch class, placed around the twelve-tone circle by **fifths**
 * rather than by semitone.
 *
 * Stepping in semitones would put C and C sharp 30 degrees apart, which is
 * exactly the distinction an analyst most needs to make -- a wrong note in a
 * study is usually wrong by a semitone. Stepping by fifths (`pitchClass * 7 mod
 * 12`) puts chromatic neighbours a tritone apart in hue instead, so C is red and
 * C sharp is blue, while notes that sound related stay visually related: a major
 * scale lands on seven well-spread hues, and the three notes of a triad sit
 * close together.
 */
export function hueForPitchClass(pitchClass: number): number {
  return (((pitchClass * 7) % 12) * 30 + 360) % 360;
}

/** Fixed saturation, so hue is the only channel that varies between notes. */
const PITCH_SATURATION = 0.62;

/**
 * Target relative luminance for every pitch-class color.
 *
 * Holding luminance constant across the twelve does two things: hue becomes the
 * only varying channel, which is what a categorical encoding wants, and the same
 * text color is readable on all of them. The value sits far enough below the
 * 4.5:1 threshold for white text that every hue clears it, which a fixed HSL
 * lightness does not -- at one lightness, yellow is far brighter than blue, and
 * some hues land in the gap where neither black nor white text is readable.
 */
const TARGET_LUMINANCE = 0.16;

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = lightness - chroma / 2;

  const base = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][Math.floor(sector) % 6];

  return [base[0] + match, base[1] + match, base[2] + match];
}

/** Rec. 709 relative luminance, the quantity WCAG contrast ratios are built on. */
function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const linear = [red, green, blue].map((value) => (
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function toHex([red, green, blue]: [number, number, number]): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * Finds the HSL lightness at which this hue hits {@link TARGET_LUMINANCE}.
 * Luminance rises monotonically with lightness, so a bisection converges.
 */
function colorAtTargetLuminance(hue: number): string {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (relativeLuminance(hslToRgb(hue, PITCH_SATURATION, mid)) < TARGET_LUMINANCE) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return toHex(hslToRgb(hue, PITCH_SATURATION, (low + high) / 2));
}

/**
 * Pitch-class colors, keyed by slug. Deliberately independent of octave: C3 and
 * C5 are the same color, because the thing worth seeing on a provenance timeline
 * is which *note* was played, and octave is already in the node label.
 *
 * Twelve hue-only categories are more than color vision alone can reliably
 * separate, so these colors are a fast read for an analyst rather than the only
 * channel: every node also carries its note name in the label.
 */
export const PITCH_CLASS_COLORS: Record<PitchClassSlug, string> = Object.fromEntries(
  PITCH_CLASS_SLUGS.map((slug, pitchClass) => [slug, colorAtTargetLuminance(hueForPitchClass(pitchClass))]),
) as Record<PitchClassSlug, string>;

/**
 * A readable contrast color for text drawn on top of {@link PITCH_CLASS_COLORS}.
 * Equal-luminance backgrounds make this the same answer for all twelve, but it is
 * derived rather than hard-coded so it stays correct if the target moves.
 */
export const PITCH_CLASS_TEXT_COLORS: Record<PitchClassSlug, string> = Object.fromEntries(
  PITCH_CLASS_SLUGS.map((slug) => {
    const hex = PITCH_CLASS_COLORS[slug];
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
    const luminance = relativeLuminance(rgb);
    // Contrast against white vs black, using the WCAG ratio.
    const againstWhite = 1.05 / (luminance + 0.05);
    const againstBlack = (luminance + 0.05) / 0.05;
    return [slug, againstWhite >= againstBlack ? '#ffffff' : '#000000'];
  }),
) as Record<PitchClassSlug, string>;

export function pitchClassSlug(note: number): PitchClassSlug {
  return PITCH_CLASS_SLUGS[pitchClassOf(note)];
}

export function colorForNote(note: number): string {
  return PITCH_CLASS_COLORS[pitchClassSlug(note)];
}

export function textColorForNote(note: number): string {
  return PITCH_CLASS_TEXT_COLORS[pitchClassSlug(note)];
}

/**
 * The Trrack action type used when a note is played.
 *
 * Provenance node colors are derived from the action type, so this naming
 * convention is what lets the analysis timeline paint a node in its note's
 * color. See `EXPLICIT_KEY_COLORS` in
 * `components/audioAnalysis/provenanceColors.ts`.
 *
 * The action type carries the pitch class only. Octave and velocity belong on
 * the node's label and payload, where they can be read without multiplying the
 * number of registered action types by ten.
 */
export function midiNoteActionType(note: number): string {
  return `midi-note-${pitchClassSlug(note)}`;
}

/**
 * Velocity as a 0-1 fraction. MIDI velocity is 1-127 for a struck note (0 is
 * reserved to mean note-off), so this is a straight divide with no rescaling --
 * the curve from key speed to velocity byte is the instrument's business, and
 * differs between keyboards.
 */
export function velocityFraction(velocity: number): number {
  return Math.min(1, Math.max(0, velocity / MIDI_VALUE_MAX));
}

/** Coarse dynamic marking for a velocity, for prompts a non-musician can follow. */
export function velocityDynamic(velocity: number): string {
  if (velocity <= 0) return 'silent';
  if (velocity < 40) return 'soft';
  if (velocity < 90) return 'medium';
  return 'loud';
}
