# LSL Bridge: Lab Streaming Layer Sensor Setup

This is a demo of the library `lsl-bridge`.

Setup gate for studies that stream sensor data (fNIRS, EEG, eye tracking, GSR) through a local Lab Streaming Layer bridge. Checks that the bridge is reachable, that a sensor stream has been found on the LSL network, and that samples are arriving at the expected rate, before letting the study begin. Requires uiConfig.lslBridge to be configured and the bridge process to be running on the machine presenting the study.

## Reference

C. Kothe, S. Shirazi, T. Stenner, D. Medine, C. Boulay, M. I. Grivich, T. Mullen, A. Delorme, and S. Makeig, "The Lab Streaming Layer for Synchronized Multimodal Recording," Imaging Neuroscience, vol. 3, 2025.

DOI: [10.1162/IMAG.a.136](https://dx.doi.org/10.1162/IMAG.a.136)

Link: [https://labstreaminglayer.org/](https://labstreaminglayer.org/)

## Available Components

- lslSetup
- lslWrapUp

## Available Sequences

None
