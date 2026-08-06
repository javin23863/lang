#!/usr/bin/env python3
"""
translation_server.py — WebSocket translation server (Windows host).

iTour-style link sharing:
  Person A runs this server on Windows. Person B opens a link in their
  browser. Both people's audio flows here, gets transcribed (Moonshine ASR),
  translated (CTranslate2 MT), and bilingual captions are pushed to all
  clients.

  Person A's audio arrives via the /api/host_audio HTTP endpoint (fed by
  translator_app.py's WASAPI capture). Person B's audio arrives via
  WebSocket binary frames (browser getUserMedia).

  All ASR+MT runs on-device here. No paid APIs, no backend.
"""

import os
import sys
import json
import time
import asyncio
import threading
import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mt_ct2 import CTranslate2MT, filter_caption, PAIR_STATUS

app = FastAPI(title="WhatsApp Call Translator")

# ── Shared state ──────────────────────────────────────────────────────
clients: dict[int, dict] = {}    # client_id -> {ws, name, is_host}
next_client_id = 1
pair = "en-zh"
mt_engine: CTranslate2MT | None = None
mt_lock = threading.Lock()

# Per-stream ASR audio buffers: stream_id -> list of numpy float32 chunks
asr_buffers: dict[str, list[np.ndarray]] = {}

ASR_SAMPLE_RATE = 16000
MIN_ASR_SAMPLES = 1600  # 100ms minimum to bother transcribing
SILENCE_THRESHOLD = 0.01  # RMS below this = silence
SILENCE_FLUSH_MS = 800  # flush after this many ms of silence
MAX_BUFFER_MS = 10000  # force flush after this many ms of speech

# Per-stream silence tracking
_silence_frames: dict[str, int] = {}  # stream_id -> consecutive silent frames
_last_flush: dict[str, float] = {}  # stream_id -> last flush timestamp

def feed_asr(stream_id: str, pcm: np.ndarray, sample_rate: int = 16000):
    """Accumulate audio chunks. Auto-flush on silence or max buffer.

    Resamples to 16kHz if the browser sends at a different rate.
    """
    # Resample to 16kHz if needed
    if sample_rate != ASR_SAMPLE_RATE:
        ratio = ASR_SAMPLE_RATE / sample_rate
        n_out = int(len(pcm) * ratio)
        indices = np.arange(n_out) / ratio
        indices = np.clip(indices.astype(int), 0, len(pcm) - 1)
        pcm = pcm[indices].astype(np.float32)

    if stream_id not in asr_buffers:
        asr_buffers[stream_id] = []
        _silence_frames[stream_id] = 0
        _last_flush[stream_id] = time.time()

    asr_buffers[stream_id].append(pcm.copy())

    # Compute RMS to detect silence
    rms = float(np.sqrt(np.mean(pcm ** 2)))
    if rms < SILENCE_THRESHOLD:
        _silence_frames[stream_id] += 1
    else:
        _silence_frames[stream_id] = 0

    # Auto-flush conditions:
    # 1) Silence for > 800ms (8 frames of 100ms at 16kHz)
    # 2) Buffer exceeds 10s of audio
    total_samples = sum(len(c) for c in asr_buffers[stream_id])
    buffer_ms = total_samples / ASR_SAMPLE_RATE * 1000
    # Each chunk is 4096 samples at whatever rate, but after resample it's ~1482 samples (93ms at 16k)
    chunk_ms = len(pcm) / ASR_SAMPLE_RATE * 1000
    silent_ms = _silence_frames[stream_id] * chunk_ms

    if silent_ms >= SILENCE_FLUSH_MS and total_samples >= MIN_ASR_SAMPLES:
        _silence_frames[stream_id] = 0
        flush_asr(stream_id)
    elif buffer_ms >= MAX_BUFFER_MS:
        _silence_frames[stream_id] = 0
        flush_asr(stream_id)

def flush_asr(stream_id: str):
    """Run ASR on accumulated audio, then MT, then broadcast caption.
    Spawns a background thread so the caller returns immediately.
    """
    chunks = asr_buffers.pop(stream_id, None)
    if chunks is None or len(chunks) == 0:
        return
    audio = np.concatenate(chunks)
    if len(audio) < MIN_ASR_SAMPLES:
        return
    threading.Thread(target=_run_asr_mt, args=(stream_id, audio), daemon=True).start()
