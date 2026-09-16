import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Badge, Box, Button, Group, Paper, Stack, Text, Textarea, TextInput,
} from '@mantine/core';
import {
  IconChevronDown, IconChevronUp, IconFlag, IconFlagFilled, IconSearch, IconX,
} from '@tabler/icons-react';
import { Registry } from '@trrack/core';
import debounce from 'lodash.debounce';
import type { StimulusParams } from '../../../store/types';
import { DOCUMENT_REVIEW_ACTIONS } from '../../../utils/documentReviewActions';
import { getDocument } from './documents';
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
  MAX_SELECTION_LENGTH,
  splitOnQuery,
  stepMatch,
  topVisibleClause,
  type DocumentReviewState,
} from './documentReviewState';

interface DocumentReviewParams {
  /** Which fabricated contract to show; see `documents.ts`. */
  documentId?: string;
  /** How long the pointer must rest on a clause before it counts as a dwell, in ms. */
  dwellMs?: number;
  /** Height of the scrolling document pane, in px. */
  paneHeight?: number;
}

const DEFAULT_DWELL_MS = 600;
const DEFAULT_PANE_HEIGHT = 520;
const SEARCH_DEBOUNCE_MS = 400;
const NOTE_DEBOUNCE_MS = 600;
const INCOMPLETE_MESSAGE = 'Flag at least one clause, or use the button below the document to report that nothing concerns you.';

/** Walks up from a selection anchor to the clause element that contains it. */
function clauseIndexFromNode(node: Node | null): number | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.dataset.clauseIndex !== undefined) {
      const parsed = Number.parseInt(current.dataset.clauseIndex, 10);
      return Number.isNaN(parsed) ? null : parsed;
    }
    current = current.parentNode;
  }
  return null;
}

