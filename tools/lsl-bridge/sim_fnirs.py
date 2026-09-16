"""Simulated NIRx-shaped fNIRS stream on LSL.

Emits HbO/HbR concentration changes for a set of source-detector pairs, shaped
like what Aurora publishes: a slow drift, Mayer waves, respiration and cardiac
components, plus a canonical double-gamma haemodynamic response whenever a task
starts.

The HRF is driven by the reVISit marker stream, so the simulated brain actually
responds to the study. That makes the end-to-end demo meaningful without
hardware: if the analysis trace shows a bump after task onset, markers, clocks
and windowing all lined up.

Usage:
    python3 sim_fnirs.py --pairs 4 --rate 10.0
"""
import argparse
import json
import math
import random
import time

from pylsl import StreamInfo, StreamOutlet, StreamInlet, local_clock, resolve_byprop

# Canonical (SPM-style) double-gamma HRF: a response gamma peaking near 6 s and
# an undershoot gamma near 16 s, at one sixth the weight. Both are true gamma
# PDFs -- normalising each by its value at its own peak instead blows the
# undershoot term up by orders of magnitude and inverts the response.
HRF_RESPONSE_SHAPE = 6.0
HRF_UNDERSHOOT_SHAPE = 16.0
HRF_UNDERSHOOT_RATIO = 6.0
# HbR is anticorrelated with HbO and smaller in amplitude.
HBR_SCALE = -0.4


def _gamma_pdf(t: float, shape: float) -> float:
    """Gamma PDF with unit scale."""
    return (t ** (shape - 1.0)) * math.exp(-t) / math.gamma(shape)


# Peak of the composite, used to normalise hrf() to roughly unit amplitude.
_HRF_PEAK_VALUE = max(
    _gamma_pdf(t / 100.0, HRF_RESPONSE_SHAPE)
    - _gamma_pdf(t / 100.0, HRF_UNDERSHOOT_SHAPE) / HRF_UNDERSHOOT_RATIO
    for t in range(1, 3000)
)


def hrf(t: float) -> float:
    """Double-gamma haemodynamic response, zero before onset, peak ~1.0 at ~5 s."""
    if t <= 0:
        return 0.0
    value = (
        _gamma_pdf(t, HRF_RESPONSE_SHAPE)
        - _gamma_pdf(t, HRF_UNDERSHOOT_SHAPE) / HRF_UNDERSHOOT_RATIO
    )
    return value / _HRF_PEAK_VALUE


class MarkerListener:
    """Watches the reVISit marker stream and records task onsets."""

    def __init__(self, stream_name: str):
        self.stream_name = stream_name
        self.inlet = None
        self.onsets: list[tuple[float, float]] = []  # (lsl_time, amplitude)

    def try_connect(self) -> bool:
        if self.inlet is not None:
            return True
        found = resolve_byprop("name", self.stream_name, timeout=0.1)
        if found:
            self.inlet = StreamInlet(found[0])
            print(f"[sim] attached to marker stream '{self.stream_name}'")
            return True
        return False

    def poll(self) -> None:
        if not self.try_connect():
            return
        while True:
            sample, ts = self.inlet.pull_sample(timeout=0.0)
            if sample is None:
                return
            try:
                payload = json.loads(sample[0])
            except (ValueError, IndexError):
                continue
            if payload.get("event") == "trialStart":
                # Amplitude varies per task so the demo shows differentiable responses.
                amp = 0.4 + 0.6 * random.random()
                self.onsets.append((ts, amp))
                print(f"[sim] HRF triggered at {ts:.3f} (amp={amp:.2f}) "
                      f"task={payload.get('task')}")

    def response(self, now: float) -> float:
        # Responses superpose; drop onsets that have fully washed out.
        self.onsets = [(t, a) for t, a in self.onsets if now - t < 40.0]
        return sum(a * hrf(now - t) for t, a in self.onsets)


def build_outlet(pairs: int, rate: float) -> StreamOutlet:
    """Advertise the montage the way Aurora does: one LSL channel per
    source-detector pair per chromophore, labelled `S<n>_D<m> HbO|HbR`.

    Consumers must classify channels by these labels rather than by index: the
    interleaving order is an assumption we have not confirmed against a real
    Aurora stream (see ASSUMPTIONS in README.md).
    """
    channels = pairs * 2
    info = StreamInfo("SimNIRS", "NIRS", channels, rate, "float32", "revisit-sim-nirs")
    desc = info.desc()
    desc.append_child_value("manufacturer", "reVISit fNIRS simulator")
    chans = desc.append_child("channels")
    for pair in range(pairs):
        source = pair // 2 + 1
        detector = pair % 2 + 1
        for chromophore in ("HbO", "HbR"):
            ch = chans.append_child("channel")
            ch.append_child_value("label", f"S{source}_D{detector} {chromophore}")
            ch.append_child_value("type", chromophore)
            ch.append_child_value("unit", "micromolar")
    return StreamOutlet(info)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=20,
                    help="source-detector pairs; each yields an HbO and an HbR channel")
    ap.add_argument("--rate", type=float, default=10.2,
                    help="sampling rate, Hz. On NIRx hardware this falls out of the "
                         "montage and Aurora's multiplexing, not the device model: "
                         "published values run ~3.9 Hz (high density) to ~10 Hz (small "
                         "prefrontal montages). Nothing downstream hardcodes it.")
    ap.add_argument("--marker-stream", default="reVISit-Markers")
    ap.add_argument("--noise", type=float, default=0.05)
    args = ap.parse_args()

    outlet = build_outlet(args.pairs, args.rate)
    markers = MarkerListener(args.marker_stream)
    print(f"[sim] streaming SimNIRS: {args.pairs * 2} channels @ {args.rate} Hz")

    # Per-pair phase offsets so channels are not identical.
    phases = [random.random() * math.tau for _ in range(args.pairs)]
    period = 1.0 / args.rate
    next_tick = time.perf_counter()
    t0 = local_clock()

    while True:
        markers.poll()
        now = local_clock()
        elapsed = now - t0
        task_response = markers.response(now)

        sample = []
        for pair in range(args.pairs):
            ph = phases[pair]
            physiology = (
                0.30 * math.sin(math.tau * 0.10 * elapsed + ph)        # Mayer wave
                + 0.15 * math.sin(math.tau * 0.25 * elapsed + ph * 2)  # respiration
                + 0.08 * math.sin(math.tau * 1.10 * elapsed + ph * 3)  # cardiac
                + 0.20 * math.sin(math.tau * 0.008 * elapsed + ph)     # slow drift
            )
            # Response strength falls off across pairs: pair 1 is "on task".
            gain = 1.0 / (1.0 + pair)
            hbo = gain * task_response + physiology + random.gauss(0, args.noise)
            hbr = HBR_SCALE * gain * task_response + 0.4 * physiology + random.gauss(0, args.noise)
            sample.extend([hbo, hbr])

        outlet.push_sample(sample, now)
        next_tick += period
        sleep = next_tick - time.perf_counter()
        if sleep > 0:
            time.sleep(sleep)
        else:
            next_tick = time.perf_counter()


if __name__ == "__main__":
    main()
