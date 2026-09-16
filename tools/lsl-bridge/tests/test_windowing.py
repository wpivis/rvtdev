import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from windowing import cut_window, detect_gaps, effective_rate  # noqa: E402


def _ramp(n, rate=10.0, t0=100.0):
    times = [t0 + i / rate for i in range(n)]
    samples = [[float(i), -float(i)] for i in range(n)]
    return times, samples


def test_window_spans_lead_in_and_lead_out():
    times, samples = _ramp(600)          # 60 s at 10 Hz starting at t=100
    w = cut_window(times, samples, onset=120.0, stop=130.0, task="t1",
                   lead_in=5.0, lead_out=15.0, max_points=10_000)
    assert w.times[0] == -5.0
    assert w.times[-1] == 25.0           # 10 s task + 15 s lead-out
    assert w.task_start == 0.0 and w.task_end == 10.0
    assert not w.truncated_start and not w.truncated_end


def test_times_are_relative_to_onset():
    times, samples = _ramp(600)
    w = cut_window(times, samples, onset=120.0, stop=130.0, task="t1")
    # Task onset is the zero line regardless of where LSL's clock happened to be.
    assert min(abs(t) for t in w.times) == 0.0


def test_truncation_is_reported_not_silently_padded():
    times, samples = _ramp(100)          # only 10 s of buffer
    w = cut_window(times, samples, onset=101.0, stop=106.0, task="t1",
                   lead_in=5.0, lead_out=15.0)
    assert w.truncated_start and w.truncated_end


def test_downsampling_keeps_endpoints_and_respects_budget():
    times, samples = _ramp(6000, rate=100.0)
    w = cut_window(times, samples, onset=110.0, stop=140.0, task="t1", max_points=50)
    assert len(w.times) <= 50
    assert w.times[0] == -5.0
    assert abs(w.times[-1] - 45.0) < 0.02


def test_channels_stay_parallel_to_times():
    times, samples = _ramp(600)
    w = cut_window(times, samples, onset=120.0, stop=130.0, task="t1", max_points=37)
    assert len(w.values) == 2
    assert all(len(ch) == len(w.times) for ch in w.values)


def test_stop_before_start_is_rejected():
    times, samples = _ramp(600)
    try:
        cut_window(times, samples, onset=130.0, stop=120.0, task="t1")
    except ValueError:
        return
    raise AssertionError("expected ValueError for inverted task bounds")


def test_effective_rate_and_gap_detection():
    times = [i / 10.0 for i in range(100)]
    assert abs(effective_rate(times) - 10.0) < 0.1
    assert detect_gaps(times, 10.0) == 0
    times_with_gap = times[:50] + [t + 5.0 for t in times[50:]]
    assert detect_gaps(times_with_gap, 10.0) == 1


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:
                fails += 1
                print(f"FAIL {name}: {exc}")
    sys.exit(1 if fails else 0)
