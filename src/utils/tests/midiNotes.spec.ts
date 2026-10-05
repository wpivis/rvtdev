import { describe, expect, test } from 'vitest';
import {
  PITCH_CLASS_COLORS,
  PITCH_CLASS_NAMES,
  PITCH_CLASS_SLUGS,
  PITCH_CLASS_TEXT_COLORS,
  colorForNote,
  hueForPitchClass,
  isBlackKey,
  midiNoteActionType,
  noteName,
  octaveOf,
  pitchClassOf,
  pitchClassSlug,
  velocityDynamic,
  velocityFraction,
} from '../midiNotes';

/** Parses a `#rrggbb` string into 0-255 channels. */
function channels(hex: string): [number, number, number] {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

/** Hue in degrees, recovered from a hex color. */
function hueOf(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => value / 255);
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  let hue: number;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return ((hue * 60) + 360) % 360;
}

/** Shortest distance between two hues, 0-180. */
function hueDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

describe('midiNotes note identity', () => {
  test('note 60 is C4, the convention keyboards label their keys with', () => {
    expect(noteName(60)).toBe('C4');
    expect(pitchClassOf(60)).toBe(0);
    expect(octaveOf(60)).toBe(4);
  });

  test('names every note in an octave', () => {
    const octave = Array.from({ length: 12 }, (unused, offset) => noteName(60 + offset));
    expect(octave).toEqual([
      'C4', 'C♯4', 'D4', 'D♯4', 'E4', 'F4', 'F♯4', 'G4', 'G♯4', 'A4', 'A♯4', 'B4',
    ]);
  });

  test('handles the extremes of the MIDI range', () => {
    expect(noteName(0)).toBe('C-1');
    expect(noteName(127)).toBe('G9');
  });

  test('identifies the five black keys of each octave', () => {
    const blacks = Array.from({ length: 12 }, (unused, offset) => offset)
      .filter((pitchClass) => isBlackKey(60 + pitchClass));
    expect(blacks).toEqual([1, 3, 6, 8, 10]);
    // The pattern repeats in every octave, including below middle C.
    expect(isBlackKey(49)).toBe(true);
    expect(isBlackKey(48)).toBe(false);
  });

  test('pitch class ignores octave', () => {
    expect(pitchClassSlug(48)).toBe('c');
    expect(pitchClassSlug(60)).toBe('c');
    expect(pitchClassSlug(72)).toBe('c');
  });

  test('names and slugs stay aligned', () => {
    expect(PITCH_CLASS_NAMES).toHaveLength(12);
    expect(PITCH_CLASS_SLUGS).toHaveLength(12);
    expect(new Set(PITCH_CLASS_SLUGS).size).toBe(12);
  });
});

describe('midiNotes velocity', () => {
  test('velocity is a plain fraction of the 0-127 range, clamped', () => {
    expect(velocityFraction(0)).toBe(0);
    expect(velocityFraction(127)).toBe(1);
    expect(velocityFraction(64)).toBeCloseTo(64 / 127, 5);
    expect(velocityFraction(200)).toBe(1);
    expect(velocityFraction(-5)).toBe(0);
  });

  test('dynamics read monotonically from soft to loud', () => {
    expect(velocityDynamic(0)).toBe('silent');
    expect(velocityDynamic(20)).toBe('soft');
    expect(velocityDynamic(64)).toBe('medium');
    expect(velocityDynamic(120)).toBe('loud');
  });
});

describe('midiNotes pitch-class colors', () => {
  test('all twelve classes have a distinct color', () => {
    const colors = PITCH_CLASS_SLUGS.map((slug) => PITCH_CLASS_COLORS[slug]);
    expect(new Set(colors).size).toBe(12);
    colors.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/));
  });

  test('color depends on pitch class only, never on octave', () => {
    expect(colorForNote(48)).toBe(colorForNote(60));
    expect(colorForNote(60)).toBe(colorForNote(72));
    expect(colorForNote(61)).not.toBe(colorForNote(60));
  });

  test('hues are the twelve points of the circle, placed by fifths', () => {
    const hues = Array.from({ length: 12 }, (unused, pitchClass) => hueForPitchClass(pitchClass));
    expect(new Set(hues).size).toBe(12);
    expect(hues.every((hue) => hue % 30 === 0)).toBe(true);
    // C, G, D, A: successive fifths land on successive 30-degree steps.
    expect(hues[0]).toBe(0);
    expect(hues[7]).toBe(30);
    expect(hues[2]).toBe(60);
    expect(hues[9]).toBe(90);
  });

  test('chromatic neighbours are far apart in hue, which is the point', () => {
    // A wrong note in a study is usually wrong by a semitone, so adjacent
    // semitones must not look alike. Stepping by fifths puts them a tritone
    // apart on the colour wheel.
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      const next = (pitchClass + 1) % 12;
      const distance = hueDistance(
        hueOf(PITCH_CLASS_COLORS[PITCH_CLASS_SLUGS[pitchClass]]),
        hueOf(PITCH_CLASS_COLORS[PITCH_CLASS_SLUGS[next]]),
      );
      expect(distance).toBeGreaterThan(120);
    }
  });

  test('every color has a readable text color over it', () => {
    PITCH_CLASS_SLUGS.forEach((slug) => {
      const text = PITCH_CLASS_TEXT_COLORS[slug];
      expect(['#000000', '#ffffff']).toContain(text);

      // WCAG contrast ratio against the chosen text color, which must clear the
      // 4.5:1 threshold for body text.
      const relative = (hex: string) => {
        const linear = channels(hex)
          .map((value) => value / 255)
          .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const background = relative(PITCH_CLASS_COLORS[slug]);
      const foreground = relative(text);
      const ratio = (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      expect(ratio).toBeGreaterThan(4.5);
    });
  });
});

describe('midiNoteActionType', () => {
  test('encodes the pitch class, so one action type covers every octave', () => {
    expect(midiNoteActionType(60)).toBe('midi-note-c');
    expect(midiNoteActionType(72)).toBe('midi-note-c');
    expect(midiNoteActionType(61)).toBe('midi-note-c-sharp');
    expect(midiNoteActionType(71)).toBe('midi-note-b');
  });

  test('produces a distinct action type per pitch class and nothing else', () => {
    const types = Array.from({ length: 128 }, (unused, note) => midiNoteActionType(note));
    expect(new Set(types).size).toBe(12);
  });
});
