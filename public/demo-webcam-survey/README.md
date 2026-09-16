# demo-webcam-survey — ASPIRE Cabarrus self-assessment

A phone-shaped demo of reVISit's webcam recording feature on an image-first
survey. Separate from `library-webcam-recording`, which demonstrates the library
component itself; this one exercises the feature inside a realistic instrument.

Run it at `/demo-webcam-survey`.

## What it demonstrates

- A single long-lived camera + microphone stream, acquired once on
  `$webcam-recording.components.webcamRecordingPermission` and re-attached on every
  later step, so the participant is never re-prompted mid-survey.
- A small mirrored **self-view** that stays visible while the participant answers.
  Placement is a per-component config value, `parameters.selfView`:
  - `"bar"` (default) — a 51px recording bar under the stimulus with the live tile,
    a blinking dot, a rotating think-aloud probe, a level meter, and a mute button.
  - `"floating"` — a 74px picture-in-picture plate pinned to the top right. Adds no
    chrome height, at the cost of covering a sliver of the stimulus.
  - `"off"` — no self-view.
- Answer-derived copy: the think-aloud follow-up heading, the answer recap, and the
  end summary all read from stored answers rather than hard-coded levels.
- Required-response gating on a `react-component` stimulus via a hidden `reactive`
  response plus `setAnswer({ status: false, ... })`.

## Content

The instrument is adapted from the **Poverty Stoplight** as used by ASPIRE in
Cabarrus County, NC — *Health and Environment*, Indicator 19 (Household Violence)
and Indicator 18 (Addiction). Level wording is verbatim from the instrument.

## Photographs

The printed ASPIRE cards carry three photographs per indicator. Rights to that
photography sit with Fundación Paraguaya and the ASPIRE program, so no photographs
are committed here. Each card renders an empty photo slot with the correct square
geometry instead.

To add the real images, drop the files at the paths already configured in
`config.json`:

```
public/demo-webcam-survey/assets/aspire/violence-{green,yellow,red}.png
public/demo-webcam-survey/assets/aspire/addiction-{green,yellow,red}.png
```

They are picked up with no code change. Use square source crops — the photo column
is `aspect-ratio: 1` with `object-fit: cover`, which is what keeps faces from being
clipped.

## Known gaps

- The shared study chrome (`AppHeader`, `AppAside`) is still desktop-sized. At
  390px the header's recording indicator overlaps the study title, and the dev-mode
  Study Browser covers the stimulus. The study's own screens are laid out for
  390×844; the chrome around them is not.
- Denying camera permission currently blocks the study rather than degrading to
  audio only: `WebcamRecordingPermission` keeps its Continue button disabled until
  `isWebcamCapturing` is true.