TRANSLATOR_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Call Translator</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
     background:#0b141a;color:#e9edef;min-height:100vh;display:flex;
     flex-direction:column;align-items:center}
.header{background:#075E54;padding:14px 20px;width:100%;text-align:center;
        font-size:17px;font-weight:600;position:sticky;top:0;z-index:10}
.header .sub{font-size:11px;font-weight:400;opacity:.8;margin-top:2px}
#captions{flex:1;width:100%;max-width:600px;padding:12px 16px;overflow-y:auto;
          display:flex;flex-direction:column;gap:6px;padding-bottom:80px}
.msg{padding:8px 12px;border-radius:8px;max-width:85%;word-wrap:break-word}
.msg.remote{background:#202c33;align-self:flex-start;border-radius:0 8px 8px 8px}
.msg.local{background:#005c4b;align-self:flex-end;border-radius:8px 0 8px 8px}
.msg .who{font-size:10px;color:#8696a0;margin-bottom:3px}
.msg .orig{font-size:15px;line-height:1.45}
.msg .trans{font-size:14px;line-height:1.45;color:#53bdeb;margin-top:3px}
.msg .pending{font-size:13px;color:#8696a0;font-style:italic}
.controls{position:fixed;bottom:0;left:0;right:0;padding:10px 16px;
          background:#111b21;display:flex;gap:8px;justify-content:center;align-items:center}
#micBtn{flex:0 1 400px;padding:14px;border:none;border-radius:24px;
        font-size:15px;font-weight:600;cursor:pointer;transition:.15s;
        -webkit-user-select:none;user-select:none;touch-action:none}
#micBtn.off{background:#075E54;color:#fff}
#micBtn.on{background:#d32f2f;color:#fff}
#micBtn .pulse{display:inline-block;width:10px;height:10px;border-radius:50%;
               background:#ff5252;margin-right:6px;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
#status{text-align:center;font-size:11px;color:#8696a0;padding:2px}
.lang-bar{padding:6px 16px;display:flex;gap:6px;overflow-x:auto;
          -webkit-overflow-scrolling:touch}
.lang-bar button{padding:5px 12px;border:1px solid #2a3942;border-radius:16px;
                  background:#111b21;color:#8696a0;cursor:pointer;font-size:12px;
                  white-space:nowrap;flex-shrink:0}
.lang-bar button.active{background:#075E54;color:#fff;border-color:#075E54}
</style>
</head>
<body>
<div class="header">Call Translator
  <div class="sub" id="statusText">Connecting...</div>
</div>
<div class="lang-bar" id="langBar"></div>
<div id="captions"></div>
<div class="controls">
  <button id="micBtn" class="off">🎤 Tap to Start Mic</button>
</div>
<script>
let ws, micCtx, proc, stream, micOn = false;
let pair = 'en-es';

// ── WebSocket ───────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { document.getElementById('statusText').textContent = 'Connected'; };
  ws.onclose = () => {
    document.getElementById('statusText').textContent = 'Disconnected — reconnecting...';
    setTimeout(connect, 2000);
  };
  ws.onerror = () => { document.getElementById('statusText').textContent = 'Connection error'; };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.type === 'caption') addCaption(data.who, data.original, data.translated);
    else if (data.type === 'pending') addPending(data.who);
    else if (data.type === 'pair') { pair = data.pair; highlightLang(); }
    else if (data.type === 'lang_list') renderLangBar(data.pairs);
  };
}
connect();

function addCaption(who, original, translated) {
  const captions = document.getElementById('captions');
  const pending = captions.querySelector('.pending-msg[data-who="' + who + '"]');
  if (pending) pending.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'me' ? 'local' : 'remote');
  div.innerHTML = '<div class="who">' + (who === 'me' ? 'You' : 'Other') + '</div>'
    + '<div class="orig">' + esc(original) + '</div>'
    + (translated ? '<div class="trans">' + esc(translated) + '</div>' : '');
  captions.appendChild(div);
  div.scrollIntoView({behavior: 'smooth'});
}

function addPending(who) {
  const captions = document.getElementById('captions');
  const old = captions.querySelector('.pending-msg[data-who="' + who + '"]');
  if (old) return;  // only one pending per speaker
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'me' ? 'local' : 'remote') + ' pending-msg';
  div.setAttribute('data-who', who);
  div.innerHTML = '<div class="who">' + (who === 'me' ? 'You' : 'Other') + '</div>'
    + '<div class="pending">listening...</div>';
  captions.appendChild(div);
  div.scrollIntoView({behavior: 'smooth'});
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function renderLangBar(pairs) {
  const bar = document.getElementById('langBar');
  bar.innerHTML = '';
  pairs.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p;
    btn.dataset.pair = p;
    if (p === pair) btn.classList.add('active');
    btn.onclick = () => {
      pair = p;
      ws.send(JSON.stringify({type: 'set_pair', pair: p}));
      highlightLang();
    };
    bar.appendChild(btn);
  });
}

