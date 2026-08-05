#!/usr/bin/env python3
"""
translation_server.py — Local WebSocket translation server (Windows host).

Architecture (iTour-style link sharing):
  Person A runs this on their Windows machine.
  Person A shares the ngrok URL via WhatsApp.
  Person B opens the URL on their phone -> web page connects via WebSocket.
  Both people's audio is sent to this server, transcribed (Moonshine ASR),
  translated (CTranslate2 MT), and bilingual captions are pushed back to
  both clients in real time.

  The Windows host (Person A) can also capture local audio via WASAPI
  loopback + mic for the local side, while Person B uses the browser's
  getUserMedia for their mic.

Flow:
  Browser (Person B) <—WebSocket—> This server <—Local audio—> Person A
  ASR + MT all run on-device here (free, no paid APIs).
"""

import os
import sys
import json
import time
import asyncio
import threading
import numpy as np
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mt_ct2 import CTranslate2MT, filter_caption, PAIR_STATUS

app = FastAPI(title="WhatsApp Call Translator")

# --- Shared state ---
# WebSocket connections: each client gets an id
clients = {}  # client_id -> {"ws": WebSocket, "name": str, "lang": str}
next_client_id = 1
mt_engine = None  # CTranslate2MT, initialized on startup
pair = "en-zh"  # default, changed via UI


# --- HTML page served to Person B ---
TRANSLATOR_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WhatsApp Call Translator</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
       background:#1a1a2e; color:#fff; min-height:100vh; display:flex;
       flex-direction:column; align-items:center; }
.header { background:#075E54; color:#fff; padding:16px 20px; width:100%;
          text-align:center; font-size:18px; font-weight:bold; position:sticky; top:0; z-index:10; }
.header .sub { font-size:12px; font-weight:normal; opacity:0.8; }
#captions { flex:1; width:100%; max-width:600px; padding:16px; overflow-y:auto;
           display:flex; flex-direction:column; gap:8px; }
.msg { padding:10px 14px; border-radius:12px; max-width:85%; word-wrap:break-word; }
.msg.remote { background:#202C33; align-self:flex-start; }
.msg.local { background:#005C4B; align-self:flex-end; }
.msg .orig { font-size:15px; line-height:1.4; }
.msg .trans { font-size:14px; line-height:1.4; color:#7DD3FC; margin-top:4px; }
.msg .who { font-size:10px; color:#8696A0; margin-bottom:2px; }
.controls { padding:16px; width:100%; max-width:600px; display:flex; gap:10px; }
#micBtn { flex:1; padding:14px; border:none; border-radius:12px; font-size:16px;
          font-weight:bold; cursor:pointer; transition:0.2s; }
#micBtn.on { background:#f44336; color:#fff; }
#micBtn.off { background:#075E54; color:#fff; }
#status { text-align:center; font-size:12px; color:#8696A0; padding:4px; }
.lang-bar { padding:8px 16px; display:flex; gap:6px; overflow-x:auto; }
.lang-bar button { padding:6px 12px; border:1px solid #333; border-radius:16px;
                    background:#1a1a2e; color:#ccc; cursor:pointer; font-size:12px; white-space:nowrap; }
.lang-bar button.active { background:#075E54; color:#fff; border-color:#075E54; }
</style>
</head>
<body>
<div class="header">
  WhatsApp Call Translator
  <div class="sub">Connected to host · Tap mic to talk</div>
</div>
<div class="lang-bar" id="langBar"></div>
<div id="captions"></div>
<div id="status">Connecting...</div>
<div class="controls">
  <button id="micBtn" class="off">🎤 Hold to Talk</button>
</div>
<script>
let ws;
let micCtx, proc, stream;
let recording = false;
let pair = 'en-zh';

// WebSocket connection
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
ws = new WebSocket(proto + '://' + location.host + '/ws');
ws.onopen = () => { document.getElementById('status').textContent = 'Connected ✓'; };
ws.onclose = () => { document.getElementById('status').textContent = 'Disconnected — tap to retry';
  setTimeout(() => location.reload(), 2000); };
ws.onerror = () => { document.getElementById('status').textContent = 'Connection error'; };
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.type === 'caption') {
    addCaption(data.who, data.original, data.translated);
  } else if (data.type === 'pair') {
    pair = data.pair;
    updateLangBar();
  } else if (data.type === 'lang_list') {
    renderLangBar(data.pairs);
  }
};

function addCaption(who, original, translated) {
  const div = document.createElement('div');
  div.className = 'msg ' + (who === 'me' ? 'local' : 'remote');
  div.innerHTML = '<div class="who">' + (who === 'me' ? 'You' : 'Other') + '</div>'
    + '<div class="orig">' + esc(original) + '</div>'
    + (translated ? '<div class="trans">' + esc(translated) + '</div>' : '');
  document.getElementById('captions').appendChild(div);
  div.scrollIntoView({behavior:'smooth'});
}

function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

// Language bar
function renderLangBar(pairs) {
  const bar = document.getElementById('langBar');
  bar.innerHTML = '';
  pairs.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p;
    if (p === pair) btn.classList.add('active');
    btn.onclick = () => {
      pair = p;
      ws.send(JSON.stringify({type:'set_pair', pair:p}));
      document.querySelectorAll('.lang-bar button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    };
    bar.appendChild(btn);
  });
}

// Mic capture + streaming via WebSocket
const micBtn = document.getElementById('micBtn');
micBtn.addEventListener('pointerdown', startRec);
micBtn.addEventListener('pointerup', stopRec);
micBtn.addEventListener('pointerleave', stopRec);

async function startRec() {
  if (recording) return;
  recording = true;
  micBtn.classList.remove('off'); micBtn.classList.add('on');
  micBtn.textContent = '🔴 Recording...';
  stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, sampleRate:16000, echoCancellation:true, noiseSuppression:true}});
  micCtx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:16000});
  const src = micCtx.createMediaStreamSource(stream);
  proc = micCtx.createScriptProcessor(1600, 1, 1); // 100ms chunks at 16kHz
  src.connect(proc);
  proc.connect(micCtx.destination);
  proc.onaudioprocess = (e) => {
    if (!recording) return;
    const d = e.inputBuffer.getChannelData(0);
    // Send as base64 float32
    const buf = new ArrayBuffer(d.byteLength);
    new Float32Array(buf).set(d);
    ws.send(buf);
  };
}

