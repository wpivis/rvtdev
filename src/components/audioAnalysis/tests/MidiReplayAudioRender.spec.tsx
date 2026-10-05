// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import {
  afterEach, describe, expect, test, vi,
} from 'vitest';
import { ReplayContext } from '../../../store/hooks/useReplay';
import { StoredAnswer } from '../../../store/types';
import { MidiReplayAudio } from '../MidiReplayAudio';

// Mantine reads matchMedia on mount, which jsdom does not implement. Same stub
// the other component specs in this repo use.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

type ReplayValue = Parameters<typeof ReplayContext.Provider>[0]['value'];

function stubReplay(): ReplayValue {
  return {
    replayEvent: { on: () => {}, off: () => {} },
    isPlaying: false,
    forceEmitTimeUpdate: () => {},
  } as unknown as ReplayValue;
}

function renderWith(answer: StoredAnswer | undefined) {
  return render(
    <MantineProvider>
      <ReplayContext.Provider value={stubReplay()}>
        <MidiReplayAudio answer={answer} />
      </ReplayContext.Provider>
    </MantineProvider>,
  );
}

function answerWith(windowEvents: StoredAnswer['windowEvents']): StoredAnswer {
  return { startTime: 1000, endTime: 9000, windowEvents } as StoredAnswer;
}

describe('MidiReplayAudio', () => {
  // This project does not enable vitest globals, so Testing Library's automatic
  // cleanup never runs and a rendered button would leak into the next test.
  afterEach(cleanup);

  test('offers playback when the trial recorded notes, muted to begin with', () => {
    renderWith(answerWith([
      [1000, 'midinoteon', [60, 90]],
      [1100, 'midinoteoff', [60, 0]],
    ]));

    const control = screen.getByTestId('midi-replay-audio');
    expect(control).toBeTruthy();
    // Browsers start an AudioContext suspended, so nothing sounds until clicked.
    expect(control.getAttribute('data-enabled')).toBe('false');
    expect(control.getAttribute('aria-label')).toContain('1 notes');
  });

  test('renders nothing for a trial with no MIDI', () => {
    renderWith(answerWith([[1000, 'mousemove', [10, 20]]]));
    expect(screen.queryByTestId('midi-replay-audio')).toBeNull();
  });

  test('renders nothing for a study that never captured MIDI at all', () => {
    // Every non-MIDI study in the repo replays through this footer, so the
    // control must stay completely invisible to them.
    renderWith(undefined);
    expect(screen.queryByTestId('midi-replay-audio')).toBeNull();
  });

  test('control-change entries alone are not enough to offer playback', () => {
    renderWith(answerWith([[1000, 'midicc', [64, 127]]]));
    expect(screen.queryByTestId('midi-replay-audio')).toBeNull();
  });
});
