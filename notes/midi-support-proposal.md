# MIDI input in reVISit

A proposal for turning the `claude/midi-demo` exploration into something the core
platform could carry, and a comparison with the gamepad work on
`claude/gamepad-demo`. Written against the code on this branch; file references
are to this repository.

Read `notes/gamepad-support-proposal.md` on `claude/gamepad-demo` alongside this.
The interesting content here is not "MIDI also works" — it is that MIDI is the
*inverse* of the gamepad on almost every axis that mattered to that design, and
several problems that dominated it simply do not arise.

## The headline comparison

| | Gamepad | MIDI |
| --- | --- | --- |
| Delivery | Polled. `navigator.getGamepads()` returns a snapshot to diff. | **Event-driven.** Messages arrive as DOM events on each input port. |
| Transitions | Synthesised by diffing frames. | Already discrete. A note-on *is* an event. |
| Timestamp source | When the poll looked. | **The MIDI stack**, on the `performance.now()` clock. |
| Timing error | Up to one frame, ~8–16 ms, bounded by display refresh. | **Not frame-bound.** Sub-millisecond detail is real. |
| Hidden tab | Polling stops; `requestAnimationFrame` does not run. | Events keep arriving. |
| Continuous dimension | Analog sticks and triggers, sampled per frame. | **Velocity per note**, delivered once, no sampling. |
| Device visibility | Hidden until the page receives input (anti-fingerprinting). | Listed as soon as access is granted. No arming gesture. |
| Multiple consumers | Free — polling is a read. | **Exclusive by default.** See the `onmidimessage` trap below. |
| Browser support | Broad. | **Chrome and Edge only.** The real constraint. |
| Per-frame data in provenance | The central design problem. | Mostly evaporates. |

### Timing is the reason to care

The gamepad proposal had to state a caveat plainly: its timestamps mark when the
poll *noticed* a press, so reaction-time work is off the table. That caveat does
not transfer. `MIDIMessageEvent.timeStamp` is a `DOMHighResTimeStamp` produced by
the MIDI stack, not by whenever JavaScript next ran, so a note's onset is known to
well under a frame.

`useMidi` surfaces both `timeStamp` (the MIDI clock, for intervals and precision
work) and `epochMs` (shifted by `performance.timeOrigin`, for `windowEvents`,
which stores epoch milliseconds). The demo computes its inter-onset intervals and
note durations from `timeStamp` and reports them to two decimal places, which is
honest rather than decorative.

Caveats that remain, and that a rhythm study should check before trusting the
numbers:

- USB-MIDI has its own transport latency, typically a few milliseconds and
  reasonably stable. It shifts onsets; it does not add much jitter.
- Some drivers report coarse timestamps. Worth measuring per device rather than
  assuming.
- Bluetooth MIDI is considerably worse than USB and should be excluded from
  timing-sensitive work.

None of this is the frame-quantisation wall the gamepad hits. The floor is the
hardware's, not the renderer's.

### Per-frame data stops being the problem

The gamepad design spent most of its effort on one question: where do 60 Hz axis
samples go? It ended with a throttle in `StepRenderer`, an explicit rule that
per-frame motion stays out of the provenance graph, and three ranked options for
storing axis samples if anyone ran a long study.

A keyboard emits one event per note. A fast passage is tens of events per second,
not hundreds, and every one of them is already a meaningful musical event. So:

- **Note events are pushed to `windowEvents` unthrottled.** There is nothing to
  sample.
- **Every note goes into the provenance graph.** No "keep this out" rule, no
  sampling interval, no splitting into a separate storage key.
- **Only control change needs a budget**, because a swept mod wheel or expression
  pedal genuinely is continuous. `StepRenderer` throttles CC per controller
  number, and always lets values of 0 and 127 through so switch-style controllers
  (sustain, sostenuto) never lose a transition to the throttle.

That last detail is the only place the gamepad's throttling instinct earns its
keep, and it needed a modification the gamepad did not: a time-based throttle
alone silently eats pedal presses.

## What exists on this branch

