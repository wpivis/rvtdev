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

/**
 * Installs a synthetic MIDI instrument plus a fake screen-capture stream.
 *
 * A real piano cannot be attached to a headless browser, so this replaces
 * `navigator.requestMIDIAccess` with a port the test drives. The page subscribes
 * to that port exactly as it would a real device -- the event's own `timeStamp`
 * comes from the browser, not from the fake -- so everything above the Web MIDI
 * boundary is the production code path.
 */
async function installFakeMidi(page: Page) {
  await page.addInitScript(() => {
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
    let connected = true;

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

    if (navigator.mediaDevices) {
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
    }
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

  await expect(page.getByTestId('midi-prompt')).toBeVisible({ timeout: 15000 });
}

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
