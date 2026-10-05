# Testing `demo-midi` with the real piano

Everything on this branch has been verified against a **synthetic** MIDI port in
Chromium. This is the checklist for the first run with actual hardware. It should
take about ten minutes.

## What to plug in

The **Loog x Duolingo Piano**, connected to the laptop with a **USB-C data
cable**. Two things to watch:

- Use a cable that carries data, not a charge-only cable. If the piano powers up
  but never appears in the device list, suspect the cable first.
- Connect it directly rather than through a hub or a dock if you can. Hubs are
  usually fine for MIDI, but they are one more thing to rule out.
- Switch the piano on before opening the study page. Hot-plugging is handled — the
  device list updates with no reload — but a clean start is one less variable.

Nothing else is needed. No driver, no app: USB MIDI is class-compliant, and the
browser talks to it directly.

## Which browser

**Chrome or Edge.** Not Safari — it has no Web MIDI at all, on any version, and
there is no flag to turn on. Not Firefox either: it technically supports Web MIDI
from 108, but asks you to install a Site Permission Add-On first.

If you open it in Safari to see what a participant would see, the expected result
is the setup page showing a red "This browser cannot talk to a MIDI instrument"
panel naming Chrome and Edge. That is the designed behaviour, not a failure.

## Where to go

**Netlify branch deploy:** https://claude-midi-demo--rvtdev.netlify.app/demo-midi

This only exists once you have added `claude/midi-demo` to the Netlify site's
branch-deploy list — the site deploys a named list of branches, not all of them.
Adding a branch does **not** retroactively build commits that were already pushed,
so after adding it, either push an empty commit or hit *Trigger deploy* in the
Netlify UI.

**Or run it locally**, which avoids the Netlify step entirely:

```sh
git fetch origin claude/midi-demo && git checkout claude/midi-demo
yarn install
yarn serve      # http://localhost:8080
```

Then open `http://localhost:8080/demo-midi` in Chrome.

> Web MIDI needs a secure context. `localhost` counts as secure, so local dev is
> fine, and so is the HTTPS Netlify deploy. A plain-HTTP page served from your
> machine's LAN address would not be.

## What to click, and what you should see

### 1. Introduction

A markdown page about the study, including the Chrome/Edge requirement. Click
**Next**.

### 2. MIDI Instrument Setup

This is the page that matters most.

- **A table listing your instrument** should appear within a second or so, with no
  interaction at all — probably `Loog Piano` under Name, something under
  Manufacturer, and `receiving` under Status. The manufacturer may be blank or odd;
  that is the OS's string, not ours.
  - *This is the first thing worth noticing.* The gamepad demo had to ask you to
    press a button before the browser would admit a controller existed. MIDI hands
    over the device list immediately. If you see the table before touching the
    keys, the event-driven path is working.
  - Chrome should grant this **without a permission prompt** (we deliberately do
    not request sysex, which is what triggers one). If you do get a prompt, allow
    it and make a note — it is worth knowing which Chrome version prompts.
- **Click Continue before playing anything.** It should refuse to advance and show
  *"Please play one note on your instrument to confirm it is working."* The button
  stays clickable — that is how reVISit gates — but the page should not change.
- **Play a few keys.** Each should light up on the on-screen keyboard in its own
  color, and a badge should appear naming the note and how hard you hit it, e.g.
  `C4 · loud (112)`.
  - **Play one note very softly and one hard.** The velocity number should differ
    noticeably, and the key's color should look washed out for the soft one and
    saturated for the hard one. This is the check that velocity is actually
    working, rather than the keyboard sending a fixed value.
  - **Check the note names match the keys you pressed.** Middle C should read
    `C4`. If the whole keyboard reads an octave off, the piano uses a different
    octave convention — tell me and it is a one-line config change.
  - **Check the range.** The on-screen keyboard draws C3 to C6 by default, 37
    keys. If your lowest and highest physical keys fall outside that, some presses
    will not light anything up. Also fixable in config (`lowestNote`,
    `keyCount` on the component).
- A green **Instrument confirmed** badge appears once you have played a note.
  **Click Continue.**

### 3. Screen Recording Permission

Standard reVISit screen-recording page. Click **Start Recording**, share the tab
or window, wait for **Continue** to enable, click it.

### 4. First trial — "midi-scale"

