# fNIRS via Lab Streaming Layer

This study publishes its trial boundaries onto the LSL network as markers, and
shows the per-task fNIRS trace that comes back on the analysis page.

## Before you start

Both of these must be running on this machine:

```
cd tools/lsl-bridge
python3 revisit_lsl_bridge.py     # terminal 1
python3 sim_fnirs.py              # terminal 2 (no hardware needed)
```

The next screen checks both and will not let you continue until they are working.

## What gets recorded

Only the three tasks — **Rest**, **Bar chart** and **Scatter plot**. This screen
and the setup check are not tasks, so they are not recorded.

## At the end

The last screen waits for the final recordings to arrive. This takes a few
seconds after the last task, because the haemodynamic response being measured
outlasts the task that caused it. **Do not close the tab until that screen says
everything is saved.**
