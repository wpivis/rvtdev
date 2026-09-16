import { MantineProvider } from '@mantine/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import DocumentReviewTask from '../DocumentReviewTask';
import { DOCUMENTS } from '../documents';
import { DOCUMENT_REVIEW_ACTIONS } from '../../../../utils/documentReviewActions';
import { INITIAL_DOCUMENT_REVIEW_STATE, type DocumentReviewState } from '../documentReviewState';

// Search and note entry are debounced in the component; running them through
// synchronously keeps these tests about behaviour rather than about timers.
vi.mock('lodash.debounce', () => ({
  default: (fn: (...args: unknown[]) => unknown) => Object.assign(
    (...args: unknown[]) => fn(...args),
    // Calling through immediately leaves nothing pending, so both are no-ops.
    { cancel: () => {}, flush: () => {} },
  ),
}));

const NDA = DOCUMENTS['mutual-nda'];

/** Action type recorded for the nth Trrack node, as the analysis view would read it. */
function appliedActionTypes(apply: ReturnType<typeof vi.fn>): string[] {
  return apply.mock.calls.map(([, action]) => (action as { type: string }).type);
}

function appliedLabels(apply: ReturnType<typeof vi.fn>): string[] {
  return apply.mock.calls.map(([label]) => label as string);
}

function renderTask({
  provenanceState,
  documentId = 'mutual-nda',
}: { provenanceState?: DocumentReviewState; documentId?: string } = {}) {
  const apply = vi.fn();
  const setAnswer = vi.fn();
  const useTrrack = vi.fn(() => ({ apply })) as never;

  const utils = render(
    <MantineProvider>
      <DocumentReviewTask
        parameters={{ documentId, dwellMs: 10 }}
        answers={{}}
        provenanceState={provenanceState}
        setAnswer={setAnswer}
        useTrrack={useTrrack}
      />
    </MantineProvider>,
  );

  return { ...utils, apply, setAnswer };
}

