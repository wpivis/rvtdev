"""Drives the real reVISit app and asserts its trials reach the LSL network.

This is the claim the whole design rests on: that a study running in a browser
puts its task structure onto LSL where a recorder can see it. So rather than
reading the bridge's logs, the test subscribes its own LSL inlet to the
reVISit-Markers stream -- exactly as LabRecorder or Aurora would -- and checks
what actually arrived.

Requires the vite dev server on :8080 and Chromium.
"""
import asyncio
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parents[1]
LEAD_OUT = 4

# localforage keeps its values in IndexedDB; read the keys back to prove the
# sensor windows were actually written rather than merely received.
STORED_KEYS_JS = """
async () => {
  const dbs = (await indexedDB.databases?.()) || [{ name: 'localforage' }];
  const keys = [];
  for (const { name } of dbs) {
    if (!name) continue;
    const db = await new Promise((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) continue;
    for (const store of Array.from(db.objectStoreNames)) {
      const got = await new Promise((res) => {
        const r = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => res([]);
      });
      keys.push(...got.map(String));
    }
    db.close();
  }
  return keys;
}
"""
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
STUDY_URL = "http://localhost:8080/demo-fnirs-lsl"


def collect_markers(stop_after: float, out: list):
    """Subscribe to the marker stream the way any LSL consumer would."""
    from pylsl import StreamInlet, resolve_byprop

    found = resolve_byprop("name", "reVISit-Markers", timeout=15.0)
    if not found:
        return
    inlet = StreamInlet(found[0])
    deadline = time.time() + stop_after
    while time.time() < deadline:
        sample, ts = inlet.pull_sample(timeout=0.5)
        if sample:
            try:
                out.append((ts, json.loads(sample[0])))
            except ValueError:
                pass


async def drive_study() -> list:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=["--no-proxy-server"])
        page = await (await browser.new_context()).new_page()
        console = []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        await page.goto(STUDY_URL, wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(3000)

        # Walk the sequence: introduction -> lslSetup -> restBaseline ->
        # barChartTask -> scatterTask. The setup gate keeps Continue disabled
        # until the bridge reports a healthy stream, so each click waits for it.
        for step in range(4):
            await page.wait_for_timeout(2500)
            radios = page.locator("input[type=radio]")
            if await radios.count():
                await radios.first.check()
                await page.wait_for_timeout(300)
            # Exact match matters: the dev Study Browser also renders a
            # "Next Participant" button, and clicking that restarts the study.
            nxt = page.get_by_role("button", name="Next", exact=True)
            cont = page.get_by_role("button", name="Continue", exact=True)
            button = cont if await cont.count() else nxt
            if await button.count() == 0:
                console.append(f"no advance button at step {step}")
                break
            try:
                await button.first.wait_for(state="visible", timeout=20000)
                await button.first.click(timeout=20000)
            except Exception as exc:  # noqa: BLE001 - reported, not swallowed
                console.append(f"could not advance at step {step}: {exc}")
                break

        # Windows are cut lead_out seconds after a task ends, so the page has to
        # stay open past the last boundary for the writes to happen at all.
        await page.wait_for_timeout((LEAD_OUT + 6) * 1000)
        stored = await page.evaluate(STORED_KEYS_JS)
        await browser.close()
        return console, stored


async def main() -> int:
    bridge = subprocess.Popen(
        [sys.executable, "revisit_lsl_bridge.py", "--lead-out", str(LEAD_OUT), "--lead-in", "5"],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    sim = subprocess.Popen(
        [sys.executable, "sim_fnirs.py", "--pairs", "4", "--rate", "10"],
        cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    markers: list = []
    try:
        await asyncio.sleep(5)
        loop = asyncio.get_running_loop()
        collector = loop.run_in_executor(None, collect_markers, 60.0, markers)
        console, stored = await drive_study()
        await collector

        errors = [c for c in console if c.startswith("pageerror")]
        print(f"  page errors: {errors if errors else 'none'}")
        assert not errors, f"study threw in the browser: {errors[:2]}"

        events = [(m.get("event"), m.get("task")) for _, m in markers]
        print(f"  markers on the LSL network: {len(markers)}")
        for ts, m in markers:
            print(f"    {ts:.3f}  {m.get('event'):<10} {m.get('task')}")

        assert markers, "no reVISit markers reached the LSL network"
        starts = [t for e, t in events if e == "trialStart"]
        stops = [t for e, t in events if e == "trialStop"]
        assert len(starts) >= 2, f"expected several trialStarts, got {starts}"
        assert stops, f"expected at least one trialStop, got {events}"

        # Identity must survive the trip, or a recording cannot be joined to the study.
        ids = {m.get("participantId") for _, m in markers}
        studies = {m.get("studyId") for _, m in markers}
        print(f"  participantIds={ids} studyIds={studies}")
        assert studies == {"demo-fnirs-lsl"}, f"studyId did not survive: {studies}"
        assert all(i for i in ids), f"markers carried no participant id: {ids}"

        # Every stop must match a start, or windows are cut against nothing.
        assert set(stops) <= set(starts), f"stop without a matching start: {stops} vs {starts}"

        # Task names must name real components, not indices.
        joined = " ".join(starts)
        for component in ("introduction", "lslSetup", "restBaseline", "barChartTask"):
            assert component in joined, f"{component!r} missing from {starts}"

        sensor_keys = [k for k in stored if "/sensor/" in k]
        print(f"  sensor windows written to storage: {len(sensor_keys)}")
        for k in sensor_keys:
            print(f"    {k}")
        assert sensor_keys, (
            "no sensor window reached storage; "
            f"saw {len(stored)} keys, e.g. {stored[:5]}"
        )

        print("\nPASS reVISit trials reach the LSL network, and windows reach storage")
        return 0
    finally:
        for proc in (sim, bridge):
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
