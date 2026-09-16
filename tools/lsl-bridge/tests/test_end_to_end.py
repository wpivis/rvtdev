"""Full loop: browser -> bridge -> LSL markers -> simulator HRF -> window back.

Asserts the trace actually responds to the marker, which is the only check that
proves markers, clocks, buffering and windowing all line up. A window that
arrives with a flat trace would pass every structural test and still be wrong.
"""
import asyncio, json, pathlib, subprocess, sys, time

HERE = pathlib.Path(__file__).resolve().parents[1]
TRIAL_SECONDS = 8.0
LEAD_OUT = 8.0


async def run():
    bridge = subprocess.Popen(
        [sys.executable, "revisit_lsl_bridge.py", "--lead-out", str(LEAD_OUT),
         "--lead-in", "5", "--port", "8799"],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    sim = subprocess.Popen(
        [sys.executable, "sim_fnirs.py", "--pairs", "2", "--rate", "10"],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        import websockets
        # The buffer must already span the lead-in before the first trial,
        # or the window is legitimately short (and reported as truncated).
        await asyncio.sleep(9.0)

        async with websockets.connect("ws://127.0.0.1:8799") as ws:
            await ws.send(json.dumps({"type": "hello", "studyId": "demo",
                                      "participantId": "p001"}))

            status = None
            deadline = time.time() + 15
            while time.time() < deadline:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                if msg.get("type") in ("hello", "status") and msg.get("connected"):
                    status = msg
                    break
            assert status, "bridge never reported a connected sensor stream"
            print(f"  sensor: {status['streamName']} "
                  f"{status['channels']}ch nominal={status['nominalRate']} "
                  f"effective={status['effectiveRate']} healthy={status['healthy']}")
            assert status["healthy"], f"bridge unhealthy: {status}"
            assert status["timeCorrection"] is not None, "no LSL time correction"

            await ws.send(json.dumps({"type": "marker", "event": "trialStart",
                                      "task": "barChart", "browserTime": 1}))
            await asyncio.sleep(TRIAL_SECONDS)
            await ws.send(json.dumps({"type": "marker", "event": "trialStop",
                                      "task": "barChart", "browserTime": 2}))

            window = None
            deadline = time.time() + LEAD_OUT + 20
            while time.time() < deadline:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                if msg.get("type") == "window":
                    window = msg
                    break
            assert window, "no window returned after trialStop"

        print(f"  window: task={window['task']} points={len(window['times'])} "
              f"span={window['times'][0]:.1f}..{window['times'][-1]:.1f}s "
              f"taskEnd={window['taskEnd']:.1f}s labels={window['channelLabels'][:2]} "
              f"truncated={window['truncatedStart']}/{window['truncatedEnd']}")

        assert window["times"][0] <= -4.5, "window missing lead-in"
        assert window["taskEnd"] >= TRIAL_SECONDS - 1.0
        assert window["times"][-1] >= window["taskEnd"] + LEAD_OUT - 1.0, "missing lead-out"
        assert not window["truncatedStart"], "buffer did not cover the lead-in"
        assert window["processing"] == "none", "trace must declare it is unprocessed"

        # Resolve chromophores from labels, never by index -- that is the whole
        # point of the classification the bridge ships in the payload.
        groups = window["chromophores"]
        assert groups["unknown"] == [], f"unclassified channels: {groups}"
        assert groups["HbO"] and groups["HbR"]
        hbo = window["values"][groups["HbO"][0]]
        times = window["times"]
        baseline = [v for t, v in zip(times, hbo) if t < 0]
        peak_band = [v for t, v in zip(times, hbo) if 4.0 <= t <= 14.0]
        assert baseline and peak_band
        lift = max(peak_band) - (sum(baseline) / len(baseline))
        print(f"  HbO lift over pre-onset baseline: {lift:.3f}")
        assert lift > 0.25, f"no haemodynamic response visible (lift={lift:.3f})"

        # HbR must move opposite to HbO, as it does in real tissue.
        hbr = window["values"][groups["HbR"][0]]
        hbr_band = [v for t, v in zip(times, hbr) if 4.0 <= t <= 14.0]
        hbr_base = [v for t, v in zip(times, hbr) if t < 0]
        hbr_delta = min(hbr_band) - (sum(hbr_base) / len(hbr_base))
        print(f"  HbR deflection: {hbr_delta:.3f}")
        assert hbr_delta < 0, "HbR should be anticorrelated with HbO"

        print("\nPASS end-to-end: marker -> LSL -> HRF -> window -> browser")
        return 0
    finally:
        for p in (sim, bridge):
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
