# fNIRS via Lab Streaming Layer

This study publishes its trial boundaries onto the LSL network as markers, and
shows the per-task fNIRS trace that comes back on the analysis page.

It needs the bridge running on this machine:

```bash
cd tools/lsl-bridge
python3 revisit_lsl_bridge.py          # terminal 1
python3 sim_fnirs.py                   # terminal 2 (no hardware needed)
```

The simulator responds to the marker stream with a haemodynamic response, so a
bump after task onset means markers, clocks and windowing all lined up.
