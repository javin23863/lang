#!/usr/bin/env python3
"""browser_check.py — drive two real browser tabs against a running room.

    python browser_check.py            # needs the server up (run_room.py --local)

Launches a throwaway Chrome with fake camera/mic (the operator's real devices
are never opened), joins the room twice, and asserts what only a browser can
show: that WebRTC actually connects, and that the microphone the *other person*
receives follows the mute button.

That last one is why this file exists. The unit tests and the audio probe both
pass while the published audio track stays live through mute — the track is on
the peer connection, not in any Python path.
"""

import asyncio
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translation_server import DEFAULT_PORT

CHROME = os.environ.get(
    "CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT = 9444
ROOM = os.environ.get("ROOM_URL", f"http://localhost:{DEFAULT_PORT}")


def devtools(path, method="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=5) as r:
        body = r.read()
        return json.loads(body) if body else None


class Tab:
    def __init__(self, ws_url):
        self.ws_url, self._id = ws_url, 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.ws_url, max_size=None)
        return self

    async def __aexit__(self, *a):
        await self.ws.close()

    async def call(self, method, **params):
        self._id += 1
        mid = self._id
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expr):
        r = await self.call("Runtime.evaluate", expression=expr,
                            awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("value")


# One async read of everything. Separate synchronous evaluates were reporting a
# stale iceConnectionState of "new" against a peer connection that getStats()
# showed as fully connected — the harness lied, not the app.
STATE = """(async () => {
  if (typeof peers === 'undefined' || !peers.size) return {peerCount: 0};
  const [, s] = [...peers][0];
  const pc = s.pc;
  const sender = pc.getSenders().find(x => x.track && x.track.kind === 'audio');
  const v = document.getElementById('remoteVideo');
  const out = {
    peerCount: peers.size,
    outgoingAudio: sender ? sender.track.enabled : null,
    ice: pc.iceConnectionState,
    conn: pc.connectionState,
    succeeded: 0,
    remoteVideo: !!(v.srcObject && v.srcObject.getVideoTracks().length),
    remoteSize: v.videoWidth + 'x' + v.videoHeight,
    micLabel: document.getElementById('micBtn').textContent.trim(),
  };
  (await pc.getStats()).forEach(r => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded') out.succeeded++;
  });
  return out;
})()"""


async def run():
    profile = tempfile.mkdtemp(prefix="room-check-")
    proc = subprocess.Popen([
        CHROME, f"--user-data-dir={profile}", f"--remote-debugging-port={PORT}",
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
        "--no-first-run", "--no-default-browser-check",
        # Chrome hides local IPs behind mDNS .local candidates, and a throwaway
        # profile resolves them unreliably — ICE then gathers nothing and the
        # harness reports a connection failure the app does not have. Real
        # browsers keep mDNS; this flag only affects this test instance.
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--disable-background-timer-throttling", "--window-size=520,900", ROOM,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    failures = []
    try:
        for _ in range(60):
            try:
                devtools("/json/version"); break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError("chrome devtools never came up")

        devtools(f"/json/new?{ROOM}", method="PUT")   # second participant
        time.sleep(3)
        pages = [t for t in devtools("/json/list")
                 if t["type"] == "page" and t["url"].startswith(ROOM)]
        assert len(pages) == 2, f"expected 2 room tabs, got {len(pages)}"

        async with Tab(pages[0]["webSocketDebuggerUrl"]) as a, \
                   Tab(pages[1]["webSocketDebuggerUrl"]) as b:
            for t in (a, b):
                await t.call("Runtime.enable")
            await b.js("(()=>{const s=document.getElementById('langSel');"
                       "s.value='es';s.dispatchEvent(new Event('change'));return s.value})()")

            def check(cond, msg):
                print(("  ok   " if cond else "  FAIL ") + msg)
                if not cond:
                    failures.append(msg)

            # The peer connection is established by joining alone — nothing here
            # calls into page internals, so this is the flow a user actually gets.
            for _ in range(20):
                states = [await t.js(STATE) for t in (a, b)]
                if all(s.get("peerCount") and s.get("outgoingAudio") is not None
                       for s in states):
                    break
                await asyncio.sleep(1)

            print("before Start (peer connected, mic never pressed):")
            for name, st in zip("AB", states):
                check(st["outgoingAudio"] is False,
                      f"{name}: peer is not receiving audio before Start "
                      f"(enabled={st['outgoingAudio']})")

            for t in (a, b):
                await t.js("document.getElementById('micBtn').click()")
            await asyncio.sleep(6)

            print("after Start:")
            for name, t in (("A", a), ("B", b)):
                st = await t.js(STATE)
                check(st["outgoingAudio"] is True,
                      f"{name}: peer receives audio once Start is pressed")
                check(st["ice"] in ("connected", "completed"),
                      f"{name}: WebRTC connected (ice={st['ice']}, "
                      f"{st['succeeded']} succeeded candidate pairs)")
                check(st["remoteVideo"] and st["remoteSize"] != "0x0",
                      f"{name}: remote video is playing ({st['remoteSize']})")

            for t in (a, b):
                await t.js("document.getElementById('micBtn').click()")
            await asyncio.sleep(2)

            print("after mute:")
            for name, t in (("A", a), ("B", b)):
                st = await t.js(STATE)
                check(st["outgoingAudio"] is False,
                      f"{name}: peer stops receiving audio on mute "
                      f"(enabled={st['outgoingAudio']})")
                check("Start" in st["micLabel"],
                      f"{name}: button shows the muted state ({st['micLabel']!r})")

            shot = await a.call("Page.captureScreenshot", format="png")
            out_path = os.path.join(tempfile.gettempdir(), "room_check.png")
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print("screenshot:", out_path)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        time.sleep(1)
        shutil.rmtree(profile, ignore_errors=True)

    if failures:
        print(f"\n{len(failures)} FAILED")
        return 1
    print("\nbrowser_check PASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
