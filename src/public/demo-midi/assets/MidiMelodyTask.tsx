import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Badge, Group, Paper, Stack, Text,
} from '@mantine/core';
import { Registry } from '@trrack/core';
import { StimulusParams } from '../../../store/types';
import { useMidi, type MidiNoteMessage } from '../../../store/hooks/useMidi';
import { MidiKeyboard } from '../../../components/interface/MidiKeyboard';
import {
  MIDI_VALUE_MAX,
  PITCH_CLASS_SLUGS,
  colorForNote,
  midiNoteActionType,
  noteName,
  pitchClassSlug,
  textColorForNote,
  velocityDynamic,
  type PitchClassSlug,
} from '../../../utils/midiNotes';

const KEYBOARD_WIDTH = 640;
const KEYBOARD_HEIGHT = 120;

interface MelodyTaskParams {
  /** The notes to play, in order, as MIDI note numbers. 60 is C4. */
  melody?: number[];
  /** Velocity the participant is asked to match, 1-127. */
  targetVelocity?: number;
  /** How far from {@link targetVelocity} still counts as matched. */
  velocityTolerance?: number;
  /** Lowest note drawn on the keyboard. Defaults to 48 (C3). */
  lowestNote?: number;
  /** How many semitones to draw. Defaults to 37, a three-octave controller. */
  keyCount?: number;
}

/**
 * Longest gap, in milliseconds, still treated as a musical interval. Anything
 * longer is a pause rather than rhythm, and is kept out of the timing aggregates.
 */
const MAX_MUSICAL_INTERVAL_MS = 5000;

/** C major scale fragment, used when a component supplies no melody. */
const DEFAULT_MELODY = [60, 62, 64, 65, 67];

interface NotePayload {
  note: number;
  velocity: number;
  hit: boolean;
  /** Index into the melody that was being prompted when this note arrived. */
  promptIndex: number;
  outcome: string;
  completed: boolean;
}

interface PromptPayload {
  index: number;
  note: number;
}

/**
 * Provenance state: the semantic state of the task.
 *
 * Note how little had to be decided here. The gamepad equivalent had to rule on
 * what to keep out of the graph, because a stick emits a new value every frame
 * forever. A keyboard emits one event per note, so *everything* the participant
 * did is already a discrete, meaningful event, and all of it goes in. There is no
 * throttle, no sampling interval, and no per-frame path to leave to the screen
 * recording.
 */
interface MelodyState {
  promptIndex: number;
  promptNote: number | null;
  lastNote: number | null;
  lastVelocity: number | null;
  hits: number;
  misses: number;
  outcome: string;
  completed: boolean;
}