function highlightLang() {
  document.querySelectorAll('.lang-bar button').forEach(b => {
    b.classList.toggle('active', b.dataset.pair === pair);
  });
}

// ── Continuous mic: tap to toggle on/off ─────────────────────────
const micBtn = document.getElementById('micBtn');
micBtn.addEventListener('click', toggleMic);

async function toggleMic() {
  if (micOn) { stopMic(); return; }

  // Step 1: Check if getUserMedia is available
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('statusText').textContent = 'ERROR: getUserMedia not supported in this browser';
    return;
  }

  // Step 2: Request mic permission
  document.getElementById('statusText').textContent = 'Requesting microphone permission...';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    document.getElementById('statusText').textContent = 'Mic permission granted. Starting...';
  } catch (err) {
    document.getElementById('statusText').textContent = 'Mic denied: ' + err.name + ' — ' + err.message;
    console.error('getUserMedia error:', err);
    return;
  }

  // Step 3: Create AudioContext
  try {
    let AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      document.getElementById('statusText').textContent = 'ERROR: AudioContext not supported';
      return;
    }
    micCtx = new AC();
    // Note: we don't force sampleRate — let the browser pick, we handle on server
    // Report sample rate to server so it can resample
    ws.send(JSON.stringify({type: 'sample_rate', rate: micCtx.sampleRate}));
    document.getElementById('statusText').textContent = 'AudioContext ready (' + micCtx.sampleRate + 'Hz)';
  } catch (err) {
    document.getElementById('statusText').textContent = 'AudioContext error: ' + err.message;
    return;
  }

  // Step 4: Set up audio processing
  try {
    const src = micCtx.createMediaStreamSource(stream);
    // Use ScriptProcessor with 4096 buffer (more reliable than 1600)
    proc = micCtx.createScriptProcessor(4096, 1, 1);
    src.connect(proc);
    proc.connect(micCtx.destination);

    micOn = true;
    micBtn.className = 'on';
    micBtn.innerHTML = '<span class="pulse"></span> Mic ON — Tap to Stop';
    ws.send(JSON.stringify({type: 'speech_start'}));
    document.getElementById('statusText').textContent = 'Mic ON (' + micCtx.sampleRate + 'Hz) — speak freely';

    proc.onaudioprocess = (e) => {
      if (!micOn) return;
      const d = e.inputBuffer.getChannelData(0);
      // Send as binary ArrayBuffer
      ws.send(d.buffer);
    };
  } catch (err) {
    document.getElementById('statusText').textContent = 'Audio setup error: ' + err.message;
    console.error('Audio setup error:', err);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (micCtx) { micCtx.close(); micCtx = null; }
  }
}