| File | Role |
| --- | --- |
| `src/store/hooks/useMidi.ts` | Subscribes to input ports, parses messages, tracks hot-plug. Unit tested against a synthetic port. |
| `src/utils/midiNotes.ts` | Note naming, pitch classes, the pitch-class palette, the note action-type convention. |
| `src/utils/useStudyMidi.ts` | Whether the study captures MIDI anywhere, for the setup component's author warning. |
| `src/store/types.ts` | `midinoteon`, `midinoteoff`, `midicc`, `mididevice` added to `EventType`, plus the `windowEvents` doc comment. |
| `src/parser/types.ts` | `captureMidi` in `uiConfig` and on the individual component. Schemas regenerated. |
| `src/components/StepRenderer.tsx` | Pushes MIDI into `windowEvents`, **behind `captureMidi`**. |
| `src/components/interface/MidiKeyboard.tsx` | Shared keyboard display, used by both the library component and the demo. |
| `src/components/audioAnalysis/provenanceColors.ts` | `EXPLICIT_KEY_COLORS` maps note action types to pitch-class colors. |
| `src/components/downloader/DownloadTidy.tsx` | Counts the new event kinds in the tidy export. |
| `public/libraries/midi/` + `src/public/libraries/midi/assets/MidiConnection.tsx` | The reusable setup component. |
| `public/demo-midi/` + `src/public/demo-midi/assets/MidiMelodyTask.tsx` | The demo study. |
| `tests/demo-midi.spec.ts` | End-to-end run against a synthetic MIDI port. Chromium, no WebKit skip. |

### The two gamepad gaps, closed up front

The gamepad proposal named two things as mistakes that were cheap to avoid and
annoying to retrofit. Both are avoided here by construction.

**1. Capture is opt-in.** `StepRenderer` reads
`componentConfig.captureMidi ?? uiConfig.captureMidi ?? false` and passes it as
`enabled`. With it off, the hook never calls `requestMIDIAccess` and never
subscribes to a port, so a study that does not use an instrument carries no cost
and collects no stray MIDI. This mirrors `recordScreen`, and it is the single
clearest blocker the gamepad work left for upstream review.

**2. The connection gate lives in a library, not in the stimulus.**
`$midi.components.midiConnection` requests access, lists the detected
instruments, asks for one note, records the device names in a hidden reactive
response, and gates progression. A study author imports it rather than
rebuilding it. The demo stimulus has its own "waiting for an instrument" overlay,
but that is a fallback for a mid-trial unplug, not the setup flow.

## The `onmidimessage` trap

Worth recording, because it is a genuine trap and every Web MIDI example walks
into it.

The obvious way to receive messages is `input.onmidimessage = handler`. That is a
single-slot property: assigning it a second time replaces the first handler. Since
reVISit wants **two** layers of capture — study-wide `windowEvents` capture in
`StepRenderer`, and whatever the stimulus itself does — the assignment form means
the stimulus silently stops the platform recording, or the platform silently stops
the stimulus working, depending on mount order.

`useMidi` therefore uses `addEventListener('midimessage', ...)`, and calls
`input.open()` explicitly rather than relying on the implicit open that setting
`onmidimessage` performs. There is a unit test asserting that two consumers of one
port both receive every note, specifically so this cannot regress.

This is a structural difference from the gamepad, not an implementation detail.
Polled input is shared by default because reading a snapshot costs nothing and
affects nobody. Event-driven input is exclusive by default, and has to be made
shareable on purpose. Any future event-driven device in reVISit will hit this.

## Pitch class to hue

Notes are colored by pitch class, mapped around the twelve-tone circle **by
fifths** rather than by semitone: `hue = ((pitchClass * 7) mod 12) * 30`.

Semitone ordering would be the obvious choice and is the wrong one. A wrong note
in a study is usually wrong by a semitone, so a semitone mapping would make the
error and the right answer adjacent hues — exactly the distinction that most needs
to be visible. Stepping by fifths puts chromatic neighbours a tritone apart
(C is red, C♯ is blue) while keeping notes that *sound* related visually related:
a major scale lands on seven well-spread hues, and a triad's three notes sit close
together. There is a unit test asserting every chromatic neighbour pair is more
than 120 degrees apart in hue.

Two further decisions:

- **Octave is not encoded.** C3 and C5 are one color. What a timeline wants to
  show is which note was played; the octave is in the node label. One registered
  action type per pitch class, twelve in total, rather than one per key.