const INITIAL_STATE: MelodyState = {
  promptIndex: 0,
  promptNote: null,
  lastNote: null,
  lastVelocity: null,
  hits: 0,
  misses: 0,
  outcome: 'Waiting for a MIDI instrument',
  completed: false,
};

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample standard deviation, the headline number for timing precision. */
function standardDeviation(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values) as number;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value: number | null, places = 2): number | null {
  if (value === null) {
    return null;
  }
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function MidiMelodyTask({
  parameters, setAnswer, provenanceState, useTrrack,
}: StimulusParams<MelodyTaskParams, MelodyState>) {
  const {
    melody = DEFAULT_MELODY,
    targetVelocity = 80,
    velocityTolerance = 25,
    lowestNote = 48,
    keyCount = 37,
  } = parameters;

  // One registered action type per pitch class. Provenance node colors are
  // derived from the action type, so this is what makes the analysis timeline
  // read as a piano roll: every C is the same color wherever it appears.
  const { actions, registry } = useMemo(() => {
    const reg = Registry.create();

    const applyNote = (state: MelodyState, payload: NotePayload) => {
      state.lastNote = payload.note;
      state.lastVelocity = payload.velocity;
      state.outcome = payload.outcome;
      state.completed = payload.completed;
      if (payload.hit) {
        state.hits += 1;
      } else {
        state.misses += 1;
      }
      return state;
    };

    // The explicit generics are needed because `state` is annotated; without them
    // Trrack infers the payload type from the state type and the call fails to compile.
    const registerNote = (slug: PitchClassSlug) => reg.register<string, string, NotePayload, unknown, MelodyState>(
      `midi-note-${slug}`,
      applyNote,
    );

    const note = Object.fromEntries(
      PITCH_CLASS_SLUGS.map((slug) => [slug, registerNote(slug)]),
    ) as Record<PitchClassSlug, ReturnType<typeof registerNote>>;

    const prompt = reg.register<string, string, PromptPayload, unknown, MelodyState>(
      'midi-prompt-note',
      (state: MelodyState, payload: PromptPayload) => {
        state.promptIndex = payload.index;
        state.promptNote = payload.note;
        state.outcome = `Play ${noteName(payload.note)}`;
        return state;
      },
    );

    return { registry: reg, actions: { note, prompt } };
  }, []);

  const trrack = useTrrack({ registry, initialState: INITIAL_STATE });

  const [task, setTask] = useState<MelodyState>(INITIAL_STATE);
  const [activeNotes, setActiveNotes] = useState<Map<number, number>>(new Map());
  const [lastInterval, setLastInterval] = useState<number | null>(null);

  const taskRef = useRef<MelodyState>(INITIAL_STATE);
  const velocityErrorsRef = useRef<number[]>([]);
  const onsetIntervalsRef = useRef<number[]>([]);
  const noteDurationsRef = useRef<number[]>([]);
  /** Previous note-on, on the MIDI clock, for inter-onset intervals. */
  const previousOnsetRef = useRef<number | null>(null);
  /** Held notes, so a note-off can be matched to its onset for a duration. */
  const heldRef = useRef<Map<number, number>>(new Map());

  const isReplay = provenanceState !== undefined;

  const commit = useCallback((state: MelodyState) => {
    taskRef.current = state;
    setTask(state);
  }, []);

  const publishAnswer = useCallback((state: MelodyState) => {
    setAnswer({
      // Status stays true throughout so a participant whose instrument misbehaves
      // is never trapped on this trial; how far they got is in `completed`.
      // This is only true because of the mount-time publish below -- the claim
      // without it is exactly the bug upstream review found in the gamepad
      // stimulus, where the first setAnswer happened after the first button press.
      status: true,
      answers: {
        notesHit: state.hits,
        misses: state.misses,
        meanVelocityError: round(mean(velocityErrorsRef.current)),
        // Both of these are computed from MIDI message timestamps, not from
        // Date.now() or an animation frame, so the sub-millisecond digits are
        // real rather than an artefact of when JavaScript looked.
        meanOnsetIntervalMs: round(mean(onsetIntervalsRef.current)),
        onsetJitterMs: round(standardDeviation(onsetIntervalsRef.current)),
        meanNoteDurationMs: round(mean(noteDurationsRef.current)),
        completed: state.completed,
      },
    });
  }, [setAnswer]);

  const promptAt = useCallback((index: number) => {
    const note = melody[index];
    if (note === undefined) {
      return;
    }
    trrack.apply(`Prompt ${index + 1}: ${noteName(note)}`, actions.prompt({ index, note }));
    commit({ ...taskRef.current, promptIndex: index, promptNote: note, outcome: `Play ${noteName(note)}` });
  }, [actions, commit, melody, trrack]);

  const handleNoteOn = useCallback((message: MidiNoteMessage) => {
    const { note, velocity, timeStamp } = message;

    setActiveNotes((previous) => new Map(previous).set(note, velocity));
    heldRef.current.set(note, timeStamp);

    if (isReplay) {
      return;
    }

    const current = taskRef.current;
    if (current.completed || current.promptNote === null) {
      return;
    }

    const interval = previousOnsetRef.current === null ? null : timeStamp - previousOnsetRef.current;
    previousOnsetRef.current = timeStamp;
    if (interval !== null) {
      setLastInterval(interval);
      // Only intervals inside a musical range reach the aggregate. A participant
      // who stops to read the instructions, or whose tab sat in the background,
      // produces a gap of minutes, and a single one of those would dominate both
      // the mean and the jitter. The gamepad had the same hazard in a different
      // guise -- an unbounded frame delta after a hidden tab -- and clamping is
      // the same lesson, applied where the unbounded delta actually is.
      if (interval <= MAX_MUSICAL_INTERVAL_MS) {
        onsetIntervalsRef.current.push(interval);
      }
    }

    const hit = note === current.promptNote;
    const velocityError = Math.abs(velocity - targetVelocity);
    if (hit) {
      velocityErrorsRef.current.push(velocityError);
    }

    const nextIndex = hit ? current.promptIndex + 1 : current.promptIndex;
    const completed = hit && nextIndex >= melody.length;

    let outcome: string;
    if (!hit) {
      outcome = `Miss — played ${noteName(note)}, wanted ${noteName(current.promptNote)}`;
    } else if (completed) {
      outcome = `${noteName(note)} — melody complete`;
    } else if (velocityError > velocityTolerance) {
      outcome = `${noteName(note)} — right note, ${velocity < targetVelocity ? 'too soft' : 'too hard'}`;
    } else {
      outcome = `${noteName(note)} — matched`;
    }

    trrack.apply(
      `${noteName(note)} · vel ${velocity} — ${hit ? 'hit' : 'miss'}`,
      actions.note[pitchClassSlug(note)]({
        note,
        velocity,
        hit,
        promptIndex: current.promptIndex,
        outcome,
        completed,
      }),
    );

    const nextState: MelodyState = {
      ...current,
      lastNote: note,
      lastVelocity: velocity,
      hits: current.hits + (hit ? 1 : 0),
      misses: current.misses + (hit ? 0 : 1),
      outcome,
      completed,
    };
    commit(nextState);
    publishAnswer(nextState);

    if (hit && !completed) {
      promptAt(nextIndex);
    }
  }, [actions, commit, isReplay, melody.length, promptAt, publishAnswer, targetVelocity, trrack, velocityTolerance]);

  const handleNoteOff = useCallback(({ note, timeStamp }: MidiNoteMessage) => {
    setActiveNotes((previous) => {
      if (!previous.has(note)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(note);
      return next;
    });

    // Duration is the one musical quantity a note-on alone cannot express, so it
    // is folded into the answer here rather than becoming its own provenance node.
    const onset = heldRef.current.get(note);
    if (onset !== undefined) {
      heldRef.current.delete(note);
      const duration = timeStamp - onset;
      // Same clamp: a key still held when the participant walks away is not a
      // note duration, and a negative value would mean the clock went backwards.
      if (!isReplay && duration >= 0 && duration <= MAX_MUSICAL_INTERVAL_MS) {
        noteDurationsRef.current.push(duration);
      }
    }
  }, [isReplay]);

  // Publish a valid zero-valued answer on mount.
  //
  // The reactive responses on this component default to required, so without this
  // the trial starts invalid and a participant whose instrument never works is
  // stuck on it with no way forward. Guarded by a ref rather than by effect deps:
  // if `setAnswer` ever changed identity mid-trial, a deps-driven re-run would
  // wipe a real tally back to zeros.
  const publishedInitialAnswer = useRef(false);
  useEffect(() => {
    if (isReplay || publishedInitialAnswer.current) {
      return;
    }
    publishedInitialAnswer.current = true;
    publishAnswer(INITIAL_STATE);
  }, [isReplay, publishAnswer]);

  const { devices, supported, status } = useMidi({
    onNoteOn: handleNoteOn,
    onNoteOff: handleNoteOff,
    autoRequest: true,
    enabled: !isReplay,
  });

  const connected = useMemo(
    () => devices.some((device) => device.state === 'connected'),
    [devices],
  );

  // Start the melody as soon as an instrument is present.
  useEffect(() => {
    if (isReplay || !connected || taskRef.current.promptNote !== null || taskRef.current.completed) {
      return;
    }
    promptAt(0);
  }, [connected, isReplay, promptAt]);

  // During replay the analysis view drives the scene through provenanceState.
  //
  // This path runs only when the study is *not* replaying a screen recording --
  // with `recordScreen` set, `ComponentController` renders the recording instead
  // and this component is never mounted. Note that `useMidi` is disabled here, so
  // the live handlers never fire and the keyboard has to be driven from the
  // provenance state directly or it would show nothing being played.
  useEffect(() => {
    if (!provenanceState) {
      return;
    }
    taskRef.current = provenanceState;
    setTask(provenanceState);
    setActiveNotes(provenanceState.lastNote === null
      ? new Map()
      : new Map([[provenanceState.lastNote, provenanceState.lastVelocity ?? 0]]));
  }, [provenanceState]);

  const { promptNote } = task;

  return (
    <Stack gap="md" align="center">
      <Group gap="xs">
        <Text size="sm" c="dimmed">Target dynamic:</Text>
        <Badge size="lg" radius="sm" variant="light">
          {velocityDynamic(targetVelocity)}
          {` (velocity ${targetVelocity} ± ${velocityTolerance})`}
        </Badge>
      </Group>

      <Paper withBorder radius="md" p="md" style={{ width: KEYBOARD_WIDTH + 32 }}>
        <Stack gap="sm" align="center">
          <Group gap="xs" data-testid="midi-melody-strip">
            {melody.map((note, index) => {
              const done = index < task.promptIndex;
              const isCurrent = index === task.promptIndex && !task.completed;
              return (
                <Badge
                  // Melodies can repeat a note, so the index is part of the key.
                  key={`${index}-${note}`}
                  size="lg"
                  radius="sm"
                  variant={done || isCurrent ? 'filled' : 'outline'}
                  styles={{
                    root: {
                      backgroundColor: done || isCurrent ? colorForNote(note) : 'transparent',
                      color: done || isCurrent ? textColorForNote(note) : undefined,
                      opacity: done ? 0.55 : 1,
                      outline: isCurrent ? '2px solid #111' : undefined,
                    },
                  }}
                >
                  {noteName(note)}
                </Badge>
              );
            })}
          </Group>

          <Text size="xl" fw={700} data-testid="midi-prompt">
            {promptNote === null ? '—' : noteName(promptNote)}
          </Text>
        </Stack>
      </Paper>

      <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden', lineHeight: 0, position: 'relative' }}>
        <MidiKeyboard
          lowestNote={lowestNote}
          keyCount={keyCount}
          activeNotes={activeNotes}
          highlightNote={promptNote}
          width={KEYBOARD_WIDTH}
          height={KEYBOARD_HEIGHT}
        />
        {!connected && !isReplay && (
          <Stack
            align="center"
            justify="center"
            gap={4}
            data-testid="midi-waiting"
            style={{
              position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.9)', lineHeight: 1.4,
            }}
          >
            <Text fw={600}>
              {supported ? 'Waiting for a MIDI instrument' : 'This browser has no Web MIDI support'}
            </Text>
            <Text size="sm" c="dimmed">
              {supported
                ? 'Connect your keyboard over USB — it will be picked up automatically.'
                : 'Please reopen this study in Chrome or Edge.'}
            </Text>
            {status === 'denied' && <Text size="sm" c="red">MIDI access was refused by the browser.</Text>}
          </Stack>
        )}
      </Paper>

      <Group gap="xl">
        <Text size="sm">
          Note
          {' '}
          <strong>{Math.min(task.promptIndex + 1, melody.length)}</strong>
          {' / '}
          {melody.length}
        </Text>
        <Text size="sm">
          Hits
          {' '}
          <strong data-testid="midi-hits">{task.hits}</strong>
        </Text>
        <Text size="sm">
          Misses
          {' '}
          <strong data-testid="midi-misses">{task.misses}</strong>
        </Text>
        <Text size="sm">
          Last velocity
          {' '}
          <strong data-testid="midi-last-velocity">{task.lastVelocity ?? '—'}</strong>
          {task.lastVelocity !== null && ` / ${MIDI_VALUE_MAX}`}
        </Text>
      </Group>

      <Text size="sm" c="dimmed" data-testid="midi-outcome">{task.outcome}</Text>

      <Text size="xs" c="dimmed" data-testid="midi-interval">
        {lastInterval === null
          ? 'Inter-onset interval appears after the second note.'
          : `Interval since previous note: ${lastInterval.toFixed(2)} ms (from the MIDI timestamp, not a frame boundary)`}
      </Text>

      {devices.length > 0 && (
        <Text size="xs" c="dimmed">
          {devices.map((device) => [device.manufacturer, device.name].filter(Boolean).join(' ')).join(', ')}
        </Text>
      )}
    </Stack>
  );
}

export default MidiMelodyTask;
