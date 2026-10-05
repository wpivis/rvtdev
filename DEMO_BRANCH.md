# `claude/midi-demo`

A demo branch exploring **MIDI instrument input** in reVISit, built as the
event-driven counterpart to `claude/gamepad-demo`.

## What it explores

Driving a reVISit stimulus from a MIDI piano, and what changes when an input
device delivers *events* instead of a polled snapshot. The gamepad branch had to
diff frames, synthesise button transitions, throttle a 60 Hz axis stream, and
accept 8–16 ms of timing error bounded by the display refresh. None of that
applies to MIDI: notes arrive as events carrying their own timestamps from the
MIDI stack, so timing-sensitive work is genuinely viable, every note already *is*
a discrete semantic event, and velocity gives a continuous expressive dimension
for free.

`notes/midi-support-proposal.md` is the write-up: the architecture, the full
comparison table against the gamepad, the `onmidimessage` trap that event-driven
input introduces, the pitch-class-to-hue mapping, and the known gaps.

Built against a **Loog x Duolingo Piano** — 37 velocity-sensitive keys, three
octaves, MIDI over USB-C — but any MIDI controller works.

## Branched from

`origin/main`, per the working agreements in `CLAUDE.md`. It does **not** build on
`claude/gamepad-demo`; that branch is a reference, not a base, and branching from
it would have dragged its whole diff along. `CLAUDE.md` and `netlify.toml` were
copied over from it because they exist only on demo branches, not on `main`.

## How to try it

Needs **Chrome or Edge** — Safari has no Web MIDI at all, and Firefox wants a Site
Permission Add-On first. This is a documented constraint, not a bug.

1. Connect a MIDI keyboard over USB.
2. `yarn install && yarn serve`, then open `http://localhost:8080`.
3. Pick **MIDI Piano Input with Provenance** under Demo Studies, or go straight to
   `/demo-midi`.
4. The setup page lists your instrument and asks for one note. Then grant screen
   recording, and play the prompted notes.

Without an instrument you still get a working study: the setup page explains what
is missing, and the trial shows a "waiting for a MIDI instrument" overlay. To see
it drive without hardware, `tests/demo-midi.spec.ts` installs a synthetic port.

## What is here

Core, all of it opt-in:

- `src/store/hooks/useMidi.ts` — subscribes to input ports and emits typed
  note/CC/device events. Attaches with `addEventListener`, not by assigning
  `onmidimessage`, so study-wide capture and a stimulus can share one port.
- `src/utils/midiNotes.ts` — note naming, pitch classes, and the equal-luminance
  pitch-class palette mapped around the circle of fifths.
- `captureMidi` in `uiConfig` and per component, defaulting to **false**. A study
  that does not use an instrument never requests MIDI access.
- `midinoteon` / `midinoteoff` / `midicc` / `mididevice` in `windowEvents`.
- `EXPLICIT_KEY_COLORS` extended so the provenance timeline reads as a piano roll.

Library and demo:

- `public/libraries/midi/` — `$midi.components.midiConnection`, the reusable
  setup gate, so no study author has to rebuild it.
- `public/demo-midi/` — a melody-matching task recording velocity, inter-onset
  intervals and note durations, with screen recording on.

## The gamepad's reviewed bugs

Upstream review of `revisit-studies/study#1488` found four bugs in the gamepad code
this branch was templated from. All four were checked here: two applied directly,
one applied in a different guise, one did not. The `## The four bugs upstream review
found in the gamepad work` section of `notes/midi-support-proposal.md` has the
detail. Each fix has a test confirmed to fail without it, and the branch now has
six tests that never connect an instrument — the gap that let the first bug ship.

## Validation

- `yarn typecheck`, `yarn lint` — clean.
- `npx vitest run` — 2112 passed, 1 skipped, across 152 files.
- `npx playwright test demo-midi` — 12 passed, Chromium, against a synthetic port.
- Seven other e2e specs fail on this branch **and identically on clean `main`**
  (verified in a separate worktree). All iframe/website stimuli, unrelated.
- **Not yet verified against real hardware.** See the real-hardware pass in
  `notes/midi-support-proposal.md`.

## Refreshing from upstream

```sh
git fetch origin main && git merge origin/main
```

Merge, never rebase — this branch is pushed, and a merge keeps any existing
checkout valid. If `src/parser/types.ts` changes, re-run `yarn generate-schemas`.

## Links

- Branch: https://github.com/wpivis/rvtdev/tree/claude/midi-demo
- Netlify branch deploy: https://claude-midi-demo--rvtdev.netlify.app/demo-midi
  (only builds once `claude/midi-demo` is added to the site's branch-deploy list)