- **Luminance is held constant** across all twelve, with lightness solved per hue
  by bisection to hit a fixed relative luminance. A single HSL lightness does not
  work: yellow at a given lightness is far brighter than blue, and some hues land
  in the gap where neither black nor white text clears 4.5:1 contrast. Equal
  luminance also means hue is the only varying channel, which is what a
  categorical encoding wants. The contrast requirement is asserted in
  `src/utils/tests/midiNotes.spec.ts`.

The payoff is real: a `demo-midi` trial's provenance timeline reads as a piano
roll, and `tests/TaskProvenanceNodes.spec.tsx` asserts the actual rendered fills
for a recorded sequence, including that a C an octave up gets the same fill and a
semitone error does not.

## Browser support

**Chrome and Edge only.** This is accepted, not worked around.

- **Safari** does not implement Web MIDI on any version or platform, and WebKit
  has declined it on fingerprinting grounds. There is no flag.
- **Firefox** has supported it since 108, but prompts the user to install a Site
  Permission Add-On first. That is too much friction to put in front of a study
  participant.
- **Chrome and Edge** grant non-sysex access without a prompt. `useMidi` asks for
  `{ sysex: false }` deliberately: requesting sysex turns a silent grant into a
  permission dialog, and nothing here needs it.

It is documented in three places a participant or author will actually look: the
study introduction, the `midiConnection` component (which detects the unsupported
case and names the remedy rather than failing silently), and the library's
`additionalDescription`, which the docs generator picks up.

**The fallback that is explicitly not the plan:** the piano has a 3.5 mm output,
so Web Audio plus pitch detection would work everywhere, Safari included. It is
far noisier, and it *infers* — pitch, onset, amplitude — exactly what Web MIDI
hands over exactly. Not worth building unless Safari coverage becomes a hard
requirement, and if it ever does, it is a separate input type rather than a
polyfill for this one.

## Gaps to call it full

### 1. Cross-origin iframe stimuli cannot see MIDI

Same shape as the gamepad's largest gap, same cause. Web MIDI is gated by the
`midi` Permissions Policy, whose default allowlist is `self`, and the iframe in
`src/controllers/IframeController.tsx` carries no `allow` attribute. A
`type: "website"` stimulus on another origin cannot read MIDI at all. Top-level
`windowEvents` capture still records everything, but the stimulus cannot react.

Fixes, not mutually exclusive: add `allow="midi"` to the iframe, and forward note
events over the existing `postMessage` channel. The second is more attractive here
than it was for the gamepad, because forwarding discrete events is a much smaller
message volume than forwarding per-frame state.

### 2. Channels and multi-timbral instruments are recorded but not used

`useMidi` reports the channel on every message and nothing consumes it. One
instrument on one channel is the common case and the demo assumes it. A study with
two players on one interface, or a keyboard split across channels, would need
channel filtering in the hook options. Cheap to add when something needs it; the
data is already there to detect the situation in analysis.

### 3. No real-hardware pass

Everything so far has been exercised against a *synthetic* MIDI port in Chromium.
Nobody has run this with the actual Loog Piano, or any real instrument, in any
browser. What needs a real-device pass:

- That the Loog reports its 37 keys over the range the demo draws. The demo
  defaults to C3–C6 (notes 48–84) and takes `lowestNote` and `keyCount`
  parameters, so a different range is a config change rather than a code change —
  but the default is a guess until someone checks.
- Whether the keyboard sends note-off or note-on-with-velocity-0. Both are
  handled; which one shows up is worth knowing.
- Whether velocity actually spans a useful range, and what curve. The demo's
  velocity tolerance assumes a roughly linear response.
- Real timestamp resolution and transport latency, which is what decides whether
  the timing claims above hold on this hardware.
- Whether active-sensing or clock bytes arrive constantly. They are ignored, but
  a device that floods them is worth knowing about.

### 4. Device rules do not fit MIDI, and should not be stretched to

`UserInput` is `'mouse' | 'touch'` (`src/parser/types.ts`). The gamepad proposal
recommended against adding `'gamepad'` because presence is unknowable until the
participant acts. That reasoning does *not* apply to MIDI — the device list is
available as soon as access is granted, so a synchronous-ish check is conceivable.

