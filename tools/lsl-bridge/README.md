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

## Tests

```bash
python3 tests/test_windowing.py      # segmentation rules, no LSL needed
python3 tests/test_labrecorder.py    # RCS protocol, against a mock server
python3 tests/test_end_to_end.py     # marker → LSL → HRF → window → browser
```

`test_end_to_end.py` asserts the returned trace actually *responds* to the
marker, and that HbR moves opposite to HbO. A structurally correct window over a
nonsense signal passes every other check; this is the one that catches it.

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
