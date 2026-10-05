import { describe, expect, test } from 'vitest';
import { StoredAnswer } from '../../../store/types';
import { extractRecordedNotes } from '../MidiReplayAudio';
import { midiNoteToFrequency } from '../../../utils/midiAudio';

function answerWith(windowEvents: StoredAnswer['windowEvents']): StoredAnswer {
  return { startTime: 1000, endTime: 9000, windowEvents } as StoredAnswer;
}

describe('extractRecordedNotes', () => {
  test('pairs each note-on with its note-off to recover the held duration', () => {
    const notes = extractRecordedNotes(answerWith([
      [1000, 'midinoteon', [60, 90]],
      [1300, 'midinoteoff', [60, 0]],
      [1500, 'midinoteon', [64, 40]],
      [2200, 'midinoteoff', [64, 0]],
    ]));

    expect(notes).toEqual([
      {
        at: 1000, note: 60, velocity: 90, durationMs: 300,
      },
      {
        at: 1500, note: 64, velocity: 40, durationMs: 700,
      },
    ]);
  });

  test('keeps overlapping notes apart, so a chord is not mis-paired', () => {
    // Three notes held together and released in a different order than struck.
    const notes = extractRecordedNotes(answerWith([
      [1000, 'midinoteon', [60, 80]],
      [1010, 'midinoteon', [64, 70]],
      [1020, 'midinoteon', [67, 60]],
      [1500, 'midinoteoff', [64, 0]],
      [1600, 'midinoteoff', [67, 0]],
      [1700, 'midinoteoff', [60, 0]],
    ]));

    expect(notes.map((recorded) => [recorded.note, recorded.durationMs])).toEqual([
      [60, 700],
      [64, 490],
      [67, 580],
    ]);
  });

  test('a note with no note-off still sounds, at the fallback duration', () => {
    const notes = extractRecordedNotes(answerWith([[1000, 'midinoteon', [72, 100]]]));
    expect(notes).toHaveLength(1);
    expect(notes[0].durationMs).toBeGreaterThan(0);
  });

  test('a repeated note pairs with its own release, not the earlier one', () => {
    const notes = extractRecordedNotes(answerWith([
      [1000, 'midinoteon', [60, 80]],
      [1100, 'midinoteoff', [60, 0]],
      [1200, 'midinoteon', [60, 110]],
      [1900, 'midinoteoff', [60, 0]],
    ]));

    expect(notes.map((recorded) => recorded.durationMs)).toEqual([100, 700]);
    expect(notes.map((recorded) => recorded.velocity)).toEqual([80, 110]);
  });

  test('ignores every other kind of window event', () => {
    const notes = extractRecordedNotes(answerWith([
      [1000, 'mousemove', [10, 20]],
      [1100, 'midicc', [64, 127]],
      [1200, 'mididevice', 'connected:Loog Piano'],
      [1300, 'midinoteon', [60, 90]],
      [1400, 'keydown', 'a'],
    ]));

    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe(60);
  });

  test('returns notes in time order even if the stream is not', () => {
    const notes = extractRecordedNotes(answerWith([
      [2000, 'midinoteon', [67, 90]],
      [1000, 'midinoteon', [60, 90]],
    ]));
    expect(notes.map((recorded) => recorded.at)).toEqual([1000, 2000]);
  });

  test('an answer with no events, or none at all, yields nothing to play', () => {
    expect(extractRecordedNotes(answerWith([]))).toEqual([]);
    expect(extractRecordedNotes(undefined)).toEqual([]);
  });
});

describe('midiNoteToFrequency', () => {
  test('anchors on A4 = 440Hz', () => {
    expect(midiNoteToFrequency(69)).toBeCloseTo(440, 6);
  });

  test('middle C and the octaves around it', () => {
    expect(midiNoteToFrequency(60)).toBeCloseTo(261.6256, 3);
    expect(midiNoteToFrequency(72)).toBeCloseTo(523.2511, 3);
  });

  test('an octave up is exactly double', () => {
    for (let note = 21; note <= 96; note += 1) {
      expect(midiNoteToFrequency(note + 12)).toBeCloseTo(midiNoteToFrequency(note) * 2, 6);
    }
  });
});
