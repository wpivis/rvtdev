/**
 * Action names the document-review stimulus registers with Trrack, and the color
 * each one is painted in the analysis replay timeline.
 *
 * Provenance nodes are otherwise colored by hashing the action name, which keeps
 * action types distinguishable but arbitrary. Review behaviour reads better with a
 * fixed mapping: flagging a clause is the event an analyst scrubs a session for, so
 * it is the only red on the timeline, while ambient reading (scroll, dwell) sits in
 * cooler, lower-contrast colors that do not compete with it.
 *
 * These live in `src/utils` rather than beside the study because
 * `src/components/audioAnalysis/provenanceColors.ts` consumes them, and core
 * analysis code should not import out of `src/public`.
 */
export const DOCUMENT_REVIEW_ACTIONS = {
  scroll: 'docReviewScroll',
  dwell: 'docReviewDwell',
  search: 'docReviewSearch',
  searchNav: 'docReviewSearchNav',
  select: 'docReviewSelect',
  flag: 'docReviewFlag',
  unflag: 'docReviewUnflag',
  note: 'docReviewNote',
  noConcerns: 'docReviewNoConcerns',
} as const;

export type DocumentReviewAction = typeof DOCUMENT_REVIEW_ACTIONS[keyof typeof DOCUMENT_REVIEW_ACTIONS];

export const DOCUMENT_REVIEW_ACTION_COLORS: Record<DocumentReviewAction, string> = {
  [DOCUMENT_REVIEW_ACTIONS.scroll]: '#aab4c2',
  [DOCUMENT_REVIEW_ACTIONS.dwell]: '#6cc5b0',
  [DOCUMENT_REVIEW_ACTIONS.search]: '#a463f2',
  [DOCUMENT_REVIEW_ACTIONS.searchNav]: '#c6a4f5',
  [DOCUMENT_REVIEW_ACTIONS.select]: '#4269d0',
  [DOCUMENT_REVIEW_ACTIONS.flag]: '#e5484d',
  [DOCUMENT_REVIEW_ACTIONS.unflag]: '#f0a6a8',
  [DOCUMENT_REVIEW_ACTIONS.note]: '#ff8f3c',
  [DOCUMENT_REVIEW_ACTIONS.noConcerns]: '#3ca951',
};