/** Renders text with any occurrence of the active search term marked. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => splitOnQuery(text, query), [text, query]);
  return (
    <>
      {segments.map((segment, index) => (segment.isMatch
        // Segments are positional, so the index is the only stable key available.
        // eslint-disable-next-line react/no-array-index-key
        ? <mark key={index} style={{ backgroundColor: '#ffe28a', padding: 0 }}>{segment.text}</mark>
        // eslint-disable-next-line react/no-array-index-key
        : <span key={index}>{segment.text}</span>))}
    </>
  );
}

function DocumentReviewTask({
  parameters, setAnswer, provenanceState, useTrrack,
}: StimulusParams<DocumentReviewParams, DocumentReviewState>) {
  const {
    documentId, dwellMs = DEFAULT_DWELL_MS, paneHeight = DEFAULT_PANE_HEIGHT,
  } = parameters;
  const doc = useMemo(() => getDocument(documentId), [documentId]);

  // In the analysis view reVISit drives the component from recorded provenance.
  // Recording anything back would fight the replay, so every commit is dropped.
  const isReplay = provenanceState !== undefined;

  // One action per behaviour we want to tell apart on the replay timeline. Each
  // takes the already-computed next state, so the Trrack state and the local
  // state can never drift apart.
  const { actions, registry } = useMemo(() => {
    const reg = Registry.create();
    const register = (name: string) => reg.register(
      name,
      (_state: DocumentReviewState, next: DocumentReviewState) => next,
    );
    return {
      actions: {
        scroll: register(DOCUMENT_REVIEW_ACTIONS.scroll),
        dwell: register(DOCUMENT_REVIEW_ACTIONS.dwell),
        search: register(DOCUMENT_REVIEW_ACTIONS.search),
        searchNav: register(DOCUMENT_REVIEW_ACTIONS.searchNav),
        select: register(DOCUMENT_REVIEW_ACTIONS.select),
        flag: register(DOCUMENT_REVIEW_ACTIONS.flag),
        unflag: register(DOCUMENT_REVIEW_ACTIONS.unflag),
        note: register(DOCUMENT_REVIEW_ACTIONS.note),
        noConcerns: register(DOCUMENT_REVIEW_ACTIONS.noConcerns),
      },
      registry: reg,
    };
  }, []);

  const trrack = useTrrack({ registry, initialState: INITIAL_DOCUMENT_REVIEW_STATE });

  const [state, setState] = useState<DocumentReviewState>(INITIAL_DOCUMENT_REVIEW_STATE);
  // Mirrors `state` so handlers can read the latest value without going stale,
  // and so a commit never has to run inside a setState updater.
  const stateRef = useRef<DocumentReviewState>(INITIAL_DOCUMENT_REVIEW_STATE);

  // The search box stays responsive per keystroke while the recorded query is
  // debounced, so this draft leads the recorded state. Notes need no equivalent:
  // they are recorded per keystroke and render straight from `state.notes`.
  const [queryDraft, setQueryDraft] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const clauseRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dwellTimer = useRef<number | null>(null);

  type ActionCreator = (next: DocumentReviewState) => Parameters<typeof trrack.apply>[1];

  /** Advances the rendered review state without recording a provenance node. */
  const updateState = useCallback((next: (current: DocumentReviewState) => DocumentReviewState) => {
    if (isReplay) {
      return;
    }
    const updated = next(stateRef.current);
    stateRef.current = updated;
    setState(updated);
  }, [isReplay]);

  /** Records the current state as a provenance node under `label`. */
  const recordNode = useCallback((label: string, action: ActionCreator) => {
    if (isReplay) {
      return;
    }
    trrack.apply(label, action(stateRef.current));
  }, [isReplay, trrack]);

  const commit = useCallback((
    label: string,
    action: ActionCreator,
    next: (current: DocumentReviewState) => DocumentReviewState,
  ) => {
    updateState(next);
    recordNode(label, action);
  }, [recordNode, updateState]);

  const clearDwellTimer = useCallback(() => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || !doc) {
      return;
    }
    const offsets = clauseRefs.current.map((el) => (el ? el.offsetTop : 0));
    const top = topVisibleClause(offsets, container.scrollTop);
    // Only a change of clause is worth a node. Pixel-level scrolling is already
    // in windowEvents and in the screen recording.
    if (top === stateRef.current.topClause) {
      return;
    }
    const { scrollTop } = container;
    commit(
      `Scroll to §${doc.clauses[top].number}`,
      actions.scroll,
      (current) => applyScroll(current, { topClause: top, scrollTop }),
    );
  }, [actions, commit, doc]);

  const startDwell = useCallback((index: number) => {
    clearDwellTimer();
    if (isReplay || !doc) {
      return;
    }
    dwellTimer.current = window.setTimeout(() => {
      if (stateRef.current.dwellClause === index) {
        return;
      }
      commit(
        `Dwell on §${doc.clauses[index].number}`,
        actions.dwell,
        (current) => applyDwell(current, index),
      );
    }, dwellMs);
  }, [actions, clearDwellTimer, commit, doc, dwellMs, isReplay]);

  const handlePaneLeave = useCallback(() => {
    clearDwellTimer();
    if (stateRef.current.dwellClause === null) {
      return;
    }
    commit('Look away from document', actions.dwell, (current) => applyDwell(current, null));
  }, [actions, clearDwellTimer, commit]);

  const scrollToClause = useCallback((index: number) => {
    const container = scrollRef.current;
    const clause = clauseRefs.current[index];
    if (container && clause) {
      container.scrollTop = clause.offsetTop;
    }
  }, []);

  const recordSearch = useMemo(() => debounce((query: string) => {
    if (!doc) {
      return;
    }
    const trimmed = query.trim();
    const matches = findMatchingClauses(doc.clauses, query);
    commit(
      trimmed.length > 0 ? `Search "${trimmed}"` : 'Clear search',
      actions.search,
      (current) => applySearch(current, { query, matches }),
    );
  }, SEARCH_DEBOUNCE_MS), [actions, commit, doc]);

  // A note reaches the answer on every keystroke: a participant who types one and
  // immediately clicks Next must not lose it to a pending debounce. Only the
  // provenance node is debounced, so the timeline gets one node per note rather
  // than one per character.
  const recordNoteNode = useMemo(() => debounce((clause: number) => {
    if (!doc) {
      return;
    }
    recordNode(`Note on §${doc.clauses[clause].number}`, actions.note);
  }, NOTE_DEBOUNCE_MS), [actions, doc, recordNode]);

  const noteChanged = useCallback((clause: number, note: string) => {
    updateState((current) => applyNote(current, { clause, note }));
    recordNoteNode(clause);
  }, [recordNoteNode, updateState]);

  const navigateMatches = useCallback((direction: 1 | -1) => {
    const current = stateRef.current;
    const nextIndex = stepMatch(current.matches, current.activeMatch, direction);
    if (nextIndex < 0) {
      return;
    }
    const total = current.matches.length;
    commit(
      `Jump to match ${nextIndex + 1} of ${total}`,
      actions.searchNav,
      (value) => applySearchNav(value, nextIndex),
    );
    scrollToClause(current.matches[nextIndex]);
  }, [actions, commit, scrollToClause]);

  const handleSelection = useCallback(() => {
    if (!doc) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const text = selection.toString().trim();
    const clause = clauseIndexFromNode(selection.anchorNode);
    if (text.length === 0 || clause === null) {
      return;
    }
    commit(
      `Select text in §${doc.clauses[clause].number}`,
      actions.select,
      (current) => applySelect(current, { clause, text: text.slice(0, MAX_SELECTION_LENGTH) }),
    );
  }, [actions, commit, doc]);

  const toggleFlag = useCallback((index: number) => {
    if (!doc) {
      return;
    }
    const wasFlagged = stateRef.current.flagged.includes(index);
    commit(
      `${wasFlagged ? 'Unflag' : 'Flag'} §${doc.clauses[index].number}`,
      wasFlagged ? actions.unflag : actions.flag,
      (current) => applyFlagToggle(current, index),
    );
  }, [actions, commit, doc]);

  const reportNoConcerns = useCallback(() => {
    commit('Report no concerns', actions.noConcerns, applyNoConcerns);
  }, [actions, commit]);

  // Replay: reVISit hands us the recorded state for the node under the playhead.
  useEffect(() => {
    if (!provenanceState) {
      return;
    }
    stateRef.current = provenanceState;
    setState(provenanceState);
    setQueryDraft(provenanceState.query);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = provenanceState.scrollTop;
    }
  }, [provenanceState]);

  const { flagged, notes, noConcerns } = state;
  const answer = useMemo(
    () => (doc ? buildReviewAnswer({ flagged, notes, noConcerns }, doc) : null),
    [doc, flagged, notes, noConcerns],
  );

  useEffect(() => {
    if (isReplay || !answer) {
      return;
    }
    const complete = isReviewComplete({ flagged, notes, noConcerns });
    setAnswer({
      status: complete,
      // Without a reason the platform falls back to "complete the stimulus
      // interaction", which does not tell the participant what is missing.
      ...(complete ? {} : { reason: 'customPending' as const, message: INCOMPLETE_MESSAGE }),
      answers: {
        flaggedClauses: answer.flaggedClauses,
        clauseNotes: answer.clauseNotes,
        noConcerns: answer.noConcerns,
      },
    });
  }, [answer, flagged, isReplay, noConcerns, notes, setAnswer]);

  // Flushing here would be too late to matter: React tears down the Trrack
  // subscription before passive effect cleanups run, so a node applied now would
  // never be published. Blurring the field is the flush point that works, and it
  // is also the moment the participant is done with it.
  useEffect(() => () => {
    clearDwellTimer();
    recordSearch.cancel();
    recordNoteNode.cancel();
  }, [clearDwellTimer, recordNoteNode, recordSearch]);

  if (!doc) {
    return <Text c="red">{`No document configured for id "${documentId ?? ''}".`}</Text>;
  }

  const activeMatchClause = state.activeMatch >= 0 ? state.matches[state.activeMatch] : -1;

  return (
    <Stack gap="sm" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Paper withBorder p="sm" radius="md" bg="gray.0">
        <Text fw={700} size="lg">{doc.title}</Text>
        <Text size="xs" c="dimmed">{doc.parties}</Text>
        <Text size="sm" mt="xs">{doc.brief}</Text>
      </Paper>

      <Group gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          data-testid="doc-review-search"
          aria-label="Search the document"
          placeholder="Search the document (e.g. indemnify, assign, liability)"
          leftSection={<IconSearch size={16} />}
          value={queryDraft}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setQueryDraft(next);
            recordSearch(next);
          }}
          onBlur={() => recordSearch.flush()}
          rightSection={queryDraft.length > 0 ? (
            <Button
              variant="subtle"
              size="compact-xs"
              aria-label="Clear search"
              onClick={() => {
                setQueryDraft('');
                recordSearch('');
              }}
            >
              <IconX size={14} />
            </Button>
          ) : null}
        />
        <Text size="sm" c="dimmed" data-testid="doc-review-match-count" style={{ whiteSpace: 'nowrap' }}>
          {state.matches.length === 0
            ? 'No clauses'
            : `${state.matches.length} clause${state.matches.length === 1 ? '' : 's'}`}
        </Text>
        <Button
          variant="default"
          size="xs"
          aria-label="Previous match"
          disabled={state.matches.length === 0}
          onClick={() => navigateMatches(-1)}
        >
          <IconChevronUp size={16} />
        </Button>
        <Button
          variant="default"
          size="xs"
          data-testid="doc-review-next-match"
          aria-label="Next match"
          disabled={state.matches.length === 0}
          onClick={() => navigateMatches(1)}
        >
          <IconChevronDown size={16} />
        </Button>
      </Group>

      <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
        <Box
          ref={scrollRef}
          data-testid="doc-review-pane"
          onScroll={handleScroll}
          onMouseUp={handleSelection}
          onMouseLeave={handlePaneLeave}
          style={{
            height: paneHeight, overflowY: 'auto', position: 'relative', backgroundColor: 'white',
          }}
        >
          {doc.clauses.map((clause, index) => {
            const isFlagged = state.flagged.includes(index);
            const isActiveMatch = index === activeMatchClause;
            const isDwelled = state.dwellClause === index;
            let accent = 'transparent';
            if (isFlagged) {
              accent = 'var(--mantine-color-red-6)';
            } else if (isActiveMatch) {
              accent = 'var(--mantine-color-violet-5)';
            }

            return (
              <Box
                key={clause.number}
                data-clause-index={index}
                data-testid={`doc-review-clause-${clause.number}`}
                ref={(el: HTMLDivElement | null) => { clauseRefs.current[index] = el; }}
                onMouseEnter={() => startDwell(index)}
                onMouseLeave={clearDwellTimer}
                px="md"
                py="sm"
                style={{
                  borderLeft: `4px solid ${accent}`,
                  borderBottom: '1px solid var(--mantine-color-gray-2)',
                  backgroundColor: isDwelled ? 'var(--mantine-color-gray-0)' : undefined,
                }}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                  <Text fw={600} size="sm">
                    {`§${clause.number}. `}
                    <HighlightedText text={clause.heading} query={state.query} />
                  </Text>
                  <Button
                    size="compact-xs"
                    variant={isFlagged ? 'filled' : 'light'}
                    color={isFlagged ? 'red' : 'gray'}
                    data-testid={`doc-review-flag-${clause.number}`}
                    aria-pressed={isFlagged}
                    aria-label={`${isFlagged ? 'Unflag' : 'Flag'} section ${clause.number}`}
                    leftSection={isFlagged ? <IconFlagFilled size={13} /> : <IconFlag size={13} />}
                    onClick={() => toggleFlag(index)}
                  >
                    {isFlagged ? 'Flagged' : 'Flag'}
                  </Button>
                </Group>
                <Text size="sm" mt={4} style={{ lineHeight: 1.6 }}>
                  <HighlightedText text={clause.text} query={state.query} />
                </Text>
                {isFlagged && (
                  <Textarea
                    mt="xs"
                    size="xs"
                    autosize
                    minRows={2}
                    data-testid={`doc-review-note-${clause.number}`}
                    aria-label={`Note on section ${clause.number}`}
                    placeholder="What concerns you about this clause?"
                    value={state.notes[String(index)] ?? ''}
                    onChange={(event) => noteChanged(index, event.currentTarget.value)}
                    onBlur={() => recordNoteNode.flush()}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Paper>

      <Group justify="space-between">
        <Group gap="xs">
          <Badge color={state.flagged.length > 0 ? 'red' : 'gray'} variant="light" data-testid="doc-review-flag-count">
            {`${state.flagged.length} flagged`}
          </Badge>
          {state.noConcerns && <Badge color="green" variant="light">No concerns reported</Badge>}
        </Group>
        <Button
          variant="subtle"
          size="xs"
          color="green"
          data-testid="doc-review-no-concerns"
          disabled={state.flagged.length > 0}
          onClick={reportNoConcerns}
        >
          I reviewed it and found nothing to flag
        </Button>
      </Group>
    </Stack>
  );
}

export default DocumentReviewTask;
