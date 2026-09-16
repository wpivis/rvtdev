import type { Clause, LegalDocument } from './documents';

/**
 * The state the analysis view replays.
 *
 * Everything the stimulus draws is derived from this object, so scrubbing the
 * replay timeline reproduces what the participant was looking at: where they had
 * scrolled, which clause they were dwelling on, what they had searched for, and
 * which clauses they had flagged at that moment.
 *
 * It deliberately holds *semantic* review state rather than raw input. The mouse
 * path and every scroll tick are already captured in `windowEvents` and in the
 * screen recording; duplicating them here would bury the handful of nodes an
 * analyst actually cares about under thousands of pixel deltas.
 */
export interface DocumentReviewState {
  /** Index of the topmost clause in the viewport. */
  topClause: number;
  /** Scroll offset in pixels, so replay can restore the exact viewport. */
  scrollTop: number;
  /** Clause the pointer has rested on past the dwell threshold, or null. */
  dwellClause: number | null;
  /** Current contents of the search box. */
  query: string;
  /** Indices of clauses matching `query`, in document order. */
  matches: number[];
  /** Position within `matches` of the clause the participant jumped to, or -1. */
  activeMatch: number;
  /** Indices of flagged clauses, in the order they were flagged. */
  flagged: number[];
  /** Note text per flagged clause, keyed by clause index as a string. */
  notes: Record<string, string>;
  /** The most recent passage the participant selected with the cursor. */
  selection: { clause: number; text: string } | null;
  /** Set when the participant explicitly reports finding nothing to flag. */
  noConcerns: boolean;
}

export const INITIAL_DOCUMENT_REVIEW_STATE: DocumentReviewState = {
  topClause: 0,
  scrollTop: 0,
  dwellClause: null,
  query: '',
  matches: [],
  activeMatch: -1,
  flagged: [],
  notes: {},
  selection: null,
  noConcerns: false,
};

/** Longest passage recorded for a selection, so a select-all cannot bloat provenance. */
export const MAX_SELECTION_LENGTH = 300;

function clauseHaystack(clause: Clause): string {
  return `${clause.number} ${clause.heading} ${clause.text}`.toLowerCase();
}

/**
 * Indices of clauses containing `query`, case-insensitively. A blank or
 * whitespace-only query matches nothing rather than everything, so clearing the
 * search box clears the highlights.
 */
export function findMatchingClauses(clauses: Clause[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  return clauses.reduce<number[]>((acc, clause, index) => {
    if (clauseHaystack(clause).includes(needle)) {
      acc.push(index);
    }
    return acc;
  }, []);
}

export interface TextSegment {
  text: string;
  isMatch: boolean;
}

/**
 * Splits `text` into alternating plain and matching segments so the clause can be
 * rendered with the search term highlighted. Returns a single non-matching segment
 * when the query is blank, which is the common case.
 */
export function splitOnQuery(text: string, query: string): TextSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [{ text, isMatch: false }];
  }

  const segments: TextSegment[] = [];
  const haystack = text.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      segments.push({ text: text.slice(cursor), isMatch: false });
      break;
    }
    if (hit > cursor) {
      segments.push({ text: text.slice(cursor, hit), isMatch: false });
    }
    segments.push({ text: text.slice(hit, hit + needle.length), isMatch: true });
    cursor = hit + needle.length;
  }

  return segments;
}

/**
 * Slack allowed when comparing a clause offset against `scrollTop`.
 *
 * Browsers report `scrollTop` fractionally on fractional-DPI displays, so jumping
 * to a clause by assigning `scrollTop = offsetTop` can land at 399.5 for a
 * requested 400. Without this the jump would report the *previous* clause.
 */
export const SCROLL_TOLERANCE_PX = 1;

/**
 * Index of the topmost clause whose start has reached the viewport top. Clauses
 * taller than the viewport keep reporting themselves until the next one scrolls in,
 * which is what an analyst means by "the clause they were on".
 */
export function topVisibleClause(offsets: number[], scrollTop: number): number {
  let top = 0;
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i] <= scrollTop + SCROLL_TOLERANCE_PX) {
      top = i;
    } else {
      break;
    }
  }
  return top;
}

/** Steps through the match list, wrapping at both ends. Returns -1 when there is nothing to step through. */
export function stepMatch(matches: number[], activeMatch: number, direction: 1 | -1): number {
  if (matches.length === 0) {
    return -1;
  }
  if (activeMatch < 0) {
    return direction === 1 ? 0 : matches.length - 1;
  }
  return (activeMatch + direction + matches.length) % matches.length;
}

export function applyScroll(state: DocumentReviewState, payload: { topClause: number; scrollTop: number }): DocumentReviewState {
  return { ...state, topClause: payload.topClause, scrollTop: payload.scrollTop };
}

export function applyDwell(state: DocumentReviewState, clause: number | null): DocumentReviewState {
  return { ...state, dwellClause: clause };
}

export function applySearch(state: DocumentReviewState, payload: { query: string; matches: number[] }): DocumentReviewState {
  return {
    ...state, query: payload.query, matches: payload.matches, activeMatch: -1,
  };
}

export function applySearchNav(state: DocumentReviewState, activeMatch: number): DocumentReviewState {
  return { ...state, activeMatch };
}

export function applySelect(state: DocumentReviewState, selection: { clause: number; text: string } | null): DocumentReviewState {
  return { ...state, selection };
}

/**
 * Flags or unflags a clause. Flagging anything clears the "no concerns" report,
 * since the two answers contradict each other.
 */
export function applyFlagToggle(state: DocumentReviewState, clause: number): DocumentReviewState {
  const isFlagged = state.flagged.includes(clause);
  if (isFlagged) {
    const notes = { ...state.notes };
    delete notes[String(clause)];
    return { ...state, flagged: state.flagged.filter((index) => index !== clause), notes };
  }
  return { ...state, flagged: [...state.flagged, clause], noConcerns: false };
}

export function applyNote(state: DocumentReviewState, payload: { clause: number; note: string }): DocumentReviewState {
  return { ...state, notes: { ...state.notes, [String(payload.clause)]: payload.note } };
}

/** Records "I read it and found nothing worth flagging", which only makes sense with no flags outstanding. */
export function applyNoConcerns(state: DocumentReviewState): DocumentReviewState {
  return { ...state, flagged: [], notes: {}, noConcerns: true };
}

export interface DocumentReviewAnswer {
  /** Section numbers as printed in the document, e.g. ["5", "8", "11"]. */
  flaggedClauses: string[];
  /** Notes keyed by the same printed section numbers. */
  clauseNotes: Record<string, string>;
  noConcerns: boolean;
}

/** The slice of review state that makes up the trial's answer. */
export type ReviewAnswerState = Pick<DocumentReviewState, 'flagged' | 'notes' | 'noConcerns'>;

export function buildReviewAnswer(state: ReviewAnswerState, document: LegalDocument): DocumentReviewAnswer {
  const clauseNotes: Record<string, string> = {};
  state.flagged.forEach((index) => {
    const note = state.notes[String(index)];
    if (note && note.trim().length > 0) {
      clauseNotes[document.clauses[index].number] = note.trim();
    }
  });

  return {
    flaggedClauses: state.flagged.map((index) => document.clauses[index].number),
    clauseNotes,
    noConcerns: state.noConcerns,
  };
}

/** A trial is answerable once the participant has flagged something or said there is nothing to flag. */
export function isReviewComplete(state: ReviewAnswerState): boolean {
  return state.flagged.length > 0 || state.noConcerns;
}