function stopMic() {
  micOn = false;
  micBtn.className = 'off';
  micBtn.innerHTML = '🎤 Tap to Start Mic';
  if (proc) { proc.disconnect(); proc = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (micCtx) { micCtx.close(); micCtx = null; }
  ws.send(JSON.stringify({type: 'speech_end'}));
  document.getElementById('statusText').textContent = 'Mic OFF';
}
</script>
</body>
</html>"""


# ── Routes ────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return HTMLResponse(TRANSLATOR_PAGE)

@app.get("/test")
async def test_page():
    """Diagnostic page to debug mic issues."""
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mic Test</title><style>body{font-family:sans-serif;padding:20px;background:#111;color:#eee}
button{padding:12px 24px;font-size:16px;cursor:pointer}#log{margin-top:20px;white-space:pre-wrap;font-family:monospace;font-size:12px}</style>
</head><body>
<h2>Mic Diagnostic</h2>
<button onclick="runTest()">Run Test</button>
<div id="log"></div>
<script>
function log(msg) {
  document.getElementById('log').textContent += msg + '\\n';
}
async function runTest() {
  log('=== Browser Info ===');
  log('UA: ' + navigator.userAgent);
  log('mediaDevices: ' + !!navigator.mediaDevices);
  log('getUserMedia: ' + !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  log('AudioContext: ' + !!window.AudioContext);
  log('webkitAudioContext: ' + !!window.webkitAudioContext);
  log('ScriptProcessor: ' + !!(window.AudioContext && new AudioContext().createScriptProcessor));
  log('WebSocket: ' + !!window.WebSocket);

  log('\\n=== Requesting Mic ===');
  try {
    let stream = await navigator.mediaDevices.getUserMedia({audio: true});
    log('SUCCESS: mic stream obtained');
    let tracks = stream.getTracks();
    log('Tracks: ' + tracks.length);
    log('Track 0: ' + tracks[0].label);
    let settings = tracks[0].getSettings();
    log('Settings: ' + JSON.stringify(settings));

    log('\\n=== AudioContext ===');
    let ctx = new (window.AudioContext || window.webkitAudioContext)();
    log('Sample rate: ' + ctx.sampleRate);
    log('State: ' + ctx.state);

    log('\\n=== ScriptProcessor ===');
    let src = ctx.createMediaStreamSource(stream);
    let proc = ctx.createScriptProcessor(4096, 1, 1);
    log('ScriptProcessor created');
    src.connect(proc);
    proc.connect(ctx.destination);

    let count = 0;
    proc.onaudioprocess = (e) => {
      if (count === 0) log('First audio frame received!');
      count++;
      if (count === 10) {
        log('Got 10 frames. Mic is working!');
        proc.disconnect();
        stream.getTracks().forEach(t => t.stop());
        ctx.close();
        log('\\nTEST RESULT: PASS');
      }
    };
    log('Waiting for audio frames...');
  } catch (err) {
    log('ERROR: ' + err.name + ' — ' + err.message);
    log('\\nTEST RESULT: FAIL');
  }
}
</script>
</body></html>""")

@app.get("/health")
async def health():
    return {"status": "ok", "clients": len(clients), "pair": pair,
            "mt_ready": mt_engine is not None}

@app.post("/api/set_pair")
async def set_pair(request: Request):
    global pair
    data = await request.json()
    pair = data.get("pair", pair)
    await broadcast({"type": "pair", "pair": pair})
    return {"ok": True, "pair": pair}

@app.post("/api/host_audio")
async def host_audio(request: Request):
    """Receive Person A's audio chunks from translator_app.py (raw float32)."""
    body = await request.body()
    if len(body) < 4:
        return JSONResponse({"error": "too short"}, status_code=400)
    pcm = np.frombuffer(body, dtype=np.float32)
    feed_asr("host", pcm)
    return {"ok": True, "n": len(pcm)}

@app.post("/api/host_speech_end")
async def host_speech_end():
    """Signal that Person A stopped speaking (flush ASR buffer).

    Returns immediately — ASR runs in a background thread.
    """
    flush_asr("host")
    return {"ok": True}

