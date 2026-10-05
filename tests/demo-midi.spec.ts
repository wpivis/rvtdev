/* eslint-disable no-await-in-loop */
import { test, expect, Page } from '@playwright/test';
import { nextClick, openStudyFromLanding, resetClientStudyState } from './utils';
import { PITCH_CLASS_COLORS, midiNoteActionType, noteName } from '../src/utils/midiNotes';
import { getColorForKey, normalizeActionName } from '../src/components/audioAnalysis/provenanceColors';

/** Matches "midi-scale" in public/demo-midi/config.json. */
const MELODY = [60, 62, 64, 65, 67];
const TARGET_VELOCITY = 70;

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const SUSTAIN_PEDAL = 64;

/** A canvas-backed stand-in for a shared screen, for the recording step. */
async function installFakeDisplayMedia(page: Page) {
  await page.addInitScript(() => {
    if (!navigator.mediaDevices) {
      return;
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      const paint = () => {
        context.fillStyle = `hsl(${(Date.now() / 20) % 360}, 60%, 70%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      };
      paint();
      setInterval(paint, 100);
      return (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(10);
    };
  });
}

/** Walks to the first trial in a browser with no Web MIDI, connecting nothing. */
async function walkToFirstTrialWithoutMidi(page: Page) {
  await openStudyFromLanding(page, 'Demo Studies', 'MIDI Piano Input with Provenance');
  await nextClick(page);

  await expect(page.getByText('This browser cannot talk to a MIDI instrument')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await page.getByRole('button', { name: 'Start Recording' }).click();
  const recordingContinue = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(recordingContinue).toBeEnabled({ timeout: 15000 });
  await recordingContinue.click();

  // Only the element, not a prompt: with no Web MIDI no device is ever seen, so
  // the task never issues one. That is the point of these tests.
  await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });
}

/**
 * Installs a synthetic MIDI instrument plus a fake screen-capture stream.
 *
 * A real piano cannot be attached to a headless browser, so this replaces
 * `navigator.requestMIDIAccess` with a port the test drives. The page subscribes
 * to that port exactly as it would a real device -- the event's own `timeStamp`
 * comes from the browser, not from the fake -- so everything above the Web MIDI
 * boundary is the production code path.
 */
async function installFakeMidi(page: Page, options: { connected?: boolean } = {}) {
  await page.addInitScript((startConnected) => {
    class FakeInput extends EventTarget {
      id = 'fake-midi-in';

      name = 'Loog Piano';

      manufacturer = 'Loog';

      type = 'input';

      version = '1.0';

      state = 'connected';

      connection = 'closed';

      open() {
        this.connection = 'open';
        return Promise.resolve(this);
      }

      close() {
        this.connection = 'closed';
        return Promise.resolve(this);
      }
    }

    const input = new FakeInput();
    let connected = startConnected;

    class FakeAccess extends EventTarget {
      sysexEnabled = false;

      onstatechange = null;

      outputs = { forEach: () => undefined };

      inputs = {
        forEach: (callback: (value: FakeInput, key: string) => void) => {
          if (connected) {
            callback(input, input.id);
          }
        },
      };
    }

    const access = new FakeAccess();

    (window as unknown as { __midi: unknown }).__midi = {
      /** Sends raw MIDI bytes, as the browser would on a real message. */
      send(bytes: number[]) {
        const event = new Event('midimessage') as Event & { data: Uint8Array };
        event.data = new Uint8Array(bytes);
        input.dispatchEvent(event);
      },
      setConnected(next: boolean) {
        connected = next;
        access.dispatchEvent(new Event('statechange'));
      },
    };

    navigator.requestMIDIAccess = () => Promise.resolve(access as unknown as MIDIAccess);
  }, options.connected ?? true);
  await installFakeDisplayMedia(page);
}

/**
 * Removes Web MIDI entirely, which is the Safari case on every version and
 * platform. Nothing here can be made to work; the study has to cope.
 */
async function installNoMidiSupport(page: Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'requestMIDIAccess');
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: undefined,
      configurable: true,
    });
  });
}

type MidiBridge = { send: (bytes: number[]) => void; setConnected: (next: boolean) => void };

async function sendMidi(page: Page, bytes: number[]) {
  await page.evaluate((message) => {
    (window as unknown as { __midi: MidiBridge }).__midi.send(message);
  }, bytes);
}

/** Simulates unplugging or plugging in the instrument. */
async function setConnected(page: Page, connected: boolean) {
  await page.evaluate((next) => {
    (window as unknown as { __midi: MidiBridge }).__midi.setConnected(next);
  }, connected);
}

/** Plays and releases a note, the way a key press actually arrives. */
async function playNote(page: Page, note: number, velocity = TARGET_VELOCITY, holdMs = 60) {
  await sendMidi(page, [NOTE_ON, note, velocity]);
  await page.waitForTimeout(holdMs);
  await sendMidi(page, [NOTE_OFF, note, 0]);
  await page.waitForTimeout(40);
}

/**
 * Reads a finished trial back out of the browser's storage: reVISit keeps
 * windowEvents on the answer, and writes the Trrack graph to its own key.
 */
async function readStoredTrial(page: Page, trialPrefix: string) {
  return page.evaluate(async (prefix) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('revisit');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction('keyvaluepairs', 'readonly').objectStore('keyvaluepairs');
    const keys: IDBValidKey[] = await new Promise((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = (key: IDBValidKey): Promise<unknown> => new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    type StoredWindowEvent = [number, string, unknown];
    type StoredAnswerShape = { windowEvents?: StoredWindowEvent[]; answer?: Record<string, unknown> };
    type ParticipantShape = { answers: Record<string, StoredAnswerShape> };
    type ProvenanceNodeShape = { event?: string; sideEffects?: { do?: { type?: string }[] } };
    type StoredProvenanceShape = { stimulus?: { nodes?: Record<string, ProvenanceNodeShape> } };

    const stringKeys = keys.map(String);

    const participantKey = stringKeys.find((key) => key.includes('/participants/') && key.endsWith('_participantData'));
    const participant = participantKey ? await get(participantKey) as ParticipantShape : null;
    const answerKey = participant
      ? Object.keys(participant.answers).find((key) => key.startsWith(prefix))
      : undefined;
    const answer = participant && answerKey ? participant.answers[answerKey] : null;

    const provenanceKey = stringKeys.find((key) => key.toLowerCase().includes('provenance') && key.includes(prefix));
    let provenance = provenanceKey ? await get(provenanceKey) : null;
    if (provenance instanceof Blob) provenance = JSON.parse(await provenance.text());
    if (typeof provenance === 'string') provenance = JSON.parse(provenance);
    const nodes = (provenance as StoredProvenanceShape | null)?.stimulus?.nodes ?? {};

    const windowEvents = answer?.windowEvents ?? [];
    return {
      windowEventKinds: Array.from(new Set(windowEvents.map((event) => event[1]))),
      noteOnPayloads: windowEvents.filter((event) => event[1] === 'midinoteon').map((event) => event[2]),
      noteOffPayloads: windowEvents.filter((event) => event[1] === 'midinoteoff').map((event) => event[2]),
      controlChangePayloads: windowEvents.filter((event) => event[1] === 'midicc').map((event) => event[2]),
      answer: answer?.answer ?? {},
      nodeActionTypes: Object.values(nodes).map(
        (node) => node?.sideEffects?.do?.[0]?.type ?? node?.event ?? '',
      ),
    };
  }, trialPrefix);
}

/** Walks the introduction, MIDI setup and screen-recording pages. */
async function reachFirstTrial(page: Page) {
  await openStudyFromLanding(page, 'Demo Studies', 'MIDI Piano Input with Provenance');
  await expect(page.getByText('MIDI Piano Input with Provenance').first()).toBeVisible({ timeout: 15000 });
  await nextClick(page);

  // Attach the instrument here rather than before the study opens: the fake is
  // installed as an init script, so navigating resets whatever a test set earlier.
  // A no-op for a fake that already starts connected.
  await setConnected(page, true);

  // MIDI setup: the instrument is listed, and one note unlocks Continue. Note
  // that nothing had to be pressed for the instrument to appear -- the browser
  // hands over the device list as soon as access is granted, unlike the gamepad
  // API, which hides devices until the page receives input.
  await expect(page.getByTestId('midi-device-table')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Loog Piano')).toBeVisible();

  // reVISit leaves Next clickable and reports the problem on the attempt rather
  // than disabling the button, so the gate is tested by trying to pass it.
  const midiContinue = page.getByRole('button', { name: 'Continue', exact: true });
  await midiContinue.click();
  await expect(page.getByText('Please play one note on your instrument to confirm it is working.')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('midi-device-table')).toBeVisible();

  await playNote(page, 60, 96);
  await expect(page.getByTestId('midi-ready')).toBeVisible({ timeout: 10000 });
  await midiContinue.click();
  await expect(page.getByTestId('midi-device-table')).toBeHidden({ timeout: 15000 });

  // Screen recording permission, backed by the fake display stream.
  await page.getByRole('button', { name: 'Start Recording' }).click();
  const recordingContinue = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(recordingContinue).toBeEnabled({ timeout: 15000 });
  await recordingContinue.click();

  // Wait for a prompt to actually be issued, not merely for the element to exist.
  // The task issues its first prompt from an effect once a device is seen, and a
  // note arriving before that is scored against no target and dropped, so a test
  // that plays immediately would silently race.
  await expect(page.getByTestId('midi-prompt')).toHaveText(noteName(MELODY[0]), { timeout: 15000 });
}

/**
 * No-device tests.
 *
 * These exist because of what upstream review found in the gamepad work: every
 * test there connected a synthetic controller before doing anything, so the one
 * behaviour the code explicitly claimed -- that a participant without hardware is
 * never trapped -- was the only one never exercised, and it was broken.
 *
 * The first group walks the whole study in a browser with **no Web MIDI at all**,
 * so no instrument is ever connected at any point.
 */
test.describe('MIDI in a browser with no Web MIDI', () => {
  test.beforeEach(async ({ page }) => {
    await installNoMidiSupport(page);
    await installFakeDisplayMedia(page);
    await resetClientStudyState(page);
  });

  test('the setup page says why, and does not trap the participant', async ({ page }) => {
    await openStudyFromLanding(page, 'Demo Studies', 'MIDI Piano Input with Provenance');
    await nextClick(page);

    await expect(page.getByText('This browser cannot talk to a MIDI instrument')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Safari/)).toBeVisible();
    // No device table, because there is no API to ask.
    await expect(page.getByTestId('midi-device-table')).toHaveCount(0);

    // No action the participant could take would ever satisfy a MIDI gate here, so
    // the gate must not hold them. Screening on browser is the real answer for a
    // live study; stranding someone on page two is strictly worse.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('This browser cannot talk to a MIDI instrument')).toBeHidden({ timeout: 15000 });
  });

  test('a trial is playable-looking, honest, and escapable with no instrument ever connected', async ({ page }) => {
    await walkToFirstTrialWithoutMidi(page);

    await expect(page.getByTestId('midi-waiting')).toBeVisible();
    await expect(page.getByText('This browser has no Web MIDI support')).toBeVisible();
    await expect(page.getByTestId('midi-hits')).toHaveText('0');
    await expect(page.getByTestId('midi-misses')).toHaveText('0');
    // No prompt is issued, because nothing could answer it.
    await expect(page.getByTestId('midi-prompt')).toHaveText('\u2014');

    // The trial must be escapable. Its reactive responses default to required, so
    // this only passes because the stimulus publishes a valid zero-valued answer
    // on mount instead of waiting for a first note.
    const before = page.url();
    await nextClick(page);
    await expect.poll(() => page.url(), { timeout: 15000 }).not.toBe(before);
    await expect(page.getByText('Please complete the stimulus interaction to continue.')).toHaveCount(0);
  });

  test('the zero-valued answer is actually stored, not just permitted', async ({ page }) => {
    await walkToFirstTrialWithoutMidi(page);

    const before = page.url();
    await nextClick(page);
    await expect.poll(() => page.url(), { timeout: 15000 }).not.toBe(before);

    await expect.poll(
      async () => (await readStoredTrial(page, 'midi-scale')).answer,
      { timeout: 30000 },
    ).toMatchObject({
      notesHit: 0,
      misses: 0,
      completed: false,
      // Aggregates over nothing are null rather than NaN, which would not survive
      // the JSON round trip into storage.
      meanVelocityError: null,
      meanOnsetIntervalMs: null,
      onsetJitterMs: null,
      meanNoteDurationMs: null,
    });
  });
});

test.describe('MIDI with support but no instrument', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMidi(page, { connected: false });
    await resetClientStudyState(page);
  });

  test('the setup page explains a missing instrument and gates on it', async ({ page }) => {
    await openStudyFromLanding(page, 'Demo Studies', 'MIDI Piano Input with Provenance');
    await nextClick(page);

    await expect(page.getByText('No instrument detected')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('midi-device-table')).toHaveCount(0);

    // Gating *is* right here, and matches the screen-recording library: the
    // participant can act on it by plugging something in.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText(/No MIDI instrument is connected yet/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No instrument detected')).toBeVisible();
  });

  test('an instrument that dies after setup does not trap the participant', async ({ page }) => {
    // reachFirstTrial attaches the instrument once the setup page is up, which is
    // all this needs: unplug before the trial and never play a note on it -- the
    // mid-study hardware failure case.
    await reachFirstTrial(page);
    await setConnected(page, false);
    await expect(page.getByTestId('midi-waiting')).toBeVisible({ timeout: 10000 });

    const before = page.url();
    await nextClick(page);
    await expect.poll(() => page.url(), { timeout: 15000 }).not.toBe(before);
  });
});

test.describe('MIDI stimulus with provenance and screen recording', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeMidi(page);
    await resetClientStudyState(page);
  });

  test('plays a melody and records right and wrong notes', async ({ page }) => {
    await reachFirstTrial(page);

    // The task starts on the first note of the melody as soon as the instrument
    // is seen -- no arming gesture, unlike a gamepad.
    await expect(page.getByTestId('midi-prompt')).toHaveText(noteName(MELODY[0]));

    // A wrong note counts as a miss and leaves the prompt where it is.
    await playNote(page, MELODY[0] + 1, 80);
    await expect(page.getByTestId('midi-misses')).toHaveText('1');
    await expect(page.getByTestId('midi-hits')).toHaveText('0');
    await expect(page.getByTestId('midi-prompt')).toHaveText(noteName(MELODY[0]));
    await expect(page.getByTestId('midi-outcome')).toContainText('Miss');

    // Velocity is reported per note, which a button simply cannot do.
    await expect(page.getByTestId('midi-last-velocity')).toHaveText('80');

    // Now play the melody correctly.
    for (let index = 0; index < MELODY.length; index += 1) {
      await expect(page.getByTestId('midi-prompt')).toHaveText(noteName(MELODY[index]), { timeout: 10000 });
      await playNote(page, MELODY[index], TARGET_VELOCITY);
      await expect(page.getByTestId('midi-hits')).toHaveText(String(index + 1), { timeout: 10000 });
    }

    await expect(page.getByTestId('midi-outcome')).toContainText('melody complete');

    // Inter-onset intervals come from the MIDI message timestamps, so they carry
    // sub-millisecond detail rather than being rounded to a frame boundary.
    await expect(page.getByTestId('midi-interval')).toContainText(/\d+\.\d{2} ms/);

    // The reactive responses in the sidebar mirror the task's own tally.
    const listItems = page.getByRole('listitem');
    await expect(listItems.filter({ hasText: String(MELODY.length) }).first()).toBeVisible({ timeout: 10000 });
  });

  test('lights up the key that is played, in its pitch-class color', async ({ page }) => {
    await reachFirstTrial(page);

    const keyboard = page.getByTestId('midi-keyboard').last();
    await expect(keyboard).toBeVisible();

    const key = keyboard.getByTestId(`midi-key-${MELODY[0]}`);
    await expect(key).toHaveAttribute('data-active', 'false');

    await sendMidi(page, [NOTE_ON, MELODY[0], 120]);
    await expect(key).toHaveAttribute('data-active', 'true');
    // The same color the provenance timeline will use for this note.
    await expect(key).toHaveAttribute('fill', PITCH_CLASS_COLORS.c);

    await sendMidi(page, [NOTE_OFF, MELODY[0], 0]);
    await expect(key).toHaveAttribute('data-active', 'false');
  });

  test('stores MIDI telemetry and note-colored provenance', async ({ page }) => {
    await reachFirstTrial(page);

    // A pedal press, to confirm control changes are captured alongside notes.
    await sendMidi(page, [CONTROL_CHANGE, SUSTAIN_PEDAL, 127]);
    await page.waitForTimeout(50);
    await sendMidi(page, [CONTROL_CHANGE, SUSTAIN_PEDAL, 0]);

    // Two correct notes, then a wrong one, at distinguishable velocities.
    await playNote(page, MELODY[0], 40);
    await expect(page.getByTestId('midi-hits')).toHaveText('1', { timeout: 10000 });
    await playNote(page, MELODY[1], 110);
    await expect(page.getByTestId('midi-hits')).toHaveText('2', { timeout: 10000 });
    await playNote(page, MELODY[1] + 1, 90);
    await expect(page.getByTestId('midi-misses')).toHaveText('1', { timeout: 10000 });

    // `mididevice` is recorded when the device list actually changes, so it lands
    // on whichever component was active at the time -- unplugging here is what
    // puts one on this trial. (The instrument's identity for the whole session is
    // on the setup component's hidden response instead.)
    await setConnected(page, false);
    await expect(page.getByTestId('midi-waiting')).toBeVisible({ timeout: 10000 });
    await setConnected(page, true);
    await expect(page.getByTestId('midi-waiting')).toBeHidden({ timeout: 10000 });

    // Answers, windowEvents and provenance are flushed when the component advances.
    await nextClick(page);
    await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });

    // Writes are debounced, so wait for the trial to land in storage.
    await expect.poll(
      async () => (await readStoredTrial(page, 'midi-scale')).windowEventKinds,
      { timeout: 30000 },
    ).toEqual(expect.arrayContaining(['mididevice', 'midinoteon', 'midinoteoff', 'midicc']));

    await expect.poll(
      async () => (await readStoredTrial(page, 'midi-scale')).nodeActionTypes.length,
      { timeout: 30000 },
    ).toBeGreaterThan(0);

    const stored = await readStoredTrial(page, 'midi-scale');

    // windowEvents carries note number and velocity, unthrottled: a keyboard
    // emits one event per note, so there is nothing to sample or drop.
    expect(stored.noteOnPayloads).toEqual(expect.arrayContaining([
      [MELODY[0], 40],
      [MELODY[1], 110],
      [MELODY[1] + 1, 90],
    ]));

    // The pedal's 127 and its 0 both survive, because switch-style controllers
    // bypass the control-change throttle.
    expect(stored.controlChangePayloads).toEqual(expect.arrayContaining([
      [SUSTAIN_PEDAL, 127],
      [SUSTAIN_PEDAL, 0],
    ]));

    // The semantic channel records notes under the action types the analysis
    // timeline colors by.
    expect(stored.nodeActionTypes).toEqual(expect.arrayContaining(['midi-prompt-note']));
    const noteTypes = stored.nodeActionTypes.filter((type) => type.startsWith('midi-note-'));
    expect(noteTypes.length).toBeGreaterThanOrEqual(3);
    expect(noteTypes).toEqual(expect.arrayContaining([
      midiNoteActionType(MELODY[0]),
      midiNoteActionType(MELODY[1]),
      midiNoteActionType(MELODY[1] + 1),
    ]));

    // Each note resolves to its own pitch class's color rather than a hashed one,
    // and the prompts stay hashed so they read as scaffolding.
    const noteColors = new Set(noteTypes.map((type) => getColorForKey(normalizeActionName(type))));
    noteColors.forEach((color) => {
      expect(Object.values(PITCH_CLASS_COLORS)).toContain(color);
    });
    expect(getColorForKey(normalizeActionName('midi-prompt-note'))).toMatch(/^hsl\(/);

    // Velocity and timing made it into the answer, from the MIDI clock.
    expect(stored.answer.meanVelocityError).toEqual(expect.any(Number));
    expect(stored.answer.meanOnsetIntervalMs).toEqual(expect.any(Number));
    expect(stored.answer.meanNoteDurationMs).toEqual(expect.any(Number));
  });

  test('never throttles or coalesces note events, however fast they arrive', async ({ page }) => {
    await reachFirstTrial(page);

    // A fast passage, well inside one windowEventDebounceTime (100ms). Every one
    // of these is a distinct musical event and all of them must be recorded --
    // merging two notes is not a lossy sample, it is a wrong transcription.
    const burst = [60, 62, 64, 65, 67, 69, 71, 72];
    for (let index = 0; index < burst.length; index += 1) {
      await sendMidi(page, [NOTE_ON, burst[index], 60 + index]);
      await sendMidi(page, [NOTE_OFF, burst[index], 0]);
    }

    await nextClick(page);
    await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });

    await expect.poll(
      async () => (await readStoredTrial(page, 'midi-scale')).noteOnPayloads.length,
      { timeout: 30000 },
    ).toBeGreaterThanOrEqual(burst.length);

    const stored = await readStoredTrial(page, 'midi-scale');
    // Every note, with its own velocity, in order.
    expect(stored.noteOnPayloads).toEqual(expect.arrayContaining(
      burst.map((note, index) => [note, 60 + index]),
    ));
    expect(stored.noteOffPayloads.length).toBeGreaterThanOrEqual(burst.length);
  });

  test('a control-change sweep keeps its final resting value', async ({ page }) => {
    await reachFirstTrial(page);

    // A mod-wheel sweep that starts and ends inside one throttle window. A
    // leading-edge throttle would record only the 20 and leave the stored stream
    // claiming the wheel sat there forever -- the axis-throttle bug upstream
    // review found in the gamepad work. The newest value must win instead.
    const MOD_WHEEL = 1;
    for (const value of [20, 44, 68, 92, 64]) {
      await sendMidi(page, [CONTROL_CHANGE, MOD_WHEEL, value]);
    }

    await nextClick(page);
    await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });

    await expect.poll(
      async () => (await readStoredTrial(page, 'midi-scale')).controlChangePayloads.length,
      { timeout: 30000 },
    ).toBeGreaterThan(0);

    const wheel = (await readStoredTrial(page, 'midi-scale')).controlChangePayloads
      .filter((payload) => payload[0] === MOD_WHEEL);

    // Coalesced, so the whole sweep need not be present...
    expect(wheel.length).toBeGreaterThan(0);
    // ...but where the wheel actually came to rest must be.
    expect(wheel[wheel.length - 1]).toEqual([MOD_WHEEL, 64]);
  });

  test('a long pause is kept out of the timing aggregates', async ({ page }) => {
    await reachFirstTrial(page);

    // Two notes close together, then a gap longer than a musical interval, then
    // two more. An unclamped mean would be dominated by the gap.
    await playNote(page, MELODY[0], TARGET_VELOCITY);
    await expect(page.getByTestId('midi-hits')).toHaveText('1', { timeout: 10000 });
    await playNote(page, MELODY[1], TARGET_VELOCITY);
    await expect(page.getByTestId('midi-hits')).toHaveText('2', { timeout: 10000 });

    await page.waitForTimeout(5200);

    await playNote(page, MELODY[2], TARGET_VELOCITY);
    await expect(page.getByTestId('midi-hits')).toHaveText('3', { timeout: 10000 });
    await playNote(page, MELODY[3], TARGET_VELOCITY);
    await expect(page.getByTestId('midi-hits')).toHaveText('4', { timeout: 10000 });

    await nextClick(page);
    await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });

    // Poll on the type, not on not-null: an answer that has not landed yet reads
    // as undefined, which would satisfy a not-null assertion and then fail below.
    await expect.poll(
      async () => typeof (await readStoredTrial(page, 'midi-scale')).answer.meanOnsetIntervalMs,
      { timeout: 30000 },
    ).toBe('number');

    const { answer } = await readStoredTrial(page, 'midi-scale');
    // Three gaps were produced: two of a few hundred ms and one of 5.2s. With the
    // 5.2s one excluded the mean stays near the fast notes; including it would put
    // the mean around 2000ms, so this threshold is what distinguishes the two.
    expect(answer.meanOnsetIntervalMs as number).toBeLessThan(1000);
    expect(answer.meanOnsetIntervalMs as number).toBeGreaterThan(0);
  });

  test('recovers when the instrument is unplugged mid-trial', async ({ page }) => {
    await reachFirstTrial(page);

    await setConnected(page, false);
    await expect(page.getByTestId('midi-waiting')).toBeVisible({ timeout: 10000 });

    await setConnected(page, true);
    await expect(page.getByTestId('midi-waiting')).toBeHidden({ timeout: 10000 });

    // Still playable after the round trip.
    await playNote(page, MELODY[0], TARGET_VELOCITY);
    await expect(page.getByTestId('midi-hits')).toHaveText('1', { timeout: 10000 });
  });
});
