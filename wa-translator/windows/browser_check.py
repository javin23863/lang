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
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import wave

import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from translation_server import DEFAULT_PORT

CHROME = os.environ.get(
    "CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT = 9444
BASE = os.environ.get("ROOM_BASE", f"http://localhost:{DEFAULT_PORT}").rstrip("/")
ROOM = os.environ.get("ROOM_URL")


def create_room_url():
    req = urllib.request.Request(f"{BASE}/api/rooms", method="POST", data=b"",
                                 headers={"Origin": BASE})
    with urllib.request.urlopen(req, timeout=5) as response:
        return BASE + json.load(response)["path"]


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
    remoteMuted: v.muted,
    voiceOn,
  };
  (await pc.getStats()).forEach(r => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded') out.succeeded++;
  });
  return out;
})()"""


def caption(speaker, seq, final, original, translations, lang="es"):
    return json.dumps({"type": "caption", "speaker": speaker, "speaker_lang": lang,
                       "seq": seq, "final": final, "original": original,
                       "translations": translations, "t_ms": 0})


def _test_wav_base64():
    """0.8 seconds of valid PCM: the browser must really decode and play it."""
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24000)
        wav_file.writeframes(b"\0\0" * 19200)
    return base64.b64encode(output.getvalue()).decode()


CONTROLLED_TTS_SPY = r"""(() => {
  window.__voice = {requests: [], starts: 0, playing: 0, ended: 0,
                    paused: 0, errors: [], duration: 0, currentTime: 0};
  window.__ttsFail = false;
  const wav = Uint8Array.from(atob('__TEST_WAV__'), c => c.charCodeAt(0));
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (new URL(url, location.href).pathname !== '/tts') return realFetch(input, init);
    const headers = new Headers(init.headers || {});
    const body = JSON.parse(init.body || '{}');
    window.__voice.requests.push({body, authorization: headers.get('Authorization'),
                                  participant: headers.get('X-Participant-ID')});
    if (window.__ttsFail) return Promise.resolve(new Response('unavailable', {status: 503}));
    return Promise.resolve(new Response(wav, {status: 200,
      headers: {'Content-Type': 'audio/wav'}}));
  };
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    if (this === fallbackAudio && this.src.startsWith('blob:')) {
      window.__voice.starts++;
      this.addEventListener('playing', () => window.__voice.playing++, {once: true});
      this.addEventListener('ended', () => {
        window.__voice.ended++;
        window.__voice.duration = this.duration;
        window.__voice.currentTime = this.currentTime;
      }, {once: true});
      this.addEventListener('pause', () => {
        if (!this.ended) window.__voice.paused++;
      }, {once: true});
    }
    const result = realPlay.call(this);
    Promise.resolve(result).catch(error => window.__voice.errors.push(String(error)));
    return result;
  };
  window.__worklet = [];
  if (workletNode) {
    const realPost = workletNode.port.postMessage.bind(workletNode.port);
    workletNode.port.postMessage = message => {
      window.__worklet.push(message.on);
      return realPost(message);
    };
  }
  return !!workletNode && typeof Audio === 'function';
})()""".replace("__TEST_WAV__", _test_wav_base64())


async def _wait_js(tab, expression, timeout=4):
    deadline = time.monotonic() + timeout
    value = None
    while time.monotonic() < deadline:
        value = await tab.js(expression)
        if value:
            return value
        await asyncio.sleep(0.05)
    return value


async def check_voice_modes(tab, other_tab, my_id, other_id, check):
    """Exercise observable playback plus every natural-audio restoration path.

    This is deliberately not a speechSynthesis spy: success requires the real
    HTML audio element to decode, enter `playing`, advance, and end.
    """
    installed = await tab.js(CONTROLLED_TTS_SPY)
    check(installed, "voice: real media playback and ASR worklet are observable")
    await tab.js("""(() => {
      window.__controls = [];
      const realSend = ws.send.bind(ws);
      ws.send = value => {
        if (typeof value === 'string') window.__controls.push(JSON.parse(value));
        return realSend(value);
      };
      return true;
    })()""")

    initial = await tab.js(STATE)
    other_initial = await other_tab.js(STATE)
    check(not initial["voiceOn"] and not initial["remoteMuted"],
          "voice: captions-only default leaves natural incoming audio audible")

    before_bubbles = await tab.js("document.querySelectorAll('.msg').length")
    await tab.js(f"handle({caption(other_id, 50, False, 'Hola', {'en': 'Hello'})})")
    await tab.js(f"handle({caption(other_id, 50, True, 'Hola', {'en': 'Hello'})})")
    await asyncio.sleep(0.15)
    off_state = await tab.js("({voice: window.__voice, bubbles: document.querySelectorAll('.msg').length})")
    check(off_state["voice"]["starts"] == 0 and off_state["bubbles"] > before_bubbles,
          "voice: captions continue and translated audio does not start while off")

    # Publish an explicit selected style; the listener's Match choice must use it.
    await other_tab.js("(()=>{const s=$('publishVoiceSel');s.value='male';"
                       "s.dispatchEvent(new Event('change'));return true})()")
    style_arrived = await _wait_js(
        tab, f"peers.get({json.dumps(other_id)})?.voiceStyle === 'male'")
    style_state = await tab.js(
        "({ws:ws.readyState, peers:[...peers].map(([id,p])=>"
        "({id,voiceStyle:p.voiceStyle}))})")
    published_state = await other_tab.js(
        "({ws:ws.readyState,myVoiceStyle,value:$('publishVoiceSel').value})")
    check(style_arrived, "voice: published non-biometric style reached the listener "
          f"(listener={style_state}, speaker={published_state})")
    await tab.js("$('voiceBtn').click()")
    enabled = await tab.js(STATE)
    other_unchanged = await other_tab.js(STATE)
    check(enabled["voiceOn"] and enabled["remoteMuted"],
          "voice: enabling locally mutes natural audio before phrase playback")
    check(not other_unchanged["voiceOn"] and not other_unchanged["remoteMuted"],
          "voice: each participant controls translated audio independently")

    flushes_before = await tab.js("window.__controls.filter(x=>x.type==='speech_end').length")
    await tab.js(f"handle({caption(other_id, 51, True, 'Necesito ayuda', {'en': 'I need help'})})")
    await _wait_js(tab, "window.__voice.playing === 1")
    during = await tab.js(STATE)
    await _wait_js(tab, "window.__voice.ended === 1", timeout=3)
    await asyncio.sleep(0.35)
    played = await tab.js("({voice:window.__voice, posts:window.__worklet})")
    request = played["voice"]["requests"][0]
    check(request["body"]["voice_style"] == "male",
          f"voice: Match speaker routed the published male style (got {request})")
    check(request["authorization"] == "Bearer " + await tab.js("roomId"),
          "voice: TTS bearer stays in the Authorization header")
    check(request["participant"] == str(my_id),
          "voice: TTS quota is bound to the joined participant")
    check(played["voice"]["playing"] == played["voice"]["ended"] == 1
          and played["voice"]["duration"] > 0 and played["voice"]["currentTime"] > 0
          and not played["voice"]["errors"],
          f"voice: translated WAV decoded and played to completion (got {played['voice']})")
    check(False in played["posts"] and played["posts"][-1] is True,
          f"voice: local ASR paused and resumed around playback (got {played['posts']})")
    flushes_after = await tab.js("window.__controls.filter(x=>x.type==='speech_end').length")
    check(flushes_after == flushes_before + 1,
          "voice: ASR pause flushes once before playback and never flushes playback feedback")
    check(during["outgoingAudio"] is True,
          "voice: ASR guard does not mute the microphone track sent to the peer")

    # Local selection outranks the published style.
    await tab.js("(()=>{const s=$('listenVoiceSel');s.value='female';"
                 "s.dispatchEvent(new Event('change'));return true})()")
    await tab.js(f"handle({caption(other_id, 52, True, 'Otra', {'en': 'Another'})})")
    await _wait_js(tab, "window.__voice.ended === 2", timeout=3)
    override = await tab.js("window.__voice.requests.at(-1).body.voice_style")
    check(override == "female", f"voice: local female override won (got {override})")

    # HTTP/playback failure restores natural audio and drops back to captions-only.
    await tab.js("window.__ttsFail=true")
    await tab.js(f"handle({caption(other_id, 53, True, 'Falla', {'en': 'Failure'})})")
    await _wait_js(tab, "voiceOn === false")
    failed = await tab.js(STATE)
    check(not failed["voiceOn"] and not failed["remoteMuted"],
          "voice: TTS failure immediately restores natural audio")
    await tab.js("window.__ttsFail=false;$('voiceBtn').click()")

    # Speed up the actual 60-second playback watchdog without bypassing it.
    await tab.js("window.__realTimeout=setTimeout;window.setTimeout=(fn,ms,...a)=>"
                 "window.__realTimeout(fn,ms===60000?40:ms,...a)")
    await tab.js(f"handle({caption(other_id, 54, True, 'Espera', {'en': 'Watchdog'})})")
    await _wait_js(tab, "voiceOn === false")
    watchdog = await tab.js("window.setTimeout=window.__realTimeout;delete window.__realTimeout;(" + STATE + ")")
    check(not watchdog["remoteMuted"], "voice: playback watchdog restores natural audio")

    await tab.js("$('voiceBtn').click();handle({type:'peer_leave',id:'missing-peer'})")
    left = await tab.js(STATE)
    check(not left["voiceOn"] and not left["remoteMuted"],
          "voice: peer leave restores natural audio")

    await tab.js("$('voiceBtn').click();roomFull=true;ws.onclose({code:1006});roomFull=false")
    reconnected = await tab.js(STATE)
    check(not reconnected["voiceOn"] and not reconnected["remoteMuted"],
          "voice: reconnect restores natural audio")


async def check_invitation_ui(tab, check):
    await tab.call("Emulation.setDeviceMetricsOverride", width=360, height=800,
                   deviceScaleFactor=1, mobile=True)
    layout = await tab.js("""(() => {
      const bar = document.getElementById('bar');
      const controls = ['micBtn','shareBtn','camBtn','voiceBtn','leaveBtn','langSel',
                        'listenVoiceSel','publishVoiceSel']
                       .map(id => document.getElementById(id).getBoundingClientRect());
      return {fits: document.documentElement.scrollWidth <= innerWidth &&
                    bar.scrollWidth <= innerWidth &&
                    controls.every(r => r.left >= 0 && r.right <= innerWidth),
              width: innerWidth, documentScroll: document.documentElement.scrollWidth,
              barScroll: bar.scrollWidth, controls: controls.length};
    })()""")
    check(layout["fits"], f"invite UI: every control fits a 360px phone (got {layout})")

    shot = await tab.call("Page.captureScreenshot", format="png")
    out_path = os.path.join(tempfile.gettempdir(), "room_check_360.png")
    with open(out_path, "wb") as output:
        output.write(base64.b64decode(shot["data"]))
    print("360px screenshot:", out_path)

    native = await tab.js("""(() => {
      let payload = null;
      Object.defineProperty(navigator, 'share', {
        value: async data => { payload = data; }, configurable: true});
      document.getElementById('shareBtn').click();
      return {payload, href: location.href};
    })()""")
    check(native["payload"] and native["payload"]["url"] == native["href"],
          f"invite UI: native phone share receives the exact private URL (got {native})")

    shared = await tab.js("""(() => {
      Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
      const realOpen = window.open;
      let opened = '';
      window.open = url => { opened = String(url); return {}; };
      document.getElementById('shareBtn').click();
      window.open = realOpen;
      return {opened, href: location.href};
    })()""")
    decoded = urllib.parse.unquote(shared["opened"])
    check(shared["opened"].startswith("https://wa.me/?text=")
          and shared["href"] in decoded,
          f"invite UI: WhatsApp fallback carries the exact private URL (got {shared['opened']})")

    blocked = await tab.js("""(async () => {
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', {
        value: {writeText: async text => { copied = text; }}, configurable: true});
      const realOpen = window.open;
      window.open = () => null;
      document.getElementById('shareBtn').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      window.open = realOpen;
      return {copied, href: location.href};
    })()""")
    check(blocked["copied"] == blocked["href"],
          f"invite UI: blocked WhatsApp popup copies the private URL (got {blocked})")
    await tab.call("Emulation.clearDeviceMetricsOverride")


async def run():
    room = ROOM or create_room_url()
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
        "--disable-background-timer-throttling", "--window-size=520,900", room,
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

        devtools(f"/json/new?{room}", method="PUT")   # second participant
        time.sleep(3)
        pages = [t for t in devtools("/json/list")
                 if t["type"] == "page" and t["url"].startswith(room)]
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

            print("private invitation UI:")
            await check_invitation_ui(a, check)

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

            # Runs while the mic is on: the ASR feed can only be observed
            # pausing and resuming if it was open to begin with.
            print("captions-only and controlled translated voice:")
            a_id = await a.js("myId")
            b_id = await b.js("myId")
            await check_voice_modes(a, b, a_id, b_id, check)

            mute_flushes = await a.js(
                "window.__controls.filter(x=>x.type==='speech_end').length")
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
            after_mute_flushes = await a.js(
                "window.__controls.filter(x=>x.type==='speech_end').length")
            check(after_mute_flushes == mute_flushes + 1,
                  "A: mute emits one speech_end so pending speech can finalize")

            await b.js("document.getElementById('leaveBtn').click()")
            leave_arrived = await _wait_js(
                a, "peers.size === 0 && $('participantCount').textContent.startsWith('1 / 4')")
            left_state = await b.js(
                "({leaving, count:$('participantCount').textContent, ws:ws.readyState})")
            check(leave_arrived and left_state["leaving"]
                  and left_state["count"].startswith("0 / 4"),
                  "leave: visible control immediately releases the peer and updates both counts "
                  f"(leaver={left_state})")

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
