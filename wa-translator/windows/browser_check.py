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

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

CHROME = os.environ.get(
    "CHROME_EXE", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
PORT = 9444
BASE = os.environ.get("ROOM_BASE", f"http://localhost:{DEFAULT_PORT}").rstrip("/")
ROOM = os.environ.get("ROOM_URL")
FORCE_RELAY = os.environ.get("FORCE_RELAY") == "1"
HEADLESS = os.environ.get("BROWSER_CHECK_HEADLESS") == "1"
PROBE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "Chrome/140 Safari/537.36"
)


def create_room_url():
    req = urllib.request.Request(f"{BASE}/api/rooms", method="POST", data=b"",
                                 headers={"Origin": BASE, "User-Agent": PROBE_USER_AGENT})
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
    hasMedia: !!mediaStream,
    voiceOn,
    selectedLocalType: null,
    selectedRemoteType: null,
    selectedProtocol: null,
  };
  const stats = await pc.getStats();
  stats.forEach(r => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded') out.succeeded++;
  });
  const pair = [...stats.values()].find(r => r.type === 'candidate-pair'
    && r.state === 'succeeded' && (r.nominated || r.selected));
  if (pair) {
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    out.selectedLocalType = local?.candidateType || null;
    out.selectedRemoteType = remote?.candidateType || null;
    out.selectedProtocol = local?.protocol || null;
  }
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
  window.__resetVoiceSpy = () => {
    window.__voice = {requests: [], starts: 0, playing: 0, ended: 0,
                      paused: 0, errors: [], duration: 0, currentTime: 0};
  };
  window.__resetVoiceSpy();
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
    const translatedWav = this === fallbackAudio && this.src.startsWith('blob:');
    if (translatedWav) {
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
    if (translatedWav) {
      Promise.resolve(result).catch(error => window.__voice.errors.push(String(error)));
    }
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
    """Exercise selected-profile playback plus natural-audio restoration.

    The local adapter intentionally advertises captions-only because it does
    not carry the exact pinned Kokoro voice runtime.  The harness temporarily
    enables one declared profile while intercepting /tts, so it can still test
    the browser's actual HTMLMediaElement lifecycle without claiming local
    production voice availability.
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
    check(not initial["voiceOn"] and not initial["remoteMuted"]
          and not await tab.js("$('voiceBtn').disabled"),
          "voice: a free matching device voice is available while natural audio remains audible")

    # Exercise the real Windows/Chrome speech engine before the controlled
    # server-WAV checks. No speech API or lifecycle event is stubbed here.
    native_before = await tab.js("window.__worklet.length")
    selected_device = await tab.js("""(() => {
      const option = [...$('publishVoiceSel').options]
        .find(item => item.value.startsWith('device:'));
      if (!option) return null;
      const realSend = send;
      send = () => {};
      $('publishVoiceSel').value = option.value;
      $('publishVoiceSel').dispatchEvent(new Event('change'));
      send = realSend;
      $('voiceBtn').click();
      speak('Device voice check', myLocale, myVoiceProfileId);
      return myVoiceChoice;
    })()""")
    native_done = await _wait_js(
        tab, "!speaking && !asrPaused && voiceOn && !$('remoteVideo').muted", timeout=10)
    native_posts = await tab.js("window.__worklet.slice(" + str(native_before) + ")")
    check(selected_device and selected_device.startswith("device:") and native_done
          and False in native_posts and native_posts[-1] is True,
          "voice: real device speech completed with the ASR safety lifecycle "
          f"(choice={selected_device}, posts={native_posts})")
    await tab.js("$('voiceBtn').click();window.__resetVoiceSpy()")

    # This is an explicit test-only capability override, never an app fallback.
    await tab.js("runtimeVoiceProfileIds=null;applyLocale('en-US','en-us-af-heart');updateVoiceButton()")
    check(await tab.js("!$('voiceBtn').disabled && myVoiceProfileId === 'en-us-af-heart'"),
          "voice: a declared, selected profile can enable translated playback")
    device_menu = await tab.js("""(() => {
      deviceVoicesById.set('device:test-en-US', {voiceURI:'test-en-US', lang:'en-US', name:'Windows English'});
      deviceVoicesById.set('device:test-fr-FR', {voiceURI:'test-fr-FR', lang:'fr-FR', name:'Windows French'});
      fillVoiceSelect();
      return {groups:[...$('publishVoiceSel').querySelectorAll('optgroup')].map(x=>x.label),
              values:[...$('publishVoiceSel').options].map(x=>x.value)};
    })()""")
    check(device_menu["groups"] == ["On this device", "Included"]
          and "device:test-en-US" in device_menu["values"]
          and "device:test-fr-FR" not in device_menu["values"],
          f"voice: free device voices are language-matched beside included voices (got {device_menu})")

    before_bubbles = await tab.js("document.querySelectorAll('.msg').length")
    await tab.js(f"handle({caption(other_id, 50, False, 'Hola', {'en': 'Hello'})})")
    await tab.js(f"handle({caption(other_id, 50, True, 'Hola', {'en': 'Hello'})})")
    await asyncio.sleep(0.15)
    off_state = await tab.js("({voice: window.__voice, bubbles: document.querySelectorAll('.msg').length})")
    check(off_state["voice"]["starts"] == 0 and off_state["bubbles"] > before_bubbles,
          "voice: captions continue and translated audio does not start while off")

    await tab.js("$('voiceBtn').click()")
    enabled = await tab.js(STATE)
    other_unchanged = await other_tab.js(STATE)
    check(enabled["voiceOn"] and not enabled["remoteMuted"],
          "voice: enabling locally keeps natural audio until translated playback")
    check(not other_unchanged["voiceOn"] and not other_unchanged["remoteMuted"],
          "voice: each participant controls translated audio independently")

    flushes_before = await tab.js("window.__controls.filter(x=>x.type==='speech_end').length")
    await tab.js(f"handle({caption(other_id, 51, True, 'Necesito ayuda', {'en': 'I need help'})})")
    await _wait_js(tab, "window.__voice.playing === 1")
    during = await tab.js(STATE)
    check(during["remoteMuted"],
          "voice: translated playback mutes natural incoming audio only while playing")
    await _wait_js(tab, "window.__voice.ended === 1", timeout=3)
    await asyncio.sleep(0.35)
    played = await tab.js("({voice:window.__voice, posts:window.__worklet})")
    request = played["voice"]["requests"][0]
    check(request["body"] == {"text": "I need help", "locale": "en-US",
                              "voice_profile": "en-us-af-heart"},
          f"voice: selected profile is the only TTS route (got {request})")
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
    after_playback = await tab.js(STATE)
    check(not after_playback["remoteMuted"],
          "voice: natural incoming audio resumes between translated phrases")
    flushes_after = await tab.js("window.__controls.filter(x=>x.type==='speech_end').length")
    check(flushes_after == flushes_before + 1,
          "voice: ASR pause flushes once before playback and never flushes playback feedback")
    check(during["outgoingAudio"] is True,
          "voice: ASR guard does not mute the microphone track sent to the peer")

    # A second exact profile is a controlled choice, not a generic style.
    await tab.js("(()=>{const realSend=send;send=()=>{};const s=$('publishVoiceSel');"
                 "s.value='cloud:en-us-am-michael';s.dispatchEvent(new Event('change'));send=realSend;return true})()")
    await tab.js(f"handle({caption(other_id, 52, True, 'Otra', {'en': 'Another'})})")
    await _wait_js(tab, "window.__voice.ended === 2", timeout=3)
    override = await tab.js("window.__voice.requests.at(-1).body.voice_profile")
    check(override == "en-us-am-michael",
          f"voice: locally selected controlled profile won (got {override})")

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


async def check_role_picker(tab, check):
    await tab.call("Emulation.setDeviceMetricsOverride", width=360, height=640,
                   deviceScaleFactor=1, mobile=True)
    await tab.js("$('termsAgree').checked=true;$('termsAgree').dispatchEvent(new Event('change',{bubbles:true}))")
    picker = await tab.js("""(() => {
      const gate = $('roleGate');
      const card = gate.querySelector('.roleCard');
      const select = $('roleLocaleSel');
      const join = $('joinBtn');
      select.focus();
      const cardBounds = card.getBoundingClientRect();
      const option = id => [...select.options].find(item => item.value === id)?.textContent;
      return {
        open: !gate.hidden,
        nativeSelect: select instanceof HTMLSelectElement,
        noChoiceWall: !$('localeSearch') && !$('roleChoices'),
        enabled: !select.disabled && !join.disabled,
        focused: document.activeElement === select,
        fits: document.documentElement.scrollWidth <= innerWidth &&
          cardBounds.top >= 0 && cardBounds.bottom <= innerHeight &&
          select.getBoundingClientRect().left >= 0 && select.getBoundingClientRect().right <= innerWidth &&
          join.getBoundingClientRect().left >= 0 && join.getBoundingClientRect().right <= innerWidth,
        scrollSafe: getComputedStyle(gate).overflowY === 'auto' &&
          getComputedStyle(card).overflowY === 'auto' && cardBounds.height <= innerHeight - 36,
        labels: {esMX: option('es-MX'), jaJP: option('ja-JP'), arSA: option('ar-SA'),
                 kmKH: option('km-KH')},
        optionCount: select.options.length,
        groups: [...select.querySelectorAll('optgroup')].map(group => group.label),
        prose: [...document.querySelectorAll('#roleGate *')].map(node => node.textContent || '')
          .filter(text => /maps to base|transcription|runtime|model|development/i.test(text)),
      };
    })()""")
    check(picker["open"] and picker["nativeSelect"] and picker["noChoiceWall"]
          and picker["enabled"] and picker["focused"],
          f"role picker: compact native control remains keyboard reachable (got {picker})")
    check(picker["fits"] and picker["scrollSafe"],
          f"role picker: 360x640 has no horizontal or dialog scroll trap (got {picker})")
    check(picker["labels"] == {
        "esMX": "Español (México) — Spanish (Mexico)",
        "jaJP": "日本語 — Japanese (Japan)",
        "arSA": "العربية — Arabic (Saudi Arabia)",
        "kmKH": "ខ្មែរ — Khmer (Cambodia)",
    }, f"role picker: catalog labels are native-name first (got {picker['labels']})")
    check(picker["optionCount"] == 106 and picker["groups"] == ["Tested", "Preview"]
          and not picker["prose"],
          f"role picker: 106 free speaking profiles are compactly grouped without development prose (got {picker})")
    shot = await tab.call("Page.captureScreenshot", format="png")
    out_path = os.path.join(tempfile.gettempdir(), "room_role_picker_360.png")
    with open(out_path, "wb") as output:
        output.write(base64.b64decode(shot["data"]))
    print("role picker 360px screenshot:", out_path)

    await tab.js("$('roleLocaleSel').value='km-KH';$('roleLocaleSel').dispatchEvent(new Event('change',{bubbles:true}))")
    khmer_shot = await tab.call("Page.captureScreenshot", format="png")
    khmer_path = os.path.join(tempfile.gettempdir(), "room_role_picker_khmer_360.png")
    with open(khmer_path, "wb") as output:
        output.write(base64.b64decode(khmer_shot["data"]))
    print("role picker Khmer screenshot:", khmer_path)

    rtl = await tab.js("""(() => {
      const select = $('roleLocaleSel');
      select.value = 'ar-SA';
      select.dispatchEvent(new Event('change', {bubbles: true}));
      const card = $('roleGate').querySelector('.roleCard').getBoundingClientRect();
      const join = $('joinBtn').getBoundingClientRect();
      return {dir: document.documentElement.dir, locale: myLocale,
              scroll: document.documentElement.scrollWidth, width: innerWidth,
              fits: card.top >= 0 && card.bottom <= innerHeight,
              joinVisible: join.width > 0 && join.height > 0 && join.bottom <= innerHeight,
              joinDisabled: $('joinBtn').disabled};
    })()""")
    check(rtl["dir"] == "rtl" and rtl["locale"] is None
          and rtl["scroll"] <= rtl["width"] and rtl["fits"]
          and rtl["joinVisible"] and not rtl["joinDisabled"],
          f"role picker: Arabic preview is RTL and remains reachable at 360px (got {rtl})")
    rtl_shot = await tab.call("Page.captureScreenshot", format="png")
    rtl_path = os.path.join(tempfile.gettempdir(), "room_role_picker_rtl_360.png")
    with open(rtl_path, "wb") as output:
        output.write(base64.b64decode(rtl_shot["data"]))
    print("role picker RTL screenshot:", rtl_path)
    await tab.js("$('roleLocaleSel').value='en-US';$('roleLocaleSel').dispatchEvent(new Event('change', {bubbles:true}))")
    await tab.call("Emulation.clearDeviceMetricsOverride")


async def check_invitation_ui(tab, check):
    await tab.call("Emulation.setDeviceMetricsOverride", width=360, height=800,
                   deviceScaleFactor=1, mobile=True)
    layout = await tab.js("""(() => {
      const bar = document.getElementById('bar');
      const controls = ['micBtn','shareBtn','camBtn','voiceBtn','leaveBtn','localeSel',
                        'publishVoiceSel']
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

    rtl = await tab.js("""(() => {
      applyLocale('ar-SA', null);
      const result = {dir: document.documentElement.dir,
                      locale: myLocale,
                      scroll: document.documentElement.scrollWidth,
                      width: innerWidth};
      return result;
    })()""")
    check(rtl["dir"] == "rtl" and rtl["locale"] == "ar-SA"
          and rtl["scroll"] <= rtl["width"],
          f"invite UI: Arabic locale uses RTL without 360px overflow (got {rtl})")
    rtl_shot = await tab.call("Page.captureScreenshot", format="png")
    rtl_path = os.path.join(tempfile.gettempdir(), "room_check_rtl.png")
    with open(rtl_path, "wb") as output:
        output.write(base64.b64decode(rtl_shot["data"]))
    print("RTL screenshot:", rtl_path)
    await tab.js("applyLocale('en-US', null)")

    native = await tab.js("""(() => {
      let payload = null;
      Object.defineProperty(navigator, 'share', {
        value: async data => { payload = data; }, configurable: true});
      document.getElementById('shareBtn').click();
      return {payload, href: location.href};
    })()""")
    check(native["payload"] and native["payload"]["url"] == native["href"],
          f"invite UI: native phone share receives the exact private URL (got {native})")

    shared = await tab.js("""(async () => {
      Object.defineProperty(navigator, 'share', {value: undefined, configurable: true});
      const realOpen = window.open;
      let opened = '';
      window.open = url => { opened = String(url); return {}; };
      document.getElementById('shareBtn').click();
      await new Promise(resolve => setTimeout(resolve, 0));
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
    await tab.js("handle({type:'caption_status',status:'capacity',scope:'global',retry_after_ms:1000})")
    check("Captions are busy" in await tab.js("$('status').textContent"),
          "invite UI: caption capacity is visible without infrastructure language")
    await tab.call("Emulation.clearDeviceMetricsOverride")


async def check_dashboard_ui(check):
    page = devtools(f"/json/new?{BASE}/", method="PUT")
    async with Tab(page["webSocketDebuggerUrl"]) as tab:
        await tab.call("Runtime.enable")
        ready = await _wait_js(
            tab,
            "document.readyState === 'complete' && location.pathname === '/' && !!document.getElementById('createBtn')",
            timeout=8,
        )
        if not ready:
            raise RuntimeError("dashboard did not finish loading")
        dashboard = await tab.js("""(() => {
          const text = document.body.textContent;
          const ids = ['roomState', 'createBtn', 'shareLink', 'copyBtn', 'shareBtn', 'openBtn', 'closeBtn'];
          const banned = ['Private multilingual rooms',
                          'Conversations that keep their natural flow.',
                          'Create a private video room, share its link',
                          'Capability declarations never imply locale-specific ASR'];
          return {controls: ids.every(id => !!document.getElementById(id)),
                  missing: ids.filter(id => !document.getElementById(id)),
                  banned: banned.filter(value => text.includes(value))};
        })()""")
        check(dashboard["controls"] and not dashboard["banned"],
              f"dashboard: only room control remains, without marketing copy (got {dashboard})")

        await tab.call("Emulation.setDeviceMetricsOverride", width=1440, height=900,
                       deviceScaleFactor=1, mobile=False)
        desktop = await tab.call("Page.captureScreenshot", format="png")
        desktop_path = os.path.join(tempfile.gettempdir(), "room_dashboard_desktop.png")
        with open(desktop_path, "wb") as output:
            output.write(base64.b64decode(desktop["data"]))
        print("dashboard desktop screenshot:", desktop_path)

        await tab.call("Emulation.setDeviceMetricsOverride", width=360, height=640,
                       deviceScaleFactor=1, mobile=True)
        mobile_layout = await tab.js("""(() => {
          const create = document.getElementById('createBtn').getBoundingClientRect();
          return {scroll: document.documentElement.scrollWidth, width: innerWidth,
                  create: {left: create.left, right: create.right}};
        })()""")
        check(mobile_layout["scroll"] <= mobile_layout["width"]
              and mobile_layout["create"]["left"] >= 0
              and mobile_layout["create"]["right"] <= mobile_layout["width"],
              f"dashboard: 360px room control remains reachable (got {mobile_layout})")
        mobile = await tab.call("Page.captureScreenshot", format="png")
        mobile_path = os.path.join(tempfile.gettempdir(), "room_dashboard_360.png")
        with open(mobile_path, "wb") as output:
            output.write(base64.b64decode(mobile["data"]))
        print("dashboard 360px screenshot:", mobile_path)

        await tab.call("Emulation.setDeviceMetricsOverride", width=360, height=800,
                       deviceScaleFactor=1, mobile=True)
        store = await tab.call("Page.captureScreenshot", format="png")
        store_path = os.path.join(tempfile.gettempdir(), "room_dashboard_store.png")
        with open(store_path, "wb") as output:
            output.write(base64.b64decode(store["data"]))
        print("dashboard store screenshot:", store_path)

        await tab.js("createRoom()")
        active = await _wait_js(
            tab,
            "currentRoom && !busy && !$('roomPanel').hidden && $('shareLink').value.startsWith(location.origin + '/room/')",
            timeout=8,
        )
        check(active, "dashboard: a saved private room exposes its participant controls")
        active_shot = await tab.call("Page.captureScreenshot", format="png")
        active_path = os.path.join(tempfile.gettempdir(), "room_dashboard_active_store.png")
        with open(active_path, "wb") as output:
            output.write(base64.b64decode(active_shot["data"]))
        print("active dashboard store screenshot:", active_path)

        await tab.js("closeRoom(false)")
        closed = await _wait_js(
            tab,
            "!currentRoom && !busy && $('roomPanel').hidden && $('roomState').dataset.state === 'closed'",
            timeout=8,
        )
        check(closed, "dashboard: the same control closes its disposable screenshot room")
        await tab.call("Emulation.clearDeviceMetricsOverride")


async def run():
    room = ROOM or create_room_url()
    profile = tempfile.mkdtemp(prefix="room-check-")
    chrome_args = [
        CHROME, f"--user-data-dir={profile}", f"--remote-debugging-port={PORT}",
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
        "--no-first-run", "--no-default-browser-check",
        # Chrome hides local IPs behind mDNS .local candidates, and a throwaway
        # profile resolves them unreliably — ICE then gathers nothing and the
        # harness reports a connection failure the app does not have. Real
        # browsers keep mDNS; this flag only affects this test instance.
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--disable-background-timer-throttling", "--window-size=520,900",
    ]
    if HEADLESS:
        chrome_args.append("--headless=new")
    chrome_args.append(room)
    proc = subprocess.Popen(chrome_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

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
                if FORCE_RELAY:
                    await t.js("""(() => {
                      const NativePeerConnection = window.RTCPeerConnection;
                      window.RTCPeerConnection = new Proxy(NativePeerConnection, {
                        construct(Target, args) {
                          const config = {...(args[0] || {}), iceTransportPolicy: 'relay'};
                          return Reflect.construct(Target, [config]);
                        }
                      });
                    })()""")
            # A locale is a required role decision.  Wait for the same-origin
            # catalog rather than falling back to navigator language or a base
            # code, then choose two explicitly declared profiles.
            for tab in (a, b):
                loaded = await _wait_js(tab, "catalogRevision && locales.size >= 117", timeout=8)
                if not loaded:
                    raise RuntimeError("capability catalog did not load")

            def check(cond, msg):
                print(("  ok   " if cond else "  FAIL ") + msg)
                if not cond:
                    failures.append(msg)

            print("pre-join locale picker:")
            await check_role_picker(a, check)
            await b.js("$('termsAgree').checked=true;$('termsAgree').dispatchEvent(new Event('change',{bubbles:true}))")
            await a.js("chooseLocale('en-US')")
            await b.js("chooseLocale('es-ES')")

            print("private invitation UI:")
            await check_invitation_ui(a, check)
            print("host dashboard UI:")
            await check_dashboard_ui(check)

            # Joining creates signalling peers but must not prompt for media.
            for _ in range(20):
                states = [await t.js(STATE) for t in (a, b)]
                if all(s.get("peerCount") for s in states):
                    break
                await asyncio.sleep(1)

            print("before Start (peer connected, mic never pressed):")
            for name, st in zip("AB", states):
                check(st["outgoingAudio"] in (None, False) and not st["hasMedia"],
                      f"{name}: joining did not request media "
                      f"(sender={st['outgoingAudio']}, media={st['hasMedia']})")

            for t in (a, b):
                await t.js("document.getElementById('micBtn').click()")
                await t.js("document.getElementById('camBtn').click()")
            await asyncio.sleep(6)

            print("after Start:")
            for name, t in (("A", a), ("B", b)):
                st = await t.js(STATE)
                check(st["outgoingAudio"] is True,
                      f"{name}: peer receives audio once Start is pressed")
                check(st["ice"] in ("connected", "completed"),
                      f"{name}: WebRTC connected (ice={st['ice']}, "
                      f"{st['succeeded']} succeeded candidate pairs)")
                if FORCE_RELAY:
                    check(st["selectedLocalType"] == "relay",
                          f"{name}: selected local ICE candidate is relay "
                          f"(local={st['selectedLocalType']}, "
                          f"remote={st['selectedRemoteType']}, "
                          f"protocol={st['selectedProtocol']})")
                check(st["remoteVideo"] and st["remoteSize"] != "0x0",
                      f"{name}: remote video is playing ({st['remoteSize']})")

            print("after microphone and camera permission revocation:")
            await a.js("""(() => {
              const audio = mediaStream.getAudioTracks()[0];
              const video = mediaStream.getVideoTracks()[0];
              audio.stop();
              video.stop();
              // MediaStreamTrack.stop() deliberately does not emit `ended`;
              // browser/OS permission revocation does. Dispatch that browser
              // event so this gate exercises the production recovery handler.
              audio.dispatchEvent(new Event('ended'));
              video.dispatchEvent(new Event('ended'));
            })()""")
            revoked = await _wait_js(
                a,
                "!micOn && !camOn && audioMediaPromise === null && "
                "videoMediaPromise === null && mediaStream.getTracks().length === 0",
                timeout=8,
            )
            check(revoked, "A: revoked mic and camera clear cached permission state")
            await a.js("document.getElementById('micBtn').click()")
            await a.js("document.getElementById('camBtn').click()")
            recovered = await _wait_js(
                a,
                "micOn && camOn && audioInputNode && "
                "mediaStream.getAudioTracks().some(t=>t.readyState==='live') && "
                "mediaStream.getVideoTracks().some(t=>t.readyState==='live') && "
                "[...peers.values()].every(p=>p.pc.getSenders().filter(s=>s.track).some(s=>"
                "s.track.kind==='audio'&&s.track.readyState==='live') && "
                "p.pc.getSenders().filter(s=>s.track).some(s=>"
                "s.track.kind==='video'&&s.track.readyState==='live'))",
                timeout=12,
            )
            check(recovered, "A: Start and Camera reacquire live tracks after revocation")

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
                "({leaving, count:$('participantCount').textContent, "
                "ws:ws?.readyState ?? null})")
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
