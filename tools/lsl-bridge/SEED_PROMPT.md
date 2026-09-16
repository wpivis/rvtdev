# Seed prompt — run the fNIRS/LSL demo locally

Paste everything below the line into a fresh Claude Code session opened on a
local clone of this repo, on branch `claude/ecstatic-thompson-1rfeaz`. It is
written to stand alone — it assumes no memory of the design conversation.

---

I'm working on `wpivis/rvtdev` (a fork of reVISit). I want to run and extend an
fNIRS-over-LSL demo that already exists in this repo under `tools/lsl-bridge/`.
Read `tools/lsl-bridge/README.md` first — it has the architecture and the
reasoning behind it. Short version:

- reVISit runs in the browser and can't speak LSL (native library, UDP multicast
  discovery), so `tools/lsl-bridge/revisit_lsl_bridge.py` sits on loopback.
- The bridge publishes a `reVISit-Markers` LSL outlet from trial lifecycle
  events, subscribes to an fNIRS stream, drives LabRecorder over its Remote
  Control Server (TCP 22345) so the lab's XDF gets written with no manual steps,
  and cuts per-task windows from its own rolling buffer to hand back to the
  browser.
- reVISit deliberately never parses XDF. The bridge already has the samples from
  LSL; the XDF is the lab's parallel artifact.
- `tools/lsl-bridge/sim_fnirs.py` fakes a NIRx-shaped stream and emits a
  canonical double-gamma haemodynamic response when it sees a task start, so the
  whole loop is testable with no hardware.

## What is already done and verified

- Bridge, simulator, windowing helpers, LabRecorder RCS client.
- `tests/test_windowing.py` — segmentation rules (7 tests, passing).
- `tests/test_end_to_end.py` — marker → LSL → HRF → window → browser, asserting
  the trace actually responds and that HbR is anticorrelated with HbO (passing).
- `probe/run_probe.py` — confirmed an HTTPS page on a non-loopback origin can
  open `ws://localhost` under Chromium 141, with and without
  `LocalNetworkAccessChecks` enabled.

## What I want from you

**First, verify it still runs on my machine:**

```bash
cd tools/lsl-bridge
pip install -r requirements.txt
python3 tests/test_windowing.py
python3 tests/test_end_to_end.py
python3 probe/run_probe.py     # confirms the transport on my actual browser
```

Report what passes and what doesn't before changing anything. If
`test_end_to_end.py` fails on the haemodynamic-response assertion, that is a real
failure of the marker/clock/windowing chain, not a flaky test — debug it rather
than relaxing the threshold.

**Then, wire up the reVISit side.** None of this exists yet:

1. **Config surface.** Add to `uiConfig` in `src/parser/types.ts`: an optional
   `lslBridge` block (enabled, host, port, sensorType, leadIn, leadOut) and a
   per-component `cooldownTime` (seconds of blank screen after a task, so
   consecutive fNIRS windows don't overlap — it must be at least `leadOut`).
   Regenerate schemas with `yarn generate-schemas` and add parser unit tests.

2. **`useLsl` hook** in `src/store/hooks/`. Opens the WebSocket, sends `hello`,
   emits `marker` messages on trial start/stop, exposes connection status and
   received windows. Follow the shape of `src/store/hooks/useRecording.ts`, and
   watch the lifecycle carefully — reconnect with backoff, and tear down cleanly.
   Unit test in `src/store/hooks/tests/useLsl.spec.tsx` (vitest).

3. **Setup/sync page** as a library component under
   `public/libraries/lsl-bridge/`, mirroring how
   `$screen-recording.components.screenRecordingPermission` gates screen capture
   (see `src/store/hooks/useRecording.ts:245`). It should show: bridge reachable,
   named LSL stream present, effective vs nominal rate, LabRecorder reachable.

4. **Persistent health indicator** during the study. Read the README section on
   what health means — it is *connection* health, never signal quality. Label it
   that way in the UI. Do not imply the optodes are well coupled; the bridge
   cannot know that.

5. **Analysis track.** Add an fNIRS trace to the existing time-aligned footer.
   `src/analysis/individualStudy/thinkAloud/ThinkAloudFooter.tsx` composes
   `AudioProvenanceVis` and `TranscriptSegmentsVis` on a shared time axis; d3 is
   already a dependency. Draw the task boundary as a marker inside the wider
   window rather than clipping to it, and label the trace as unprocessed — it is
   raw concentration change, not a result. Store windows through the existing
   `saveAsset` path in `src/storage/engines/types.ts` (as `saveAudioRecording`
   and `saveScreenRecording` do).

**One known bug to fix while you're in there:** `_copyDirectory` and
`_deleteDirectory` in `src/storage/engines/types.ts` hardcode the
`screenRecording` prefix (around lines 1848, 1896, 1964). Any new asset prefix
must be registered there or the data survives participant deletion — that's an
IRB problem, not a tidiness one. Consider making the prefix list a registry.

## House rules

- Read `AGENTS.md` first. No new npm dependencies without asking.
- Unit tests live in a sibling `tests/` folder, same base name, `.spec.`, vitest.
- Don't run `yarn test` directly; use `yarn unittest`, `yarn lint`, `yarn typecheck`.
- No `import()` inside `src` — top-level imports only, including types.
- Commit to `claude/ecstatic-thompson-1rfeaz`. Don't open a PR unless I ask.