Five notes up a C major scale: **C4 D4 E4 F4 G4**, all white keys, target dynamic
*medium*.

- A large note name shows what to play, and that key is outlined on the keyboard.
- **Play a deliberately wrong note first.** Misses should go to 1, hits stay 0,
  the prompt should not move, and the outcome line should say something like
  *"Miss — played D♯4, wanted C4"*.
- **Play the prompted notes in order.** Each correct note advances the prompt and
  increments hits. After the fifth, the outcome reads *"G4 — melody complete"*.
- **Look at the line under the counters.** After the second note it should read
  something like *"Interval since previous note: 412.37 ms (from the MIDI
  timestamp, not a frame boundary)"*.
  - *This is the second thing worth noticing.* Those two decimal places are real.
    They come from the MIDI message's own timestamp, not from when the browser got
    around to looking. The gamepad could not do this — its timestamps were
    quantised to the display refresh, 8–16 ms. If those digits look plausible and
    vary smoothly, the timing claim in the write-up holds on this hardware.
- The sidebar should show the reactive responses filling in: notes hit, wrong
  notes, mean velocity error, mean interval, interval jitter, mean note duration.

**If you have a sustain pedal**, press and release it during the trial. Nothing
visible happens on screen, but it should appear in the exported data as `midicc`
entries with controller 64 and values 127 then 0.

### 5. Second trial — "midi-chromatic"

**C4 C♯4 D♯4 F♯4 G♯4 B4** — mixes black and white keys, target dynamic *loud*,
tighter tolerance. Same mechanics. The point of this one is the colors: adjacent
semitones should look completely different from each other, not like neighbouring
shades.

### 6. The payoff — the analysis view

This is what the whole exercise is for.

Open the study's analysis view and look at the **provenance timeline** for a
trial. Each note you played is a node painted in its pitch class's color, in the
order you played them, so the trial reads as a **piano roll**. Specifically:

- The same note in different octaves is the **same** color.
- A note a semitone off the prompted one is a **completely different** color, not a
  similar one. That is deliberate — see the circle-of-fifths section in
  `notes/midi-support-proposal.md`.
- The prompt nodes are grey-ish hashed colors, so they read as scaffolding rather
  than as notes.

Scrub the replay. The screen recording should show the prompts advancing, and the
provenance nodes should line up with the notes.

## Also worth trying

- **Unplug the piano mid-trial.** A "Waiting for a MIDI instrument" overlay should
  appear over the keyboard. Plug it back in and it should disappear, with no
  reload, and the trial should still be playable.
- **Play a chord**, several keys at once. All of them should light up. Only the
  prompted note counts for advancing, but every note should land in the data.
- **Download the tidy export** and check the window-event counts include
  `midinoteon`, `midinoteoff`, `midicc` and `mididevice`.

## Worth a look because review caught it on the gamepad

Upstream review of the gamepad PR found that a participant without a working device
was trapped on the trial. The equivalent bug was in this code too and is fixed, but
it is worth confirming by hand, because it is the failure a real participant is most
likely to hit:

- **Unplug the piano during a trial and click Next.** It should advance. If it
  refuses with "Please complete the stimulus interaction to continue", the
  mount-time answer has regressed.
- **If you have a mod wheel or expression pedal**, sweep it and leave it somewhere
  in the middle. The exported `midicc` entries should end at roughly where you left
  it, not where the sweep started.
- **Open the study in Safari once.** You should get the red panel naming Chrome and
  Edge, and **Continue should still work** — it records that you had no MIDI rather
  than stranding you. That is deliberate: no action a Safari user takes could ever
  satisfy a MIDI gate.

## If something is wrong

Useful things to capture, in rough order of usefulness:

1. Which step it broke at, and what the screen said.
2. The browser console — any error from `requestMIDIAccess` is the most
   informative single thing.
3. What the setup page's device table showed, verbatim.
4. For wrong note names or a dead range: which physical key you pressed and what
   the screen called it.
5. For timing: whether the interval line showed two decimals and whether the
   numbers looked sane.

Known-unverified items are listed as "No real-hardware pass" in
`notes/midi-support-proposal.md` — the Loog's actual note range, whether it sends
note-off or note-on-with-velocity-0, its velocity curve, and its real timestamp
resolution are all guesses until this run.
