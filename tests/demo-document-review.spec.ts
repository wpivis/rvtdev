import { expect, Page, test } from '@playwright/test';
import {
  nextClick,
  readStoredValue,
  resetClientStudyState,
  seekReplay,
  waitForStudyEndMessage,
} from './utils';

// demo-document-review gates its first task behind the screen-recording
// permission component, which needs real screen capture and detected sound.
// test-document-review is the same stimulus with recording turned off.
const STUDY_ID = 'test-document-review';

interface StoredParticipantAnswer {
  componentName?: string;
  answer?: Record<string, unknown>;
  startTime?: number;
  endTime?: number;
}

async function readParticipantId(page: Page): Promise<string> {
  const assignments = await readStoredValue<Record<string, unknown>>(
    page,
    `dev-${STUDY_ID}/sequenceAssignment`,
  );
  return Object.keys(assignments ?? {})[0] ?? '';
}

/** Finds a component's stored answer by componentName, so the test does not depend on identifier formatting. */
async function readAnswerFor(page: Page, componentName: string): Promise<StoredParticipantAnswer | null> {
  const participantId = await readParticipantId(page);
  if (!participantId) {
    return null;
  }
  const participant = await readStoredValue<{ answers?: Record<string, StoredParticipantAnswer> }>(
    page,
    `dev-${STUDY_ID}/participants/${participantId}_participantData`,
  );
  const answer = Object.values(participant?.answers ?? {})
    .find((candidate) => candidate.componentName === componentName);
  return answer ?? null;
}

/**
 * Trrack action names recorded for a task, read straight out of the stored
 * provenance the analysis view replays from.
 *
 * Provenance is saved under its own key (`.../provenance/<participant>_<task>_<index>`)
 * rather than inside participantData, so the store is scanned by key shape. A
 * registered state action lands in the node's `event`; `sideEffects.do` carries
 * only true side effects and is empty for these, which is also the order
 * `getNodeColorKey` reads them in.
 */
async function readProvenanceActionTypes(page: Page, componentName: string): Promise<string[]> {
  return page.evaluate(async (task) => new Promise<string[]>((resolve) => {
    const request = indexedDB.open('revisit');
    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('keyvaluepairs')) {
        database.close();
        resolve([]);
        return;
      }
      const transaction = database.transaction('keyvaluepairs', 'readonly');
      const store = transaction.objectStore('keyvaluepairs');
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      keysRequest.onerror = () => resolve([]);
      valuesRequest.onerror = () => resolve([]);
      transaction.oncomplete = () => {
        database.close();
        const types: string[] = [];
        keysRequest.result.forEach((key, index) => {
          if (!String(key).includes('/provenance/') || !String(key).includes(task)) {
            return;
          }
          const stored = valuesRequest.result[index] as Record<string, {
            nodes?: Record<string, { event?: string; sideEffects?: { do?: { type?: string }[] } }>;
          }> | null;
          Object.values(stored ?? {}).forEach((graph) => {
            Object.values(graph?.nodes ?? {}).forEach((node) => {
              const sideEffectType = node.sideEffects?.do
                ?.find((effect) => typeof effect?.type === 'string')?.type;
              if (sideEffectType) {
                types.push(sideEffectType);
              } else if (typeof node.event === 'string') {
                types.push(node.event);
              }
            });
          });
        });
        resolve(types);
      };
    };
  }), componentName);
}

