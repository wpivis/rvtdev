"""Client for LabRecorder's Remote Control Server.

LabRecorder exposes `select all`, `filename {...}`, `start` and `stop` over a
plain TCP socket (default port 22345, loopback only, no auth) when EnableRCS is
set in LabRecorder.cfg. Driving it from here is what removes the manual
start/stop step from a session.

LabRecorder is deliberately optional: it writes the lab's canonical XDF, but the
bridge reads its samples straight from LSL, so a LabRecorder that is missing or
wedged degrades the session rather than ending it.
"""
from __future__ import annotations

import socket

DEFAULT_PORT = 22345


class LabRecorder:
    def __init__(self, host: str = "127.0.0.1", port: int = DEFAULT_PORT, timeout: float = 2.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.available = False
        self.last_error: str | None = None

    def _send(self, command: str) -> str | None:
        try:
            with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
                s.sendall(f"{command}\n".encode())
                s.settimeout(self.timeout)
                try:
                    reply = s.recv(4096).decode(errors="replace").strip()
                except socket.timeout:
                    reply = ""
            self.available = True
            self.last_error = None
            return reply
        except OSError as exc:
            self.available = False
            self.last_error = str(exc)
            return None

    def probe(self) -> bool:
        """Cheap reachability check for the setup page."""
        return self._send("select all") is not None

    def start(self, study_id: str, participant_id: str, task: str = "study") -> bool:
        """Name the file after the participant, then record.

        Braces and backslashes would corrupt the RCS command grammar, so they are
        stripped rather than escaped.
        """
        safe = lambda v: str(v).replace("{", "").replace("}", "").replace("\\", "").strip()  # noqa: E731
        if self._send("select all") is None:
            return False
        template = (
            f"filename {{template:{safe(study_id)}_%p.xdf}} "
            f"{{participant:{safe(participant_id)}}} {{task:{safe(task)}}}"
        )
        if self._send(template) is None:
            return False
        return self._send("start") is not None

    def stop(self) -> bool:
        return self._send("stop") is not None
