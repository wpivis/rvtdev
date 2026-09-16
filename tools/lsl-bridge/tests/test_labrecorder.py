"""LabRecorder RCS client, against a mock Remote Control Server.

The real LabRecorder is a Qt desktop app, so the protocol is exercised against a
socket server that speaks the same grammar. That covers the parts that are ours
to get right: command order, filename templating, and degrading rather than
failing when LabRecorder is absent.
"""
import socket
import sys
import pathlib
import threading

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from labrecorder import LabRecorder  # noqa: E402


class MockRCS:
    """Minimal stand-in for LabRecorder's RCS: one command per connection."""

    def __init__(self):
        self.commands: list[str] = []
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.running = True
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while self.running:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            with conn:
                data = conn.recv(4096).decode(errors="replace").strip()
                if data:
                    self.commands.append(data)
                conn.sendall(b"OK\n")

    def close(self):
        self.running = False
        self.sock.close()


def test_start_sends_select_filename_then_start():
    rcs = MockRCS()
    try:
        lr = LabRecorder(port=rcs.port)
        assert lr.start("myStudy", "P003") is True
        assert lr.available is True
    finally:
        rcs.close()

    assert rcs.commands[0] == "select all"
    assert rcs.commands[1].startswith("filename ")
    assert "{participant:P003}" in rcs.commands[1]
    assert "{template:myStudy_%p.xdf}" in rcs.commands[1]
    assert rcs.commands[2] == "start"


def test_braces_in_ids_cannot_corrupt_the_command_grammar():
    rcs = MockRCS()
    try:
        LabRecorder(port=rcs.port).start("st{ud}y", "P}01{")
    finally:
        rcs.close()
    filename_cmd = rcs.commands[1]
    # Exactly the three option groups the client intends, no injected ones.
    assert filename_cmd.count("{") == 3 and filename_cmd.count("}") == 3
    assert "{participant:P01}" in filename_cmd


def test_missing_labrecorder_degrades_instead_of_raising():
    # Nothing is listening on this port.
    lr = LabRecorder(port=9, timeout=0.3)
    assert lr.probe() is False
    assert lr.start("s", "p") is False
    assert lr.stop() is False
    assert lr.available is False
    assert lr.last_error


def test_stop_is_sent_verbatim():
    rcs = MockRCS()
    try:
        assert LabRecorder(port=rcs.port).stop() is True
    finally:
        rcs.close()
    assert rcs.commands == ["stop"]


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