function stopRec() {
  if (!recording) return;
  recording = false;
  micBtn.classList.remove('on'); micBtn.classList.add('off');
  micBtn.textContent = '🎤 Hold to Talk';
  if (proc) proc.disconnect();
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (micCtx) micCtx.close();
  ws.send(JSON.stringify({type:'end_speech'}));
}
</script>
</body>
</html>"""


@app.get("/")
async def index():
    return HTMLResponse(TRANSLATOR_PAGE)


@app.get("/health")
async def health():
    return {"status": "ok", "clients": len(clients), "pair": pair}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    global next_client_id, pair
    await ws.accept()
    cid = next_client_id
    next_client_id += 1
    clients[cid] = {"ws": ws, "name": f"Guest{cid}", "is_me": cid == 1}
    who = "me" if cid == 1 else "remote"
    print(f"[server] client {cid} connected ({who})")

    # Send current pair + available pairs
    await ws.send_json({"type": "pair", "pair": pair})
    await ws.send_json({"type": "lang_list", "pairs": list(PAIR_STATUS.keys())})

    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.receive":
                if "bytes" in msg:
                    # Audio data (float32 PCM, 100ms chunks at 16kHz)
                    audio = np.frombuffer(msg["bytes"], dtype=np.float32)
                    # For now: in mock mode, we don't run ASR on browser audio
                    # (ASR needs Moonshine model downloaded)
                    pass
                elif "text" in msg:
                    data = json.loads(msg["text"])
                    if data.get("type") == "set_pair":
                        pair = data["pair"]
                        print(f"[server] pair changed to {pair}")
                        # Broadcast to all clients
                        for c in clients.values():
                            await c["ws"].send_json({"type": "pair", "pair": pair})
                    elif data.get("type") == "end_speech":
                        pass
    except WebSocketDisconnect:
        pass
    finally:
        if cid in clients:
            del clients[cid]
        print(f"[server] client {cid} disconnected")


def run_server(host="0.0.0.0", port=8765):
    print(f"[server] starting on http://{host}:{port}")
    print(f"[server] share this URL (via ngrok) with the other person")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    run_server()