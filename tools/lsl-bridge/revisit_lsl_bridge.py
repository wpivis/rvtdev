"""Bridge between a reVISit study in the browser and the LSL network.

Browsers cannot speak LSL: liblsl is a native library using UDP multicast for
discovery and TCP for transport. This process sits on loopback and does four
things:

  1. Publishes a `reVISit-Markers` LSL outlet carrying trial lifecycle events,
     so anything recording on the LSL network shares reVISit's task structure.
  2. Subscribes to a sensor stream (fNIRS by default) and keeps a rolling buffer.
  3. Drives LabRecorder over its Remote Control Server, so the lab's canonical
     XDF is written without a manual start/stop.
  4. Cuts a per-task window out of its own buffer at trial end and hands it back
     to the browser, so the analysis page has a trace immediately.

Point 4 is why the browser never parses XDF: the samples are already here. The
XDF is the lab's artifact, written in parallel, and a LabRecorder failure does
not cost reVISit its data.

Usage:
    python3 revisit_lsl_bridge.py --sensor-type NIRS
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import time
from dataclasses import dataclass, field

import websockets
from pylsl import StreamInfo, StreamInlet, StreamOutlet, local_clock, resolve_byprop

from labrecorder import LabRecorder
from windowing import (
    DEFAULT_LEAD_IN, DEFAULT_LEAD_OUT, classify_channels, cut_window, detect_gaps,
    effective_rate,
)

PROTOCOL_VERSION = 1
STATUS_INTERVAL = 1.0


@dataclass
class SensorBuffer:
    """Rolling buffer of one LSL stream, trimmed to `retain` seconds."""
    retain: float
    times: list[float] = field(default_factory=list)
    samples: list[list[float]] = field(default_factory=list)
    channel_labels: list[str] = field(default_factory=list)
    nominal_rate: float = 0.0
    name: str = ""

    def append(self, chunk_times: list[float], chunk_samples: list[list[float]]) -> None:
        self.times.extend(chunk_times)
        self.samples.extend(chunk_samples)
        if not self.times:
            return
        cutoff = self.times[-1] - self.retain
        # Buffers are appended in order, so the first index at/after the cutoff
        # is the new start; bisect would be equivalent but this stays obvious.
        drop = 0
        for t in self.times:
            if t >= cutoff:
                break
            drop += 1
        if drop:
            del self.times[:drop]
            del self.samples[:drop]


class Bridge:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.buffer = SensorBuffer(retain=args.retain)
        self.inlet: StreamInlet | None = None
        self.marker_outlet = self._build_marker_outlet()
        self.labrecorder = LabRecorder(port=args.labrecorder_port)
        self.open_tasks: dict[str, float] = {}     # task -> onset LSL time
        self.session: dict[str, str] = {}
        self.last_sample_at: float | None = None
        self.time_correction: float | None = None
        self.recording = False

    # ---- LSL -------------------------------------------------------------

    def _build_marker_outlet(self) -> StreamOutlet:
        info = StreamInfo(
            self.args.marker_stream, "Markers", 1, 0.0, "string", "revisit-markers"
        )
        info.desc().append_child_value("source", "reVISit")
        return StreamOutlet(info)

    def _try_attach_sensor(self) -> None:
        if self.inlet is not None:
            return
        found = resolve_byprop("type", self.args.sensor_type, timeout=0.1)
        if not found:
            return
        info = found[0]
        self.inlet = StreamInlet(info, max_buflen=int(self.args.retain) + 1)
        self.buffer.name = info.name()
        self.buffer.nominal_rate = info.nominal_srate()
        self.buffer.channel_labels = _read_channel_labels(self.inlet.info(timeout=2.0))
        print(f"[bridge] attached to '{info.name()}' "
              f"({info.channel_count()} ch @ {info.nominal_srate()} Hz)")

    async def pump_sensor(self) -> None:
        """Drain the inlet continuously; LSL buffers, but not without bound."""
        while True:
            self._try_attach_sensor()
            if self.inlet is None:
                await asyncio.sleep(0.5)
                continue
            try:
                chunk, stamps = self.inlet.pull_chunk(timeout=0.0, max_samples=256)
            except Exception as exc:  # stream vanished mid-session
                print(f"[bridge] sensor inlet lost: {exc}")
                self.inlet = None
                await asyncio.sleep(0.5)
                continue
            if stamps:
                self.buffer.append(list(stamps), [list(s) for s in chunk])
                self.last_sample_at = time.monotonic()
            await asyncio.sleep(0.02)

    async def refresh_time_correction(self) -> None:
        """LSL's NTP-style offset between this host and the sensor's host."""
        while True:
            if self.inlet is not None:
                try:
                    self.time_correction = self.inlet.time_correction(timeout=1.0)
                except Exception:
                    self.time_correction = None
            await asyncio.sleep(5.0)

    # ---- health ----------------------------------------------------------

    def status(self) -> dict:
        stale = (
            None if self.last_sample_at is None
            else round(time.monotonic() - self.last_sample_at, 3)
        )
        rate = effective_rate(self.buffer.times)
        nominal = self.buffer.nominal_rate
        # "Healthy" here means the pipe is intact, never that the signal is good:
        # optode coupling and saturation are Aurora's to judge, not ours.
        connected = self.inlet is not None
        fresh = stale is not None and stale < self.args.stale_after
        on_rate = (
            rate is not None and nominal > 0 and abs(rate - nominal) / nominal < 0.2
        )
        return {
            "type": "status",
            "protocol": PROTOCOL_VERSION,
            "connected": connected,
            "streamName": self.buffer.name or None,
            "channels": len(self.buffer.channel_labels) or None,
            "channelLabels": self.buffer.channel_labels or None,
            "chromophores": (
                classify_channels(self.buffer.channel_labels)
                if self.buffer.channel_labels else None
            ),
            "nominalRate": nominal or None,
            "effectiveRate": round(rate, 2) if rate else None,
            "secondsSinceSample": stale,
            "gaps": detect_gaps(self.buffer.times, nominal),
            "bufferedSeconds": round(
                self.buffer.times[-1] - self.buffer.times[0], 1
            ) if len(self.buffer.times) > 1 else 0,
            "timeCorrection": self.time_correction,
            "labRecorder": {
                "available": self.labrecorder.available,
                "recording": self.recording,
                "error": self.labrecorder.last_error,
            },
            # The single flag the UI colours on. Connection health only.
            "healthy": bool(connected and fresh and on_rate),
        }

    async def broadcast_status(self, send) -> None:
        while True:
            await send(self.status())
            await asyncio.sleep(STATUS_INTERVAL)

    # ---- browser protocol ------------------------------------------------

    async def handle_message(self, raw: str, send) -> None:
        try:
            msg = json.loads(raw)
        except ValueError:
            await send({"type": "error", "message": "malformed JSON"})
            return

        kind = msg.get("type")
        if kind == "hello":
            self.session = {
                "studyId": str(msg.get("studyId", "study")),
                "participantId": str(msg.get("participantId", "unknown")),
            }
            self.labrecorder.probe()
            await send({"type": "hello", "protocol": PROTOCOL_VERSION, **self.status()})

        elif kind == "startRecording":
            self.recording = self.labrecorder.start(
                self.session.get("studyId", "study"),
                self.session.get("participantId", "unknown"),
            )
            await send({"type": "recordingState", "recording": self.recording,
                        "error": self.labrecorder.last_error})

        elif kind == "stopRecording":
            if self.labrecorder.stop():
                self.recording = False
            await send({"type": "recordingState", "recording": self.recording,
                        "error": self.labrecorder.last_error})

        elif kind == "marker":
            await self._handle_marker(msg, send)

        else:
            await send({"type": "error", "message": f"unknown message type {kind!r}"})

    async def _handle_marker(self, msg: dict, send) -> None:
        event = msg.get("event")
        task = str(msg.get("task", "unknown"))
        # Stamp on arrival: the browser's epoch clock is not the LSL clock, and
        # the loopback hop is far below the fNIRS response we care about.
        stamp = local_clock()
        payload = {
            "event": event,
            "task": task,
            "participantId": self.session.get("participantId"),
            "studyId": self.session.get("studyId"),
            "browserTime": msg.get("browserTime"),
            "detail": msg.get("detail"),
        }
        self.marker_outlet.push_sample([json.dumps(payload)], stamp)

        if event == "trialStart":
            self.open_tasks[task] = stamp
        elif event == "trialStop":
            onset = self.open_tasks.pop(task, None)
            if onset is None:
                await send({"type": "warning",
                            "message": f"trialStop for {task!r} with no matching start"})
                return
            # Wait out the lead-out so the response tail is actually in the
            # buffer before the window is cut.
            asyncio.create_task(self._emit_window(task, onset, stamp, send))

    async def _emit_window(self, task: str, onset: float, stop: float, send) -> None:
        await asyncio.sleep(self.args.lead_out + 0.5)
        if not self.buffer.times:
            await send({"type": "warning", "message": f"no sensor data for {task!r}"})
            return
        window = cut_window(
            self.buffer.times, self.buffer.samples, onset, stop, task,
            lead_in=self.args.lead_in, lead_out=self.args.lead_out,
            max_points=self.args.max_points,
        )
        await send({
            "type": "window",
            "task": window.task,
            "times": [round(t, 4) for t in window.times],
            "values": [[round(v, 6) for v in ch] for ch in window.values],
            "channelLabels": self.buffer.channel_labels,
            "taskStart": window.task_start,
            "taskEnd": round(window.task_end, 4),
            "leadIn": window.lead_in,
            "leadOut": window.lead_out,
            "truncatedStart": window.truncated_start,
            "truncatedEnd": window.truncated_end,
            "streamName": self.buffer.name,
            "nominalRate": self.buffer.nominal_rate,
            # Which indices are HbO vs HbR, resolved from labels. The renderer
            # must use this rather than assuming an interleaving order.
            "chromophores": classify_channels(self.buffer.channel_labels),
            # Surfaced so the analysis page can label the trace honestly.
            "processing": "none",
        })
        print(f"[bridge] sent window for {task!r}: "
              f"{len(window.times)} points, task 0..{window.task_end:.1f}s")


def _read_channel_labels(info) -> list[str]:
    labels: list[str] = []
    try:
        ch = info.desc().child("channels").child("channel")
        while not ch.empty():
            labels.append(ch.child_value("label") or f"ch{len(labels) + 1}")
            ch = ch.next_sibling()
    except Exception:
        pass
    return labels


async def serve(bridge: Bridge) -> None:
    async def handler(conn):
        print(f"[bridge] browser connected from {conn.remote_address}")
        lock = asyncio.Lock()

        async def send(payload: dict) -> None:
            async with lock:
                with contextlib.suppress(websockets.exceptions.ConnectionClosed):
                    await conn.send(json.dumps(payload))

        status_task = asyncio.create_task(bridge.broadcast_status(send))
        try:
            async for raw in conn:
                await bridge.handle_message(raw, send)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            status_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await status_task
            print("[bridge] browser disconnected")

    async with websockets.serve(handler, bridge.args.host, bridge.args.port):
        print(f"[bridge] listening on ws://{bridge.args.host}:{bridge.args.port}")
        print(f"[bridge] marker stream '{bridge.args.marker_stream}' published")
        await asyncio.Future()


async def main_async(args: argparse.Namespace) -> None:
    bridge = Bridge(args)
    await asyncio.gather(
        serve(bridge),
        bridge.pump_sensor(),
        bridge.refresh_time_correction(),
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--sensor-type", default="NIRS", help="LSL stream type to attach to")
    ap.add_argument("--marker-stream", default="reVISit-Markers")
    ap.add_argument("--labrecorder-port", type=int, default=22345)
    ap.add_argument("--lead-in", type=float, default=DEFAULT_LEAD_IN)
    ap.add_argument("--lead-out", type=float, default=DEFAULT_LEAD_OUT)
    ap.add_argument("--retain", type=float, default=300.0, help="buffer seconds")
    ap.add_argument("--max-points", type=int, default=600)
    ap.add_argument("--stale-after", type=float, default=2.0)
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n[bridge] stopped")


if __name__ == "__main__":
    main()
