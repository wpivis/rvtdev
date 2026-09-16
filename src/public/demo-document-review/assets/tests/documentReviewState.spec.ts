import { describe, expect, test } from 'vitest';
import type { Clause } from '../documents';
import { DOCUMENTS } from '../documents';
import {
  applyDwell,
  applyFlagToggle,
  applyNoConcerns,
  applyNote,
  applyScroll,
  applySearch,
  applySearchNav,
  applySelect,
  buildReviewAnswer,
  findMatchingClauses,
  INITIAL_DOCUMENT_REVIEW_STATE,
  isReviewComplete,
  SCROLL_TOLERANCE_PX,
  splitOnQuery,
  stepMatch,
  topVisibleClause,
  type DocumentReviewState,
} from '../documentReviewState';

const clauses: Clause[] = [
  { number: '1', heading: 'Definitions', text: 'The Provider shall indemnify the Customer.' },
  { number: '2', heading: 'Indemnification', text: 'Nothing further is promised here.' },
  { number: '3', heading: 'Term', text: 'This renews automatically each year.' },
];

function state(overrides: Partial<DocumentReviewState> = {}): DocumentReviewState {
  return { ...INITIAL_DOCUMENT_REVIEW_STATE, ...overrides };
}

describe('findMatchingClauses', () => {
  test('matches clause text and headings case-insensitively', () => {
    expect(findMatchingClauses(clauses, 'INDEMNIF')).toEqual([0, 1]);
  });

  test('matches the printed section number', () => {
    expect(findMatchingClauses(clauses, '3')).toEqual([2]);
  });

  test('a blank query matches nothing rather than everything', () => {
    expect(findMatchingClauses(clauses, '')).toEqual([]);
    expect(findMatchingClauses(clauses, '   ')).toEqual([]);
  });

  test('returns matches in document order', () => {
    expect(findMatchingClauses(clauses, 'e')).toEqual([0, 1, 2]);
  });
});

describe('splitOnQuery', () => {
  test('returns a single plain segment when the query is blank', () => {
    expect(splitOnQuery('Some text', '  ')).toEqual([{ text: 'Some text', isMatch: false }]);
  });

  test('marks every occurrence and preserves the original casing', () => {
    expect(splitOnQuery('Fee fi FEE fo', 'fee')).toEqual([
      { text: 'Fee', isMatch: true },
      { text: ' fi ', isMatch: false },
      { text: 'FEE', isMatch: true },
      { text: ' fo', isMatch: false },
    ]);
  });

  test('handles a match at the very start and end', () => {
    expect(splitOnQuery('abcab', 'ab')).toEqual([
      { text: 'ab', isMatch: true },
      { text: 'c', isMatch: false },
      { text: 'ab', isMatch: true },
    ]);
  });

  test('rejoins to the original text whatever the query', () => {
    const text = clauses[0].text;
    expect(splitOnQuery(text, 'the').map((segment) => segment.text).join('')).toBe(text);
  });

  test('returns no segments for empty text', () => {
    expect(splitOnQuery('', 'fee')).toEqual([]);
  });
});

describe('topVisibleClause', () => {
  const offsets = [0, 100, 250, 400];

  test('reports the first clause at the top of the document', () => {
    expect(topVisibleClause(offsets, 0)).toBe(0);
  });

  test('reports a clause once its start has scrolled to the top', () => {
    expect(topVisibleClause(offsets, 100)).toBe(1);
    expect(topVisibleClause(offsets, 260)).toBe(2);
  });

  test('keeps reporting a tall clause until the next one arrives', () => {
    expect(topVisibleClause(offsets, 400 - SCROLL_TOLERANCE_PX - 1)).toBe(2);
    expect(topVisibleClause(offsets, 400)).toBe(3);
  });

  test('absorbs the fractional scrollTop a jump to a clause can land on', () => {
    expect(topVisibleClause(offsets, 400 - SCROLL_TOLERANCE_PX)).toBe(3);
  });

  test('clamps to the last clause past the end of the document', () => {
    expect(topVisibleClause(offsets, 10_000)).toBe(3);
  });

  test('handles an empty document', () => {
    expect(topVisibleClause([], 0)).toBe(0);
  });
});

describe('stepMatch', () => {
  test('returns -1 when there are no matches', () => {
    expect(stepMatch([], -1, 1)).toBe(-1);
  });

  test('starts at the first match going forward and the last going back', () => {
    expect(stepMatch([2, 5, 9], -1, 1)).toBe(0);
    expect(stepMatch([2, 5, 9], -1, -1)).toBe(2);
  });

  test('wraps at both ends', () => {
    expect(stepMatch([2, 5, 9], 2, 1)).toBe(0);
    expect(stepMatch([2, 5, 9], 0, -1)).toBe(2);
  });
});