The recommendation is still to leave `UserInput` alone, for a different reason:
the thing that actually needs gating is **the browser**, not the device.
A participant in Safari cannot be rescued by having a piano. Browser gating is a
screening and introduction concern, and `midiConnection` already handles the
device half accurately because it waits for a note.

### 5. Analysis surface

- `buildProvenanceLegendEntries` still exists and is still rendered nowhere. The
  same gap the gamepad noted. It matters slightly more here: twelve hue-coded
  categories are more than color alone can carry reliably, and a legend is the
  cheap fix.
- There is no MIDI-specific analysis view. A real piano-roll view — note number
  against time, with velocity as opacity — would be a genuinely useful addition
  and is close to what `MidiKeyboard` already draws.
- Velocity is currently summarised as a mean absolute error against a target. A
  study interested in dynamics would want the distribution, not the mean.

### 6. Accessibility and participant burden

- Requiring an instrument excludes participants, and requiring Chrome or Edge
  excludes more. Both belong in screening, stated in terms a participant can act
  on before they start.
- Requiring a *musician* is a third exclusion the demo tries to avoid by prompting
  one note at a time with the key outlined on screen, and by naming dynamics in
  words rather than Italian. Worth keeping in mind for any real study design.
- Twelve hue-coded categories are not reliably distinguishable under color vision
  deficiency. The node label carries the note name, so color is a fast read rather
  than the only channel — but a legend would help, and so would not relying on
  color alone in any published figure.
- Device names are mildly identifying. `midiConnection` records manufacturer and
  product name, which is less specific than the gamepad's full vendor/product
  descriptor, but it should still be named in a consent form.

### 7. Testing gaps

- The synthetic MIDI harness lives in `tests/demo-midi.spec.ts` and should move to
  `tests/utils.ts` so other specs can drive an instrument. Same note the gamepad
  proposal made about `installFakeGamepad`, still unaddressed in both.
- The CC throttle in `StepRenderer` is covered end-to-end (the pedal's 0 and 127
  both survive) but has no unit test.
- `MidiKeyboard` has no render-level unit test; it is covered only through the
  e2e spec's `data-active` and `fill` assertions.
- Seven e2e specs fail on this branch — and identically on clean `main`, verified
  in a separate worktree. They are all iframe/website stimuli
  (`demo-html`, `demo-html-input`, `demo-trrack`, `example-mvnv`) and unrelated to
  this work.

## Suggested sequencing

Ordered by what unblocks what.

1. `useMidi` plus `midiNotes`, with unit tests and no wiring. Self-contained and
   independently useful.
2. Provenance color overrides, with the render-level test. Also self-contained;
   `EXPLICIT_KEY_COLORS` is generic and any study with a meaningful palette can
   use it.
3. `EventType` additions, `StepRenderer` wiring behind `captureMidi`,
   `DownloadTidy` counts, schema regeneration.
4. The `midi` library, which earns the auto-generated docs page and example study
   (`libraryDocGenerator.cjs` and `libraryExampleStudyGenerator.cjs` need no
   changes; registering `library-midi` in `public/global.json` with `test: true`
   pulls it into the automated sweep).
5. `allow="midi"` on the iframe, plus `postMessage` forwarding.
6. The docs-site page, covering the event model, the timing properties and what
   they do and do not license, the browser matrix, the two capture layers, and
   the note action-type naming convention that earns a stimulus its
   pitch-colored provenance nodes.
7. A real-hardware pass, which also settles the Loog's note range and the velocity
   curve.
8. Optional follow-ons: provenance legend, a piano-roll analysis view, channel
   filtering.

## Splitting it for review

If this goes upstream it splits cleanly, and steps 1 and 2 carry almost no risk:

1. `useMidi` + `midiNotes` + unit tests.
2. Provenance color overrides + render-level test.
3. `EventType`s, `captureMidi`, `StepRenderer`, `DownloadTidy`, schemas.
4. `MidiKeyboard` + the `midi` library + generated docs and example study.
5. `demo-midi` + the end-to-end spec.

Per `CLAUDE.md`, that PR would be based on upstream `dev`, pushed as
`lane/midi-input` to `revisit-studies/study`, with `CLAUDE.md`, `DEMO_BRANCH.md`
and `netlify.toml` left behind.
