# `claude/legal-doc-review` — document review with replayable reading behaviour

A demo branch, not a pull request. See `CLAUDE.md` for how these branches work.

## What this explores

A study for a team that wants to compare how **lawyers and non-lawyers review
documents like contracts**. It adds a React + Trrack stimulus that presents a
scrolling contract and records the reading behaviour as provenance, so a whole
review can be replayed in the reVISit analysis view rather than inferred from a
final answer.

`demo-document-review` is a fixed, two-trial study:

| Step | Component | Recording |
| --- | --- | --- |
| 1 | `introduction` — what to do, and the think-aloud instruction | off |
| 2 | `$screen-recording.components.screenRecordingPermission` | — |
| 3 | `background` — legal training, years reviewing contracts, how often | off |
| 4 | `review-nda` — a mutual NDA, 12 clauses | audio + screen |
| 5 | `review-msa` — a SaaS master services agreement, 14 clauses | audio + screen |
| 6 | `debrief` — strategy, realism, think-aloud burden | off |

Both contracts are **fabricated**. The parties, the drafting and the problems in
them are invented; nothing in them is legal advice.

## What gets recorded

Beyond the flags and notes that make up the answer, the stimulus records one
Trrack node per meaningful review behaviour:

| Action | Recorded when | Timeline color |
| --- | --- | --- |
| `docReviewScroll` | the topmost clause in the viewport changes | grey-blue |
| `docReviewDwell` | the pointer rests on a clause past the dwell threshold | teal |
| `docReviewSearch` | a search term settles (debounced, flushed on blur) | violet |
| `docReviewSearchNav` | the participant jumps between matches | light violet |
| `docReviewSelect` | text is selected inside a clause | blue |
| `docReviewFlag` / `docReviewUnflag` | a clause is flagged or unflagged | **red** / pink |
| `docReviewNote` | a note on a flagged clause settles | orange |
| `docReviewNoConcerns` | the participant reports nothing to flag | green |

Each node carries the **whole** review state, so seeking the replay timeline
restores the scroll position, the search box, the highlights, the flags and the
notes as they stood at that moment.

The colors come from `src/utils/documentReviewActions.ts` and are applied by
`src/components/audioAnalysis/provenanceColors.ts`, which previously hashed every
action name to an arbitrary hue. Flagging is the event an analyst scrubs a session
for, so it is the only red on the timeline and the ambient reading behaviour stays
muted.

### What is deliberately *not* in provenance

Per-pixel scrolling and the mouse path. Both are already captured in
`windowEvents` (`windowEventDebounceTime: 200`) and in the screen recording.
Duplicating them would bury the few dozen nodes an analyst cares about under
thousands of pixel deltas.

## Think-aloud and screen recording

`recordAudio` and `recordScreen` are on in `uiConfig` and enabled per-component on
the two review trials only, so the questionnaires are not recorded. The
introduction asks participants to think aloud continuously.

The **Think Aloud** tab in the analysis view needs `recordAudio` *and* a Firebase
storage backend. The Netlify demo deploy uses local storage, so on the deploy you
get the recording prompts and the replay timeline but not transcript coding. To
exercise that tab, point `.env` at Firebase.

## Trying it

- **Demo study**: `/demo-document-review`. The screen-recording permission step
  asks to share a tab and needs to hear your microphone before Next unlocks.
- **Replay**: finish a session, then open the analysis view for the study and
  scrub a review trial. The document redraws as the participant left it at that
  instant.

## The planted problems

Kept out of the code so they cannot reach the participant's DOM. Each document
carries a handful of clauses a contracts lawyer would be expected to catch:

**Mutual NDA** — §1 defines Confidential Information with no marking requirement;
§2 puts a clear-and-convincing burden on the receiving party; §5 survives in
perpetuity; §7 allows indefinite backup retention with no certification; §8 is a
residuals clause that swallows the rest of the agreement; §10 gives injunctive
relief to one party only; §11 lets only the counterparty assign.

**SaaS MSA** — §2 allows unilateral renewal price increases; §3 auto-renews for 24
months on a 90-day notice window; §4 caps the SLA remedy at 5% of one month; §5
licenses Customer Data for model training, perpetually and past termination; §8
hands Provider ownership of Derived Data; §10 caps Provider's liability at three
months of fees while leaving Customer's unlimited; §11 is a one-way indemnity; §12
allows suspension at sole discretion with no cure period; §14 lets Provider amend
by posting to its website.

Good study designers will want to swap these for documents their own experts have
calibrated — the point here is the instrument, not the stimuli.

## `test-document-review`

`demo-document-review` gates its first trial behind the screen-recording
permission component, which needs real screen capture and detected sound and so
cannot be driven by Playwright. `public/test-document-review/config.json` is the
same stimulus with recording off, marked `"test": true` so it stays off the
landing page. `tests/demo-document-review.spec.ts` drives it.

## Possible next step: fNIRS / Neurable

The team has raised adding **fNIRS** or a **Neurable** headset to this paradigm, to
pair cognitive load against the clause a participant is reading. That is a
substantially bigger build than this branch and is **not** started here. Sketching
the shape of it:

- A device bridge. Neither device speaks to a browser directly. Realistically that
  means a local companion process (LSL, or the vendor SDK) and a WebSocket into
  the stimulus, plus a reVISit-side hook comparable to `useRecording`.
- Clock alignment. The value of this study is tying a signal window to *the clause
  that was on screen*. Provenance timestamps, `windowEvents`, the screen recording
  and the device stream all need to land on one clock, with drift measured rather
  than assumed. A sync marker at trial start is the usual approach.
- Storage. Continuous multi-channel signal does not belong in provenance or in
  `participantData`. It needs its own asset path alongside the screen recording,
  and the analysis view needs a track that draws it against the existing timeline.
- Consent and IRB. Physiological measurement changes the protocol materially.

The `docReviewDwell` and `docReviewScroll` nodes are the hook this would attach
to: they already say which clause held attention and when.

## Branched from

`main` (which tracks upstream `revisit-studies/study` `main`), at the commit
carrying reVISit v2.4.4 configs. Not branched from `dev` — nothing here needed an
unreleased upstream feature, and staying on `main` keeps the diff readable.

Refresh with `git fetch origin main && git merge origin/main`. Merge, never
rebase.
