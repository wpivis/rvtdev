# MIDI Piano Input with Provenance

This demo drives a reVISit stimulus with a MIDI piano instead of a mouse or
keyboard, and captures the result through both of reVISit's data channels at once.

## Before you start: this needs Chrome or Edge

The Web MIDI API is available in **Chrome and Edge on desktop only**.

- **Safari** does not support it on any version or platform, and has said it will
  not, citing fingerprinting risk.
- **Firefox** has supported it since version 108, but asks you to install a Site
  Permission Add-On first, which is more than we want to ask of a participant.

If you are reading this in Safari or Firefox, please reopen the study in Chrome or
Edge. The setup page will tell you if your browser cannot do this.

## What you need

A MIDI instrument connected to this computer over USB — this demo was built
against a Loog Piano, a 37-key velocity-sensitive keyboard spanning three octaves,
but any MIDI controller works. The setup page lists the instruments it can see and
asks you to play one note, so you can confirm the right device is connected and
that the keys respond to how hard you press before any task begins.

This study also asks permission to record your screen, so that the replay in the
analysis view shows the prompts advancing rather than just the moments you played.

## The task

A note name appears, and the matching key is outlined on the keyboard on screen.
Play that note. The melody advances to the next note when you play the right one;
playing a different note counts as a wrong note and leaves the prompt where it is.

Each trial also names a **target dynamic** — how hard to press. Getting it wrong
does not block you, but how close you got is recorded.

You can move to the next page at any time, whether or not you finish the melody.

## What gets recorded

Two different layers, answering different questions:

- **`windowEvents`** gets the raw instrument telemetry — every note on and note
  off with its velocity, any pedal or controller movement, and the set of
  connected devices — alongside the mouse and keyboard events reVISit already
  captures. This only happens because this study sets `captureMidi`; a study that
  does not ask for MIDI never subscribes to an instrument.
- **Trrack provenance** gets the semantic musical events: each prompt, and each
  note played with its velocity and whether it matched. In the analysis view those
  nodes are drawn in the color of the note's pitch class, so a trial reads as a
  piano roll — and because pitch classes are spaced around the circle of fifths,
  a wrong note a semitone off is a completely different color rather than a
  neighbouring shade.

Unlike a game controller, there was nothing to throttle or leave out. A keyboard
emits one event per note, so every event a participant produced is in the
provenance graph.

## Timing is actually good here

This is the interesting contrast with the gamepad demo. The Gamepad API has no
events: button state has to be polled once per animation frame and diffed, so its
timestamps carry up to one frame (roughly 8–16 ms) of error, bounded by the display
refresh rate.

MIDI messages are real events, and each one arrives carrying **its own timestamp**
from the MIDI stack rather than from whenever JavaScript next looked. The
inter-onset intervals this study reports are computed from those timestamps, which
is why they are shown to a hundredth of a millisecond. Timing-sensitive work —
rhythm, reaction time, keystroke dynamics — is genuinely viable on this input in a
way it is not on a polled device.

Velocity is the other thing a keyboard has and a controller does not: every note
carries a continuous measure of how hard it was struck, with no extra wiring.