test('records reading, searching and flagging as provenance and answers', async ({ page }) => {
  await resetClientStudyState(page);
  await page.goto(`/${STUDY_ID}`);

  // ── Trial 1: the NDA ───────────────────────────────────────────────────────
  await expect(page.getByText('Mutual Non-Disclosure Agreement')).toBeVisible();
  const nextButton = page.getByRole('button', { name: 'Next', exact: true });

  // A trial cannot be left until the participant has reached a verdict.
  await nextButton.click();
  await expect(page.getByText(/Flag at least one clause/)).toBeVisible();
  await expect(page.getByText('Mutual Non-Disclosure Agreement')).toBeVisible();

  // Reading down the document past a clause boundary is what produces scroll nodes.
  const pane = page.getByTestId('doc-review-pane');
  await pane.evaluate((element) => { element.scrollTop = element.scrollHeight / 2; });

  // "residual" appears in exactly one clause of the NDA.
  await page.getByTestId('doc-review-search').fill('residual');
  await expect(page.getByTestId('doc-review-match-count')).toHaveText('1 clause');
  await page.getByTestId('doc-review-next-match').click();

  await page.getByTestId('doc-review-flag-8').click();
  await expect(page.getByTestId('doc-review-flag-count')).toHaveText('1 flagged');
  await page.getByTestId('doc-review-note-8').fill('Residuals clause swallows the whole NDA.');

  // The reactive sidebar response mirrors the flag.
  await expect(page.getByRole('listitem').filter({ hasText: '8' }).first()).toBeVisible();

  const replayPath = new URL(page.url()).pathname;
  await nextClick(page);

  // ── Trial 2: the MSA, which must start from a clean slate ──────────────────
  await expect(page.getByText('Master Services Agreement (Cloud Analytics Platform)')).toBeVisible();
  await expect(page.getByTestId('doc-review-flag-count')).toHaveText('0 flagged');
  await expect(page.getByTestId('doc-review-search')).toHaveValue('');

  await page.getByTestId('doc-review-flag-10').click();
  await nextClick(page);
  await waitForStudyEndMessage(page);

  // ── What was stored ───────────────────────────────────────────────────────
  await expect.poll(async () => (await readAnswerFor(page, 'review-nda'))?.answer?.flaggedClauses, {
    timeout: 15000,
  }).toEqual(['8']);

  const ndaAnswer = await readAnswerFor(page, 'review-nda');
  expect(ndaAnswer?.answer?.clauseNotes).toEqual({ 8: 'Residuals clause swallows the whole NDA.' });
  expect(ndaAnswer?.answer?.noConcerns).toBe(false);

  const msaAnswer = await readAnswerFor(page, 'review-msa');
  expect(msaAnswer?.answer?.flaggedClauses).toEqual(['10']);

  // The behaviours an analyst replays each reached the stored provenance.
  await expect.poll(async () => await readProvenanceActionTypes(page, 'review-nda'), {
    timeout: 15000,
  }).toEqual(expect.arrayContaining([
    'docReviewScroll',
    'docReviewSearch',
    'docReviewSearchNav',
    'docReviewFlag',
    'docReviewNote',
  ]));

  expect(replayPath).toBeTruthy();
});

test('replays a recorded review without writing over it', async ({ page }) => {
  await resetClientStudyState(page);
  await page.goto(`/${STUDY_ID}`);

  await expect(page.getByText('Mutual Non-Disclosure Agreement')).toBeVisible();
  const replayPath = new URL(page.url()).pathname;

  await page.getByTestId('doc-review-flag-5').click();
  await page.getByTestId('doc-review-note-5').fill('Perpetual survival with no carve-out.');
  await page.getByTestId('doc-review-flag-11').click();
  await expect(page.getByTestId('doc-review-flag-count')).toHaveText('2 flagged');
  await nextClick(page);

  await expect(page.getByText('Master Services Agreement (Cloud Analytics Platform)')).toBeVisible();
  await expect(page.getByTestId('doc-review-flag-count')).toHaveText('0 flagged');
  await page.getByTestId('doc-review-flag-10').click();
  await nextClick(page);
  await waitForStudyEndMessage(page);

  await expect.poll(async () => (await readAnswerFor(page, 'review-nda'))?.answer?.flaggedClauses, {
    timeout: 15000,
  }).toEqual(['5', '11']);

  const recorded = await readAnswerFor(page, 'review-nda');
  const participantId = await readParticipantId(page);
  const participantKey = `dev-${STUDY_ID}/participants/${participantId}_participantData`;
  const participantBeforeReplay = await readStoredValue(page, participantKey);

  await page.goto(`${replayPath}?participantId=${participantId}&revisitPageId=e2e-document-review-replay`);
  await expect(page.getByTestId('doc-review-pane')).toBeVisible();

  // Scrub to the end of the trial: by then both clauses had been flagged.
  await seekReplay(
    page,
    recorded?.startTime ?? 0,
    recorded?.endTime ?? 0,
    recorded?.endTime ?? 0,
  );

  await expect(page.getByTestId('doc-review-flag-count')).toHaveText('2 flagged');
  await expect(page.getByTestId('doc-review-note-5')).toHaveValue('Perpetual survival with no carve-out.');

  // Replaying is read-only.
  expect(await readStoredValue(page, participantKey)).toEqual(participantBeforeReplay);
});
