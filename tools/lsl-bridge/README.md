# reVISit ↔ LSL bridge (fNIRS demo)

Connects a reVISit study running in the browser to the [Lab Streaming Layer](https://labstreaminglayer.readthedocs.io/)
network, so an fNIRS recording and the study's task structure share one clock —
and so the analysis page can show a trace the moment the session ends.

Nothing here is imported by the reVISit app. It is a standalone local agent; the
app never takes a dependency on a neuroimaging format or a vendor SDK.

## Why a bridge exists at all

Browsers cannot speak LSL. `liblsl` is a native library using UDP multicast for
discovery and TCP for transport, and there is no maintained browser client. So a
small loopback process sits between them.

## What runs where

```
  browser (reVISit)                  bridge (this)                  LSL network
  ────────────────────               ─────────────                  ───────────
  trial start/stop   ──ws──▶  publish reVISit-Markers outlet  ──▶  LabRecorder
  health indicator   ◀─ws──  status once per second                (writes .xdf)
  per-task trace     ◀─ws──  cut from its own rolling buffer  ◀──  Aurora / sim
                             drive LabRecorder over RCS :22345
```

Two independent consumers of the same LSL streams:

- **LabRecorder** writes the lab's canonical XDF, driven automatically over its
  Remote Control Server so there is no manual start/stop.
- **The bridge** keeps its own rolling buffer and cuts per-task windows from it.

That split is deliberate. reVISit never parses XDF (there is no JavaScript XDF
reader, and it should not need one), never waits for a file to close, and keeps
its analysis data even if LabRecorder is absent or wedged.

## Running the demo without hardware

```bash
pip install -r requirements.txt

# terminal 1 — the bridge
python3 revisit_lsl_bridge.py

# terminal 2 — a simulated NIRx-shaped stream
python3 sim_fnirs.py --pairs 4 --rate 10
```

The simulator subscribes to the bridge's marker stream, so it emits a canonical
double-gamma haemodynamic response whenever a task starts. If a bump shows up in
the analysis trace after task onset, then markers, clocks, buffering and
windowing all lined up. A flat trace means something upstream is broken.

Swapping in a real NIRSport2 means pointing Aurora's LSL export at the network
and stopping the simulator. Nothing on the reVISit side changes.

## What a study has to look like

The bridge is only half of this. A study that records sensor data has a shape,
and getting it wrong is how windows go missing:

```json
"uiConfig": {
  "lslBridge": { "enabled": true, "recordSensor": false, "leadIn": 5, "leadOut": 15 }
},
"components": {
  "barChartTask": { "recordSensor": true, ... }
},
"sequence": { "components": [
  "introduction",
  "$lsl-bridge.components.lslSetup",     // verifies the bridge before anything is recorded
  "barChartTask",                        // recordSensor: true
  "$lsl-bridge.components.lslWrapUp"     // waits for the last windows
]}
```

Three rules, each of which was a bug before it was a rule:

1. **Only tasks set `recordSensor`.** Instruction, setup and debrief screens are
   not tasks. Recording them produces windows that mean nothing, and anything
   before `lslSetup` is recorded before the sensor has been verified at all.
2. **`lslSetup` goes before the first recorded component.** It is the only thing
   that checks the bridge is up and the stream is flowing.
3. **`lslWrapUp` goes at the end, before `end`.** A window is cut `leadOut`
   seconds after its task finishes, so the last windows of a study land after
   the participant has answered everything. Without this screen they navigate
   away and those recordings are lost. The screen blocks until they arrive.

## Running it, and what to restart

Three processes. They are independent — restart only what changed:

| You changed | Restart |
| --- | --- |
| anything under `tools/lsl-bridge/*.py` | the bridge and the simulator |
| anything under `src/` or `public/` | nothing; Vite hot-reloads, but **reload the browser tab** |
| a study `config.json` | reload the browser tab |

```bash
yarn install && yarn serve                       # terminal 1, the app
cd tools/lsl-bridge
python3 revisit_lsl_bridge.py                    # terminal 2, the bridge
python3 sim_fnirs.py                             # terminal 3, the fake sensor
```

Then open `http://localhost:8080/demo-fnirs-lsl`.

A session that produced complete data looks like this:

* the setup screen shows three green checks before you can start
* the header badge reads **Signal connected** during the tasks
* the badge reads **Saving N traces…** for a few seconds after the last task
* the wrap-up screen reports **All sensor data saved** before you continue

If you open the analysis view before that last point, the tasks whose windows
had not yet arrived will have no trace. That is not a failure of the recording;
it is the lead-out still running.

## Tests

```bash
python3 tests/test_windowing.py      # segmentation rules, no LSL needed
python3 tests/test_labrecorder.py    # RCS protocol, against a mock server
python3 tests/test_end_to_end.py     # marker → LSL → HRF → window → browser
```

`test_end_to_end.py` asserts the returned trace actually *responds* to the
marker, and that HbR moves opposite to HbO. A structurally correct window over a
nonsense signal passes every other check; this is the one that catches it.

## On the analysis page

The trace is a row inside the replay timeline, on the same x scale as the
provenance track, with the playhead crossing both. So an event — a selection, a
response — can be read against the signal at that moment.

That scale is seconds from task start. A sensor window runs from a lead-in
before the task to a lead-out after it, so the shared domain is widened to cover
the whole window when one is present; events still land at their own times,
across a narrower span of the row. The task itself is marked, and the lead-in
and lead-out are shaded.

The domain is **not** widened when the task also has audio: the waveform is
rendered by WaveSurfer at full container width, independent of this scale, so
widening would slide it out of step. For a task with both, the trace is clipped
to the replay window and says how many samples that hides.

## Windowing, and why it is not clipped to the task

The haemodynamic response peaks ~5 s after onset and washes out over ~20 s. A
window clipped at the task boundary attributes the tail of one task's response
to the next task — silently, and the result still looks like a plausible trace.

So windows are widened: `[onset − lead_in, stop + lead_out]`, defaulting to 5 s
and 15 s, with times reported relative to onset so the renderer can draw a zero
line without knowing about LSL clocks. Study configs should leave a cooldown at
least as long as `lead_out` between tasks, so consecutive windows do not overlap.

The rolling buffer keeps the whole session (`--retain`, default 300 s), so
per-task windows are views over a continuous trace rather than the only record —
the full timeline can be reassembled later.

## Assumptions about the fNIRS stream

The lab runs NIRx hardware with Aurora. Nobody has confirmed what its LSL stream
actually looks like yet, so these are assumptions. Each one is written to be
cheap to be wrong about — none is hardcoded anywhere that matters.

| Assumption | Basis | If wrong |
| --- | --- | --- |
| Aurora streams **HbO/HbR concentration**, not raw intensity | Aurora computes concentrations online for its own neurofeedback path | Raw intensity needs modified Beer-Lambert conversion and motion-artifact correction upstream of this bridge. That is a signal-processing project, not plumbing, and belongs in Python before the LSL outlet — not here, and definitely not in the browser. |
| Stream **type** is `NIRS` | LSL convention | One `--sensor-type` flag |
| Channels labelled `S<n>_D<m> HbO\|HbR` | NIRx montage naming | Nothing: channels are classified from labels by `classify_channels()`, which handles `Oxy-Hb`, `HbO2`, `HHb`, `deoxyHb` and friends, and reports anything it cannot place as `unknown` rather than guessing |
| ~20 source-detector pairs, ~10 Hz | Typical small prefrontal montage | Nothing: the bridge reads `channel_count` and `nominal_srate` from the stream header at attach time |

**The sample rate is not a property of the device.** On NIRx hardware it falls
out of the montage and Aurora's multiplexing settings — published studies report
~3.9 Hz for high-density NIRScoutX, 4.5 Hz for a 16x16 / 43-channel NIRSport2
montage, and ~10 Hz for small prefrontal montages. So it changes when the montage
changes, and nothing downstream may assume a number. The bridge reads it from the
stream header and reports observed-vs-nominal in `status`.

The simulator's defaults (`--pairs 20 --rate 10.2`) are a plausible prefrontal
montage, not a claim about any specific setup.

### Still to confirm with the lab

1. Does Aurora stream raw intensity or HbO/HbR concentration?
2. Nominal rate, channel count and channel labels for the usual montage?
3. Does Aurora publish any **per-channel signal quality** on the LSL stream?
   (See the health section below — without this, the indicator can only report
   that the pipe is intact.)

## Health, and what it cannot tell you

`status.healthy` means **the pipe is intact**: inlet attached, samples arriving,
observed rate within 20% of nominal. It does **not** mean the signal is good.
Optode coupling, saturation and dark channels are judged during Aurora's
calibration, and this bridge cannot see them. Label the indicator in the UI as
connection health, or it becomes a confidence machine.

If Aurora can publish per-channel quality on its LSL stream, surface that
separately.

## Transport

The bridge listens on `ws://127.0.0.1:8765`. reVISit is served over HTTPS, so
this is an insecure-scheme WebSocket from a secure page.

Verified with `probe/run_probe.py`: an HTTPS page on a non-loopback origin
connected to `ws://localhost` under Chromium 141, both with default settings and
with `LocalNetworkAccessChecks` force-enabled. Loopback counts as a potentially
trustworthy target, so mixed-content blocking does not apply, and Chrome's
[Local Network Access](https://developer.chrome.com/blog/local-network-access)
permission does not currently gate WebSockets.

Chrome's own documentation calls that WebSocket exemption a known gap with
coverage planned, so re-run the probe when upgrading Chrome. Firefox and Safari
have not been checked here.

```bash
python3 probe/run_probe.py
```

## Browser protocol

JSON over the WebSocket. Browser → bridge:

| type | fields | effect |
| --- | --- | --- |
| `hello` | `studyId`, `participantId` | binds the session, probes LabRecorder |
| `startRecording` / `stopRecording` | — | drives LabRecorder over RCS |
| `marker` | `event`, `task`, `browserTime`, `detail` | pushes an LSL marker; `trialStart` / `trialStop` bound a window |

Bridge → browser: `status` (once per second), `window` (after each `trialStop`,
delayed by `lead_out` so the response tail is in the buffer), `recordingState`,
`warning`, `error`.

Markers are timestamped with `local_clock()` **on arrival at the bridge**, not in
the browser — the browser's epoch clock is not LSL's. That adds the loopback hop
plus event-loop jitter, which is negligible against a 5 s haemodynamic response
but will not be for eye tracking. Measure it before reusing this for gaze.