@app.post("/api/init_mt")
async def init_mt(request: Request):
    """Initialize MT engine with a language pair."""
    global mt_engine, pair
    data = await request.json()
    pair = data.get("pair", pair)
    if mt_engine:
        mt_engine.stop()
    mt_engine = CTranslate2MT(pair=pair)
    mt_engine.start()
    return {"ok": True, "pair": pair}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global next_client_id, pair
    await ws.accept()
    cid = next_client_id
    next_client_id += 1
    is_host = (cid == 1 and len(clients) == 0)
    clients[cid] = {"ws": ws, "is_host": is_host}
    who = "me" if is_host else "remote"
    print(f"[server] client {cid} connected (is_host={is_host})")

    await ws.send_json({"type": "pair", "pair": pair})
    await ws.send_json({"type": "lang_list", "pairs": list(PAIR_STATUS.keys())})

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.receive":
                if "bytes" in msg and msg["bytes"] is not None:
                    # Browser audio (Person B)
                    pcm = np.frombuffer(msg["bytes"], dtype=np.float32)
                    sr = clients.get(cid, {}).get("sample_rate", 16000)
                    feed_asr(f"guest_{cid}", pcm, sample_rate=sr)
                elif "text" in msg and msg["text"] is not None:
                    data = json.loads(msg["text"])
                    if data.get("type") == "set_pair":
                        pair = data["pair"]
                        await broadcast({"type": "pair", "pair": pair})
                    elif data.get("type") == "speech_start":
                        who_label = "me" if is_host else "remote"
                        await broadcast({"type": "pending", "who": who_label})
                    elif data.get("type") == "speech_end":
                        flush_asr(f"guest_{cid}")
                    elif data.get("type") == "sample_rate":
                        # Client reports its AudioContext sample rate
                        clients[cid]["sample_rate"] = data.get("rate", 16000)
    except (WebSocketDisconnect, RuntimeError, Exception):
        pass
    finally:
        clients.pop(cid, None)
        print(f"[server] client {cid} disconnected")


# ── ASR pipeline ──────────────────────────────────────────────────────

# Moonshine loaded lazily (slow import + model load)
_transcriber = None
_model_path = None
_model_arch = None

def _get_transcriber():
    global _transcriber, _model_path, _model_arch
    if _transcriber is not None:
        return _transcriber
    from moonshine_voice import Transcriber
    from moonshine_voice.download import get_model_for_language
    from moonshine_voice.moonshine_api import ModelArch
    print("[asr] loading Moonshine small-streaming model...")
    _model_path, _model_arch = get_model_for_language('en', ModelArch.SMALL_STREAMING)
    _transcriber = Transcriber(model_path=_model_path, model_arch=_model_arch)
    print(f"[asr] model loaded: {_model_path}")
    return _transcriber


# ── ASR worker (runs in background thread on flush) ───────────────────

def _run_asr_mt(stream_id: str, audio: np.ndarray):
    """Transcribe → translate → broadcast. Runs in a worker thread."""
    try:
        transcriber = _get_transcriber()
        t0 = time.perf_counter()
        result = transcriber.transcribe_without_streaming(audio, ASR_SAMPLE_RATE)
        asr_ms = (time.perf_counter() - t0) * 1000

        # Concatenate all line texts
        text = " ".join(line.text for line in result.lines).strip()
        if not text:
            return

        print(f"[asr] {stream_id} ({asr_ms:.0f}ms): {text[:80]}")

        # Determine who: host=me, guest=remote
        who = "me" if stream_id == "host" else "remote"

        # Run MT
        translated = ""
        if mt_engine:
            with mt_lock:
                translated, reason = mt_engine.translate(text, stream_id=stream_id)
            if translated:
                print(f"[mt] {stream_id}: {translated[:80]}")
        else:
            print("[mt] engine not ready, sending original only")

        # Broadcast caption
        caption = {"type": "caption", "who": who,
                    "original": text, "translated": translated}
        broadcast_from_thread(caption)

    except Exception as e:
        print(f"[asr] error in _run_asr_mt: {e}")
        import traceback
        traceback.print_exc()


# ── Broadcast helper ──────────────────────────────────────────────────

# The server's event loop (set in startup so worker threads can schedule coros)
_server_loop: asyncio.AbstractEventLoop | None = None

async def broadcast(message: dict):
    """Send a JSON message to all connected WebSocket clients."""
    msg_str = json.dumps(message)
    dead = []
    for cid, c in clients.items():
        try:
            await c["ws"].send_text(msg_str)
        except Exception:
            dead.append(cid)
    for cid in dead:
        clients.pop(cid, None)

def broadcast_from_thread(message: dict):
    """Thread-safe broadcast: schedule on the server's event loop."""
    if _server_loop is not None:
        asyncio.run_coroutine_threadsafe(broadcast(message), _server_loop)
    else:
        print("[server] WARNING: no event loop for broadcast")


# ── Startup ───────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _server_loop
    _server_loop = asyncio.get_event_loop()
    print("[server] startup — serving on http://0.0.0.0:8765")
    print("[server] share this URL (via ngrok) with the other person")

def run_server(host="0.0.0.0", port=8765):
    print(f"[server] starting on http://{host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == "__main__":
    run_server()