describe('state transitions', () => {
  test('applyScroll records the clause and the exact offset', () => {
    expect(applyScroll(state(), { topClause: 2, scrollTop: 431 }))
      .toMatchObject({ topClause: 2, scrollTop: 431 });
  });

  test('applyDwell can both set and clear the attended clause', () => {
    expect(applyDwell(state(), 4).dwellClause).toBe(4);
    expect(applyDwell(state({ dwellClause: 4 }), null).dwellClause).toBeNull();
  });

  test('applySearch resets the active match so navigation restarts', () => {
    const next = applySearch(state({ activeMatch: 2 }), { query: 'fee', matches: [0, 3] });
    expect(next).toMatchObject({ query: 'fee', matches: [0, 3], activeMatch: -1 });
  });

  test('applySearchNav moves only the active match', () => {
    const next = applySearchNav(state({ matches: [0, 3] }), 1);
    expect(next).toMatchObject({ matches: [0, 3], activeMatch: 1 });
  });

  test('applySelect stores the passage and its clause', () => {
    const next = applySelect(state(), { clause: 1, text: 'indemnify' });
    expect(next.selection).toEqual({ clause: 1, text: 'indemnify' });
  });

  test('applyFlagToggle adds a clause and keeps flag order', () => {
    const next = applyFlagToggle(applyFlagToggle(state(), 2), 0);
    expect(next.flagged).toEqual([2, 0]);
  });

  test('applyFlagToggle removes a flag and drops its note', () => {
    const flagged = applyNote(applyFlagToggle(state(), 2), { clause: 2, note: 'perpetual' });
    const next = applyFlagToggle(flagged, 2);
    expect(next.flagged).toEqual([]);
    expect(next.notes).toEqual({});
  });

  test('flagging clears a previous no-concerns report', () => {
    const next = applyFlagToggle(state({ noConcerns: true }), 1);
    expect(next.noConcerns).toBe(false);
    expect(next.flagged).toEqual([1]);
  });

  test('applyNoConcerns clears flags and notes', () => {
    const flagged = applyNote(applyFlagToggle(state(), 1), { clause: 1, note: 'one-sided' });
    const next = applyNoConcerns(flagged);
    expect(next).toMatchObject({ flagged: [], notes: {}, noConcerns: true });
  });

  test('transitions never mutate the state they are given', () => {
    const before = state({ flagged: [1], notes: { 1: 'a' } });
    const snapshot = structuredClone(before);
    applyFlagToggle(before, 2);
    applyNote(before, { clause: 1, note: 'b' });
    applyNoConcerns(before);
    applyScroll(before, { topClause: 3, scrollTop: 9 });
    expect(before).toEqual(snapshot);
  });
});

describe('buildReviewAnswer', () => {
  const document = DOCUMENTS['mutual-nda'];

  test('reports flagged clauses by their printed section number, in flag order', () => {
    const reviewed = applyFlagToggle(applyFlagToggle(state(), 7), 4);
    expect(buildReviewAnswer(reviewed, document).flaggedClauses).toEqual(['8', '5']);
  });

  test('keys notes by printed section number and trims them', () => {
    const reviewed = applyNote(applyFlagToggle(state(), 7), { clause: 7, note: '  residuals  ' });
    expect(buildReviewAnswer(reviewed, document).clauseNotes).toEqual({ 8: 'residuals' });
  });

  test('drops notes left blank', () => {
    const reviewed = applyNote(applyFlagToggle(state(), 7), { clause: 7, note: '   ' });
    expect(buildReviewAnswer(reviewed, document).clauseNotes).toEqual({});
  });

  test('ignores notes left behind on clauses that are no longer flagged', () => {
    const reviewed = { ...state({ flagged: [], notes: { 7: 'stale' } }) };
    expect(buildReviewAnswer(reviewed, document).clauseNotes).toEqual({});
  });
});

describe('isReviewComplete', () => {
  test('a fresh trial is not answerable', () => {
    expect(isReviewComplete(state())).toBe(false);
  });

  test('one flag is enough', () => {
    expect(isReviewComplete(state({ flagged: [3] }))).toBe(true);
  });

  test('so is an explicit no-concerns report', () => {
    expect(isReviewComplete(state({ noConcerns: true }))).toBe(true);
  });
});
