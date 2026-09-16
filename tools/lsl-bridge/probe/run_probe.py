"""Transport probe: can an HTTPS page on a public origin open ws://localhost?

Serves probe_page.html over HTTPS from a non-loopback address, runs a loopback
WebSocket echo server, then drives Chromium at the page and reports the verdict.

The question matters because reVISit is deployed over HTTPS while the LSL bridge
necessarily runs on the participant machine's loopback interface.
"""
import asyncio
import http.server
import json
import pathlib
import ssl
import subprocess
import sys
import threading

HERE = pathlib.Path(__file__).parent
CERT = HERE / "_probe_cert.pem"
KEY = HERE / "_probe_key.pem"
PAGE_HOST = "revisit.test"
PAGE_ADDR = "192.0.2.2"
PAGE_PORT = 8443
WS_PORT = 8765


def ensure_cert():
    if CERT.exists() and KEY.exists():
        return
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
         "-keyout", str(KEY), "-out", str(CERT), "-days", "7",
         "-subj", f"/CN={PAGE_HOST}",
         "-addext", f"subjectAltName=DNS:{PAGE_HOST},IP:{PAGE_ADDR}"],
        check=True, capture_output=True,
    )


def serve_https():
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(HERE), **k)  # noqa: E731
    httpd = http.server.HTTPServer((PAGE_ADDR, PAGE_PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(CERT), str(KEY))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


async def ws_echo():
    import websockets

    async def handler(conn):
        async for msg in conn:
            await conn.send(f"echo:{msg}")

    return await websockets.serve(handler, "127.0.0.1", WS_PORT)


async def run_case(label, extra_args):
    from playwright.async_api import async_playwright

    url = f"https://{PAGE_HOST}:{PAGE_PORT}/probe_page.html?ws=ws://localhost:{WS_PORT}"
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
            # The probe host is served locally; keep the sandbox proxy out of the path.
            args=["--no-proxy-server", *extra_args],
        )
        ctx = await browser.new_context(ignore_https_errors=True)
        page = await ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        await page.goto(url, wait_until="load")
        try:
            await page.wait_for_function("window.__probeResult !== null", timeout=12000)
        except Exception:
            pass
        result = await page.evaluate("window.__probeResult")
        secure = await page.evaluate("window.isSecureContext")
        await browser.close()
    return {"case": label, "secure_context": secure, "result": result, "console": console}


async def main():
    ensure_cert()
    serve_https()
    server = await ws_echo()
    await asyncio.sleep(0.3)

    cases = [
        ("default (Chromium 141 defaults)", []),
        ("LNA checks force-enabled",
         ["--enable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWarn"]),
    ]
    out = []
    for label, args in cases:
        out.append(await run_case(label, args))
    server.close()
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
