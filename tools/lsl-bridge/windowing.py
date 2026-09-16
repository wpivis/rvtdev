"""Pure helpers for cutting per-task windows out of a continuous sample buffer.

Kept free of LSL and sockets so the segmentation rules can be unit tested, which
matters because getting them wrong is silent: a misaligned window still renders
as a plausible-looking trace.
"""
from __future__ import annotations

from dataclasses import dataclass

# The haemodynamic response peaks ~6 s after onset and washes out over ~20 s, so
# a window clipped to the task boundary attributes the tail of one task's
# response to the next task. Windows are widened at both ends instead, and the
# study config is expected to leave a cooldown at least as long as LEAD_OUT.
DEFAULT_LEAD_IN = 5.0
DEFAULT_LEAD_OUT = 15.0


@dataclass
class Window:
    """A per-task slice, carrying the task bounds it was widened around."""
    task: str
    times: list[float]          # seconds relative to task onset
    values: list[list[float]]   # one list per channel, parallel to `times`
    onset: float                # absolute LSL time of task onset
    task_start: float           # always 0.0, kept explicit for the renderer
    task_end: float             # task duration in seconds
    lead_in: float
    lead_out: float
    truncated_start: bool       # buffer did not reach back far enough
    truncated_end: bool


def cut_window(
    times: list[float],
    samples: list[list[float]],
    onset: float,
    stop: float,
    task: str,
    lead_in: float = DEFAULT_LEAD_IN,
    lead_out: float = DEFAULT_LEAD_OUT,
    max_points: int = 600,
) -> Window:
    """Slice [onset - lead_in, stop + lead_out] and downsample to max_points.

    `times` are absolute LSL timestamps, ascending. `samples[i]` is the channel
    vector at `times[i]`. Times are returned relative to `onset` so the renderer
    can draw a zero line at task start without knowing about LSL clocks.
    """
    if stop < onset:
        raise ValueError(f"task {task!r} stops ({stop}) before it starts ({onset})")

    lo = onset - lead_in
    hi = stop + lead_out

    idx = [i for i, t in enumerate(times) if lo <= t <= hi]
    picked = _thin(idx, max_points)

    # A window is truncated when the buffer simply did not span the request, not
    # when no sample happens to land exactly on the boundary.
    truncated_start = bool(times) and times[0] > lo
    truncated_end = bool(times) and times[-1] < hi

    n_channels = len(samples[0]) if samples else 0
    values: list[list[float]] = [[] for _ in range(n_channels)]
    rel_times: list[float] = []
    for i in picked:
        rel_times.append(times[i] - onset)
        for c in range(n_channels):
            values[c].append(samples[i][c])

    return Window(
        task=task,
        times=rel_times,
        values=values,
        onset=onset,
        task_start=0.0,
        task_end=stop - onset,
        lead_in=lead_in,
        lead_out=lead_out,
        truncated_start=truncated_start,
        truncated_end=truncated_end,
    )


def _thin(idx: list[int], max_points: int) -> list[int]:
    """Evenly thin an index list, always keeping the first and last entries."""
    if max_points <= 0 or len(idx) <= max_points:
        return idx
    step = (len(idx) - 1) / (max_points - 1)
    thinned = [idx[round(i * step)] for i in range(max_points)]
    # Rounding can repeat an index; de-duplicate while preserving order.
    seen: set[int] = set()
    return [i for i in thinned if not (i in seen or seen.add(i))]


def effective_rate(times: list[float], window_seconds: float = 5.0) -> float | None:
    """Observed sample rate over the tail of the buffer, or None if too short."""
    if len(times) < 2:
        return None
    cutoff = times[-1] - window_seconds
    tail = [t for t in times if t >= cutoff]
    if len(tail) < 2:
        return None
    span = tail[-1] - tail[0]
    return (len(tail) - 1) / span if span > 0 else None


def detect_gaps(times: list[float], nominal_rate: float, tolerance: float = 3.0) -> int:
    """Count inter-sample gaps longer than `tolerance` nominal periods."""
    if nominal_rate <= 0 or len(times) < 2:
        return 0
    limit = tolerance / nominal_rate
    return sum(1 for a, b in zip(times, times[1:]) if b - a > limit)


# Channel ordering within an fNIRS stream is vendor- and montage-dependent, and
# we have not confirmed Aurora's against real hardware. Anything downstream that
# needs "the HbO channels" must ask by label, never by index, or a montage change
# silently relabels the trace.
#
# Order matters: "deoxy-hb" contains "oxy-hb", and "hhb" contains "hb", so the
# deoxygenated patterns are tested first and the generic ones last.
HBR_PATTERNS = ("deoxy", "hbr", "hhb")
HBO_PATTERNS = ("hbo", "oxyhb", "oxy-hb", "oxy_hb", "o2hb", "hbo2")
HBT_PATTERNS = ("hbt", "total-hb", "totalhb")


def classify_channels(labels: list[str]) -> dict[str, list[int]]:
    """Group channel indices by chromophore, from their LSL labels.

    Returns {"HbO": [...], "HbR": [...], "HbT": [...], "unknown": [...]}.
    Matching is case-insensitive. Deoxygenated patterns are checked first
    because several vendor spellings of HbR contain an HbO pattern as a
    substring.
    """
    out: dict[str, list[int]] = {"HbO": [], "HbR": [], "HbT": [], "unknown": []}
    for i, raw in enumerate(labels):
        label = (raw or "").lower()
        if any(p in label for p in HBR_PATTERNS):
            out["HbR"].append(i)
        elif any(p in label for p in HBT_PATTERNS):
            out["HbT"].append(i)
        elif any(p in label for p in HBO_PATTERNS):
            out["HbO"].append(i)
        else:
            out["unknown"].append(i)
    return out