describe('DocumentReviewTask', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('renders the configured document, its brief and every clause', () => {
    const { getByText, getByTestId } = renderTask();

    expect(getByText(NDA.title)).toBeTruthy();
    expect(getByText(NDA.brief)).toBeTruthy();
    NDA.clauses.forEach((clause) => {
      expect(getByTestId(`doc-review-clause-${clause.number}`)).toBeTruthy();
    });
  });

  test('tells the study designer when the configured document does not exist', () => {
    const { getByText } = renderTask({ documentId: 'not-a-document' });
    expect(getByText(/No document configured for id "not-a-document"/)).toBeTruthy();
  });

  test('a trial is unanswerable until the participant flags something', async () => {
    const { setAnswer } = renderTask();
    await waitFor(() => expect(setAnswer).toHaveBeenCalled());
    expect(setAnswer.mock.calls[0][0]).toMatchObject({
      status: false,
      answers: { flaggedClauses: [], clauseNotes: {}, noConcerns: false },
    });
  });

  test('flagging a clause records a flag node and answers with its section number', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, setAnswer } = renderTask();

    await user.click(getByTestId('doc-review-flag-8'));

    expect(appliedActionTypes(apply)).toEqual([DOCUMENT_REVIEW_ACTIONS.flag]);
    expect(appliedLabels(apply)).toEqual(['Flag §8']);
    expect(getByTestId('doc-review-flag-count').textContent).toBe('1 flagged');
    await waitFor(() => expect(setAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: true,
        answers: expect.objectContaining({ flaggedClauses: ['8'] }),
      }),
    ));
  });

  test('unflagging records an unflag node and empties the answer again', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, setAnswer } = renderTask();

    await user.click(getByTestId('doc-review-flag-8'));
    await user.click(getByTestId('doc-review-flag-8'));

    expect(appliedActionTypes(apply)).toEqual([
      DOCUMENT_REVIEW_ACTIONS.flag,
      DOCUMENT_REVIEW_ACTIONS.unflag,
    ]);
    await waitFor(() => expect(setAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: false,
        answers: expect.objectContaining({ flaggedClauses: [] }),
      }),
    ));
  });

  test('a note field appears only once a clause is flagged, and its text reaches the answer', async () => {
    const user = userEvent.setup();
    const { getByTestId, queryByTestId, setAnswer } = renderTask();

    expect(queryByTestId('doc-review-note-8')).toBeNull();
    await user.click(getByTestId('doc-review-flag-8'));
    await user.type(getByTestId('doc-review-note-8'), 'residuals');

    await waitFor(() => expect(setAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({ clauseNotes: { 8: 'residuals' } }),
      }),
    ));
  });

  test('searching records the query and marks the matching text', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, container } = renderTask();

    await user.type(getByTestId('doc-review-search'), 'confidential');

    expect(appliedActionTypes(apply)).toContain(DOCUMENT_REVIEW_ACTIONS.search);
    expect(appliedLabels(apply)).toContain('Search "confidential"');
    // Asserted against the real clause list so a term absent from the document
    // cannot pass on the "No clauses" wording.
    expect(getByTestId('doc-review-match-count').textContent).toMatch(/^\d+ clauses?$/);
    expect(container.querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  test('clearing the search removes the highlights', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, container } = renderTask();

    await user.type(getByTestId('doc-review-search'), 'assign');
    expect(container.querySelectorAll('mark').length).toBeGreaterThan(0);

    await user.clear(getByTestId('doc-review-search'));

    expect(appliedLabels(apply)).toContain('Clear search');
    expect(container.querySelectorAll('mark').length).toBe(0);
    expect(getByTestId('doc-review-match-count').textContent).toBe('No clauses');
  });

  test('reporting no concerns answers the trial without any flags', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, setAnswer } = renderTask();

    await user.click(getByTestId('doc-review-no-concerns'));

    expect(appliedActionTypes(apply)).toEqual([DOCUMENT_REVIEW_ACTIONS.noConcerns]);
    await waitFor(() => expect(setAnswer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: true,
        answers: expect.objectContaining({ flaggedClauses: [], noConcerns: true }),
      }),
    ));
  });

  test('the no-concerns button is unavailable once something is flagged', async () => {
    const user = userEvent.setup();
    const { getByTestId } = renderTask();

    await user.click(getByTestId('doc-review-flag-8'));

    expect(getByTestId('doc-review-no-concerns').hasAttribute('disabled')).toBe(true);
  });

  test('replay draws the recorded state rather than a fresh trial', () => {
    const recorded: DocumentReviewState = {
      ...INITIAL_DOCUMENT_REVIEW_STATE,
      query: 'assign',
      matches: [10],
      flagged: [7, 10],
      notes: { 7: 'residuals clause', 10: 'one-way assignment' },
    };
    const { getByTestId, container } = renderTask({ provenanceState: recorded });

    expect(getByTestId('doc-review-flag-count').textContent).toBe('2 flagged');
    expect((getByTestId('doc-review-search') as HTMLInputElement).value).toBe('assign');
    expect((getByTestId('doc-review-note-8') as HTMLTextAreaElement).value).toBe('residuals clause');
    expect((getByTestId('doc-review-note-11') as HTMLTextAreaElement).value).toBe('one-way assignment');
    expect(container.querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  test('replay never records provenance or answers back over the recording', async () => {
    const user = userEvent.setup();
    const { getByTestId, apply, setAnswer } = renderTask({
      provenanceState: { ...INITIAL_DOCUMENT_REVIEW_STATE, flagged: [7] },
    });

    await user.click(getByTestId('doc-review-flag-1'));
    await user.type(getByTestId('doc-review-search'), 'liability');

    expect(apply).not.toHaveBeenCalled();
    expect(setAnswer).not.toHaveBeenCalled();
  });
});
