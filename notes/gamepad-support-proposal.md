# Gamepad support in reVISit

A proposal for turning the `claude/gamepad-demo` exploration into something the core
platform could carry. Written against the code on that branch; file references are to
this repository.

## The shape of the change

Gamepad support does not fit in a library alone. Libraries contribute components and
sequences — they cannot add to `windowEvents`, register `EventType`s, or run a polling
loop for the whole study. But the participant-facing setup page *is* exactly what a
library is for.

Screen and audio recording already solve this same problem with a three-part split, and
gamepad support should mirror it:

| Layer | Recording | Gamepad |
| --- | --- | --- |
| Core capability | `useRecording`, `RecordingContext`, `recordScreen` / `recordAudio` in `uiConfig` and per component | `useGamepad`, gamepad `EventType`s, a `captureGamepad` flag |
| Library setup page | `screen-recording` → `screenRecordingPermission` | `gamepad` → `gamepadConnection` |
| Demo study | `demo-screen-recording` | `demo-gamepad` |

The important asymmetry: recording needs a permission grant, gamepad needs an *arming
gesture*. Browsers hide gamepads from a page until it has received gamepad input, as an
anti-fingerprinting measure. Functionally this lands in the same place — a setup page the
participant must clear before the study can rely on the device — which is why the same
pattern fits.

## What exists on the branch today

| File | Role | Status |
| --- | --- | --- |
| `src/store/hooks/useGamepad.ts` | rAF poll-and-diff loop, synthesises button down/up, deadzone, connection tracking | Complete, unit tested |
| `src/utils/gamepadButtons.ts` | Standard-mapping button names, face-button colors, press action-type convention | Complete |
| `src/store/types.ts` | `gamepadconnection`, `gamepadbuttondown`, `gamepadbuttonup`, `gamepadaxis` added to `EventType` | Complete |
| `src/components/StepRenderer.tsx` | Pushes gamepad events into `windowEvents` | **Runs unconditionally — see gap 1** |
| `src/components/audioAnalysis/provenanceColors.ts` | `EXPLICIT_KEY_COLORS` maps press action types to button colors | Complete, tested at function and render level |
| `src/components/downloader/DownloadTidy.tsx` | Counts the new event kinds in the tidy export | Complete |
| `src/public/demo-gamepad/assets/GamepadTargetGame.tsx` | Target-acquisition stimulus | Complete |
| `public/demo-gamepad/` | Study config + introduction | Complete |
| `tests/demo-gamepad.spec.ts` | End-to-end run against a synthetic gamepad | Chromium only |

## Part 1 — core capability

### Make capture opt-in

This is the one change that most clearly blocks upstream acceptance. Today
`StepRenderer` calls `useGamepad` unconditionally, so **every study on the platform runs
an animation-frame polling loop**, and any study whose participant happens to have a
controller attached silently accumulates gamepad entries in `windowEvents`.

It should mirror `recordScreen`: a `captureGamepad` boolean in `uiConfig` and on the
individual component, defaulting to false, with `enabled` passed through to the hook. The
hook already takes `enabled`, so this is small:

```ts
useGamepad({ /* handlers */, enabled: currentComponentHasGamepadCapture });
```

Add a `useStudyGamepad` alongside `useStudyRecordings` (`src/utils/useStudyRecordings.ts`)
so the setup component can tell whether the study uses gamepads at all, the same way
`ScreenRecording.tsx` branches on `studyHasAudioRecording`.

Adding config fields means regenerating schemas with `yarn generate-schemas`.

### Decide where axis samples live

At a 100 ms throttle a five-minute trial produces roughly 3,000 `gamepadaxis` entries, each
an array of four floats, stored inline on the answer. That is heavier than anything else in
`windowEvents`. Options, in increasing order of work:

1. Leave it, and document the cost.
2. Make the axis throttle separately configurable from `windowEventDebounceTime`.
3. Write axis samples to their own storage key, the way provenance is split out by
   `splitProvenanceFromAnswers` (`src/store/provenance.ts`).

Option 2 is probably the right first move; option 3 is the right answer if anyone runs a
long controller study.

## Part 2 — the `gamepad` library

A new `public/libraries/gamepad/config.json` plus
`src/public/libraries/gamepad/assets/GamepadConnection.tsx`, providing one component:

**`gamepadConnection`** — the arming gate. It should:

- Explain that the browser cannot see the controller until a button is pressed, so the
  participant does not read the wait as a malfunction.
- Show a live readout — detected `id`, `mapping`, a lit-up button and stick display — so
  the participant confirms the device actually works before the task, not during it.
- Gate the Next button via `setAnswer({ status: connected, ... })`, exactly as
  `screenRecordingPermission` does.
