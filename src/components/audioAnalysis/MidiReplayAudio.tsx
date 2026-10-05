import { ActionIcon, Tooltip } from '@mantine/core';
import { IconVolume, IconVolumeOff } from '@tabler/icons-react';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { StoredAnswer } from '../../store/types';
import { useReplayContext } from '../../store/hooks/useReplay';
import { MidiNoteSynth } from '../../utils/midiAudio';

interface RecordedNote {
  /** Epoch milliseconds of the note-on. */
  at: number;
  note: number;
  velocity: number;
  /** Measured from the matching note-off, where there is one. */
  durationMs: number;
}

/** Default sounded length for a note whose note-off never arrived. */
const FALLBACK_DURATION_MS = 450;

/**
 * A jump larger than this is a seek, not playback, so the notes it skipped over
 * are not sounded. Without it, dragging the scrubber fires every note in the
 * range at once.
 */
const MAX_CATCHUP_MS = 1000;

/**
 * Pairs `midinoteon` entries with their `midinoteoff`, so each note knows how
 * long it was actually held.
 */
export function extractRecordedNotes(answer: StoredAnswer | undefined): RecordedNote[] {
  const events = answer?.windowEvents ?? [];
  const notes: RecordedNote[] = [];
  // Note number to the index, in `notes`, of its most recent unresolved note-on.
  const pending = new Map<number, number>();

  events.forEach((event) => {
    const [at, kind, payload] = event;
    if (kind !== 'midinoteon' && kind !== 'midinoteoff') {
      return;
    }
    if (!Array.isArray(payload) || payload.length < 2) {
      return;
    }
    const [note, velocity] = payload as number[];

    if (kind === 'midinoteon') {
      pending.set(note, notes.length);
      notes.push({
        at, note, velocity, durationMs: FALLBACK_DURATION_MS,
      });
      return;
    }

    const index = pending.get(note);
    if (index !== undefined) {
      pending.delete(note);
      notes[index].durationMs = Math.max(1, at - notes[index].at);
    }
  });

  return notes.sort((a, b) => a.at - b.at);
}

/**
 * Sounds a trial's recorded MIDI in time with the analysis replay.
 *
 * The screen recording shows what the participant saw, and the provenance
 * timeline shows which notes they played, but neither lets an analyst hear the
 * performance -- and rhythm and dynamics are most of what a musical trial is
 * about. This plays the stored `midinoteon` stream against the replay clock,
 * using each note's recorded velocity and held duration.
 *
 * It lives here, in the analysis chrome, rather than in the stimulus: a study
 * with `recordScreen` set replays as a video and the stimulus is never mounted
 * (see `ComponentController`), so anything inside the stimulus would be silent
 * in exactly the case this is most useful.
 *
 * Off by default. Browsers start an `AudioContext` suspended, so the first click
 * is the user gesture that unlocks it.
 */
export function MidiReplayAudio({ answer }: { answer: StoredAnswer | undefined }) {
  const { replayEvent, isPlaying, forceEmitTimeUpdate } = useReplayContext();
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const synthRef = useRef<MidiNoteSynth | null>(null);

  const notes = useMemo(() => extractRecordedNotes(answer), [answer]);
  const startTime = answer?.startTime ?? 0;

  /** Replay position at the previous tick, so each note sounds exactly once. */
  const lastPlayTimeRef = useRef<number | null>(null);

  useEffect(() => () => {
    synthRef.current?.dispose();
    synthRef.current = null;
  }, []);

  // A different trial means a different note stream; start its cursor fresh.
  useEffect(() => {
    lastPlayTimeRef.current = null;
  }, [notes, startTime]);

  useEffect(() => {
    if (!enabled || notes.length === 0) {
      return undefined;
    }

    const onTimeUpdate = (seconds: number) => {
      const now = startTime + seconds * 1000;
      const previous = lastPlayTimeRef.current;
      lastPlayTimeRef.current = now;

      if (previous === null || !isPlaying) {
        return;
      }
      const elapsed = now - previous;
      // Backwards, stationary, or a seek: nothing to sound.
      if (elapsed <= 0 || elapsed > MAX_CATCHUP_MS) {
        return;
      }

      notes
        .filter((recorded) => recorded.at > previous && recorded.at <= now)
        .forEach((recorded) => synthRef.current?.play(recorded.note, recorded.velocity, recorded.durationMs));
    };

    replayEvent.on('timeupdate', onTimeUpdate);
    forceEmitTimeUpdate();
    return () => {
      replayEvent.off('timeupdate', onTimeUpdate);
    };
  }, [enabled, forceEmitTimeUpdate, isPlaying, notes, replayEvent, startTime]);

  const toggle = useCallback(async () => {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (!synthRef.current) {
      synthRef.current = new MidiNoteSynth();
    }
    const unlocked = await synthRef.current.unlock();
    if (!unlocked) {
      setUnavailable(true);
      return;
    }
    lastPlayTimeRef.current = null;
    setEnabled(true);
  }, [enabled]);

  // Nothing to play: a trial with no recorded notes, or a study without MIDI.
  if (notes.length === 0) {
    return null;
  }

  const label = unavailable
    ? 'Audio unavailable in this browser'
    : `${enabled ? 'Mute' : 'Play'} the recorded MIDI (${notes.length} notes)`;

  return (
    <Tooltip label={label}>
      <ActionIcon
        aria-label={label}
        data-testid="midi-replay-audio"
        data-enabled={enabled ? 'true' : 'false'}
        mt={25}
        size="lg"
        variant={enabled ? 'filled' : 'light'}
        disabled={unavailable}
        onClick={toggle}
      >
        {enabled ? <IconVolume /> : <IconVolumeOff />}
      </ActionIcon>
    </Tooltip>
  );
}