- Record `id`, `mapping`, button count and axis count in a hidden reactive response, so
  every participant record carries the hardware it was collected on.

Two things come free from the existing generators: `libraryDocGenerator.cjs` produces the
docs-site markdown from the library's `description` / `reference` / `additionalDescription`
fields, and `libraryExampleStudyGenerator.cjs` produces a `library-gamepad` example study.
Both are already covered by `LibraryDocGenerator.spec.ts` and
`LibraryExampleStudyGenerator.spec.ts`. Register `library-gamepad` in `public/global.json`
with `test: true` to pull it into the automated sweep.

Moving the arming gate into the library also fixes a smell in what we built: right now that
logic lives inside the demo stimulus, so every study author would reimplement it.

## Part 3 — documentation and demo

`demo-gamepad` stays as the "how do I drive a stimulus with this" example. The docs site
needs a Gamepad Input page covering:

- The polling model, and why there are no gamepad events.
- The arming gesture, as a permanent design constraint on study flow.
- The timing caveat, stated plainly for anyone tempted to run reaction-time work.
- The two capture layers, and the rule that per-frame motion belongs in `windowEvents` and
  the screen recording, never in the provenance graph.
- The press action-type naming convention, since that is what earns a stimulus its
  button-colored provenance nodes.

## Gaps to call it full

### 1. Cross-origin iframe stimuli cannot see the gamepad

The Gamepad API is gated by the `gamepad` Permissions Policy, whose default allowlist is
`self`. The iframe in `src/controllers/IframeController.tsx` carries no `allow` attribute,
so a `type: "website"` stimulus pointing at another origin **cannot read gamepads at all**.
Top-level `windowEvents` capture still records input, but the stimulus cannot react to it.

Same-origin stimuli served out of `public/` are unaffected.

Two fixes, not mutually exclusive: add `allow="gamepad"` to the iframe, and forward gamepad
state over the existing `postMessage` channel so iframe stimuli get it without needing
their own arming gesture. This is the largest functional gap.

### 2. Non-standard mappings are logged but not handled

We record `gamepad.id` and `gamepad.mapping`, which is enough to detect a problem in
analysis but not to prevent one. A controller reporting `mapping: ""` will produce
confidently wrong button names. Xbox pads report `"standard"` everywhere we care about;
DualSense, Switch Pro and 8BitDo controllers are the ones to check. The setup component
should probably refuse a non-standard mapping with a clear message rather than collect
mislabelled data.

### 3. Browser and hardware matrix is unverified

Everything so far has been tested against a *synthetic* gamepad in Chromium. Nobody has run
this with real hardware in any browser. What needs a real-device pass:

- Safari and Firefox, where trigger and d-pad indices have historically differed.
- The `test.skip` for WebKit now in `tests/demo-gamepad.spec.ts` — added because the fake
  display stream the test relies on is unverified there, and it should be revisited rather
  than left permanently.
- Wired versus Bluetooth latency, which is a documentation item rather than a code one.
- Mobile, where both Android Chrome and iOS Safari support controllers. Probably out of
  scope, but `studyRules` should be able to express the exclusion.

### 4. Device rules do not fit gamepads cleanly

`UserInput` is `'mouse' | 'touch'` (`src/parser/types.ts`), and adding `'gamepad'` would
give authors `studyRules.inputs.allowed` and a `blockedMessage` for free. But
`detectInputTypes()` in `src/utils/useDeviceRules.ts` is a synchronous snapshot refreshed on
resize, and gamepad presence is unknowable until the participant presses a button. The
snapshot model cannot express it.

Recommendation: do **not** extend `UserInput`. The setup component is already the gate, and
it can gate accurately because it waits for the gesture. A device rule here would either
block participants who do have controllers or pass everyone regardless, and neither is
worth the schema change.

### 5. Testing gaps

- There is no end-to-end coverage for screen or audio recording anywhere in the repo today.
  `tests/demo-gamepad.spec.ts` is the first spec of its kind, which is worth knowing when
  judging how much precedent it sets.
- The synthetic gamepad harness (`installFakeGamepad`) should move from the spec into
  `tests/utils.ts` so other specs can drive a controller.
- The axis throttle in `StepRenderer` has no unit test.

### 6. Analysis surface

- `buildProvenanceLegendEntries` exists in `provenanceColors.ts` but is rendered nowhere. A
  legend is what makes button-colored nodes self-explanatory to an analyst who did not read
  this document.
- There is no gamepad-specific analysis view — no stick-trace, no per-button reaction-time
  summary. Whether that is worth building depends on whether anyone runs a real study.

### 7. Ethics and participant burden

Requiring a controller excludes participants, and the `blockedMessage` should say so in
terms a participant can act on. Separately, `gamepad.id` is a moderately identifying string;
the docs should say it is collected, and it may be worth truncating it to the model name
rather than storing the full vendor/product descriptor.

## Suggested sequencing

Ordered by what unblocks what, not by size.

1. Gate capture behind `captureGamepad`. Small, and the clearest blocker to upstream review.
2. `allow="gamepad"` on the iframe, plus `postMessage` forwarding. Largest functional gap.
3. The `gamepad` library with `gamepadConnection`, which moves the arming gate out of the
   demo stimulus and earns the auto-generated docs and example study.
4. The docs-site page.
5. A real-hardware compatibility pass, which also decides the non-standard-mapping policy.
6. Optional follow-ons: provenance legend, axis-sample storage, calibration.

Calibration deserves a note. `library-virtual-chinrest` is precedent for a per-participant
calibration library, and a gamepad equivalent — measuring resting drift and setting a
per-participant deadzone — would fit the same shape. It is a genuine research instrument
rather than a nicety, since stick drift varies a lot across worn hardware.

## Splitting it for review

If this does go upstream, it splits into reviewable pieces cleanly:

1. `useGamepad` plus `gamepadButtons`, with unit tests and no wiring. Self-contained.
2. `EventType` additions, `StepRenderer` wiring behind `captureGamepad`, `DownloadTidy`
   counts, schema regeneration.
3. Provenance color overrides, with the render-level test.
4. The `gamepad` library and its generated docs and example study.
5. `demo-gamepad` and the end-to-end spec.

Steps 1 and 3 are independently useful and carry almost no risk; the explicit color map in
`getColorForKey` is generic and any study with meaningful action colors can use it.

---

# Upstream outcome

This went upstream as [revisit-studies/study#1488](https://github.com/revisit-studies/study/pull/1488),
based on `dev` from a `lane/gamepad-input` branch, and was **merged by Jack Wilburn on
2026-09-29** — 21 files, +1775/-9, approved with "passes unit tests, lint, preview
deployment, and all Chromium shards."

Two things changed before it merged, and both are worth carrying into any other input
modality.

## Gap 1 of this document was closed first

`captureGamepad` landed as an opt-in boolean on `uiConfig` and the individual component,
defaulting to false and resolved the same way `windowEventDebounceTime` is, with a
regression test that loads a study which does *not* opt in and asserts an attached
controller produces no events. The unconditional polling loop never reached review.

## Four bugs the review found

Three were raised by the repo's automated Codex reviewer; the fourth Jack caught himself.
All four were in code written here, and the fork's `claude/gamepad-demo` branch still
carries the unfixed versions.

**The initial answer was never published.** The stimulus only called `setAnswer` after a
successful button press, while its four reactive responses defaulted to required. The trial
therefore started invalid, and a participant without a working controller was stuck on it —
the exact opposite of what a comment in that file claimed. Fixed by publishing a valid
zero-valued answer on mount, plus an end-to-end test that advances past the trial without
ever connecting a device.

**The axis throttle discarded samples permanently.** `useGamepad` advanced its
`previousAxes` baseline *before* calling `onAxes`, while the leading-edge throttle in
`StepRenderer` could drop that call. The sample was then unrecoverable: a quick flick
recorded nothing, and a stick returning to rest inside the throttle window left the stored
stream showing it held indefinitely. Fixed with a leading-and-trailing throttle that keeps a
pending sample, prefers whichever is further from the last recorded position, and exposes
`flushPending` on the windowEvents ref so `useNextStep` flushes before splicing — otherwise
the resting sample lands in the next trial.

The shape of this bug matters more than the fix: a hook that advances its own baseline, plus
a consumer free to drop the call, equals silent data loss. Neither half is wrong alone.

**A hidden tab turned into motion.** `requestAnimationFrame` pauses while a tab is hidden,
but `deltaMs` kept measuring from the previous callback, so the first resumed frame
multiplied stick input by minutes of elapsed time and threw the reticle to the field edge.
Fixed by clamping the frame delta to 50 ms.

**The on-screen prompt lagged a round.** Spawning a target updated the prompt in Trrack
state but not in the local state mirror. Holding one value in two places invites this.

## The lesson under all four

Every test written here assumed a working device. The one behaviour the code explicitly
claimed — that a participant without hardware is never trapped — was the only one never
exercised, because every end-to-end test connected a synthetic gamepad before doing anything
else. A new modality should have a no-device test from the first commit.

## Still open upstream

The TODOs on the merged PR match this document's gap list: the `gamepad` library with a
connection component, `allow="gamepad"` on the iframe for cross-origin stimuli, a policy for
non-standard mappings, a real-hardware pass beyond the Xbox-over-USB-C-in-Safari check that
was done, and docs-site documentation.
