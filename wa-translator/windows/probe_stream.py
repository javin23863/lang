#!/usr/bin/env python3
"""probe_stream.py — play a WAV into a running room and time the captions.

    python probe_stream.py                          # both fixtures, both directions
    python probe_stream.py ..\\test-audio\\es.wav es  # one clip

Streams the file in real time (100ms frames, as a browser would) and prints
when each caption came back, measured from the moment speech actually starts in
the file — not from the start of the file, which would flatter the numbers by
however much leading silence the clip happens to have.

This is the only check that can fail on "the captions are too slow". The unit
tests cannot: they never run audio.
"""

import asyncio
import json
import os
import sys
import time
import urllib.request
import wave

import numpy as np
import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from endpointer import speech_probs, SPEECH_THRESHOLD, WINDOW
from translation_server import DEFAULT_PORT

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "test-audio")
URL = os.environ.get("ROOM_WS")
SAMPLE_RATE = 16000
FRAME = 1600  # 100ms


def create_room_ws_url():
    req = urllib.request.Request(
        f"http://localhost:{DEFAULT_PORT}/api/rooms", method="POST", data=b"",
        headers={"Origin": f"http://localhost:{DEFAULT_PORT}"})
    with urllib.request.urlopen(req, timeout=5) as response:
        path = json.load(response)["path"]
    return f"ws://localhost:{DEFAULT_PORT}/ws/{path.split('/')[-1]}"


def load_wav(path):
    with wave.open(path, "rb") as w:
        assert w.getframerate() == SAMPLE_RATE, f"{path} is {w.getframerate()}Hz, need 16k"
        assert w.getnchannels() == 1, f"{path} is not mono"
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def speech_onset_s(pcm_i16):
    """Seconds into the clip where speech begins, by the server's own VAD."""
    probs = speech_probs(pcm_i16.astype(np.float32) / 32768.0)
    hits = np.nonzero(probs >= SPEECH_THRESHOLD)[0]
    return float(hits[0]) * WINDOW / SAMPLE_RATE if hits.size else 0.0


async def participant(lang, name, results, ready, clip=None, listen_for=None):
    async with websockets.connect(URL, max_size=None) as ws:
        await ws.send(json.dumps({"type": "join", "lang": lang, "name": name}))

        async def reader():
            async for raw in ws:
                m = json.loads(raw)
                if m.get("type") == "caption":
                    results.append((time.perf_counter(), m))

        task = asyncio.create_task(reader())
        ready.set()
        if clip is None:
            await asyncio.sleep(listen_for)
        else:
            pcm, t0 = clip
            # Absolute schedule. Sleeping FRAME/RATE per iteration accumulates
            # the Windows timer's ~15ms granularity into seconds of drift over a
            # short clip, and every caption then looks that much later than it is.
            for n, i in enumerate(range(0, len(pcm), FRAME), start=1):
                await ws.send(pcm[i:i + FRAME].tobytes())
                due = t0 + n * FRAME / SAMPLE_RATE
                delay = due - time.perf_counter()
                if delay > 0:
                    await asyncio.sleep(delay)
            results.append(("__sent__", time.perf_counter()))
            await asyncio.sleep(3.0)  # let the final land
        task.cancel()


async def run_clip(path, speaker_lang, listener_lang):
    pcm = load_wav(path)
    onset = speech_onset_s(pcm)
    results, listener_results = [], []
    ready = asyncio.Event()

    listener = asyncio.create_task(
        participant(listener_lang, "listener", listener_results, ready,
                    listen_for=len(pcm) / SAMPLE_RATE + 4))
    await ready.wait()

    t_start = time.perf_counter()
    await participant(speaker_lang, "speaker", results, asyncio.Event(), clip=(pcm, t_start))
    listener.cancel()

    speech_t0 = t_start + onset
    clip_s = len(pcm) / SAMPLE_RATE
    sent_at = next((t for tag, t in results if tag == "__sent__"), None)
    results = [(t, m) for t, m in results if t != "__sent__"]

    print(f"\n=== {os.path.basename(path)}  ({speaker_lang} -> {listener_lang}) "
          f"| {clip_s:.1f}s clip, speech starts at {onset:.2f}s ===")

    # If the probe could not feed audio at real-time speed, every latency below
    # is inflated by its own drift and must not be reported as the app's.
    if sent_at is not None:
        drift = (sent_at - t_start) - clip_s
        if drift > 0.35:
            print(f"  VOID: probe took {drift:+.2f}s longer than real time to send "
                  f"the clip. Latency numbers from this run mean nothing.")
            return None
        print(f"  (probe pacing drift {drift:+.2f}s)")

    if not results:
        print("  NO CAPTIONS — the room produced nothing for this clip")
        return None

    first_partial = None
    final = None
    for t, m in results:
        dt = t - speech_t0
        kind = "FINAL  " if m["final"] else "partial"
        if not m["final"] and first_partial is None and m["original"]:
            first_partial = dt
        if m["final"] and m["original"]:
            final = (dt, m)
        # dt is what the reader experiences; t_ms is what the server spent on it.
        # A gap between them is transport or pacing, not ASR.
        print(f"  {dt:6.2f}s  (server {m['t_ms']/1000:5.2f}s)  {kind}  {m['original']}")
        if m["translations"]:
            print(f"                    -> {m['translations'].get(listener_lang, '')}")

    audio_end = sent_at if sent_at is not None else t_start + clip_s
    fp = "none" if first_partial is None else f"{first_partial:.2f}s"
    print(f"  first partial: {fp} after speech onset")
    if final:
        t_final_wall = next(t for t, m in results if m["final"] and m["original"])
        print(f"  final:         {final[0]:.2f}s after speech onset, "
              f"{t_final_wall - audio_end:+.2f}s relative to the end of the audio")
        assert final[1]["translations"].get(listener_lang), \
            f"final caption carried no {listener_lang} translation"
        assert final[1]["speaker_lang"] == speaker_lang
    else:
        print("  NO FINAL CAPTION")
    return {"first_partial_s": first_partial,
            "final_s": final[0] if final else None,
            "text": final[1]["original"] if final else "",
            "translation": final[1]["translations"].get(listener_lang) if final else ""}


async def _send_frame_of(n_bytes, label):
    """Send one binary frame of n_bytes and report whether the server hung up."""
    try:
        async with websockets.connect(URL, max_size=None) as ws:
            await ws.send(json.dumps({"type": "join", "lang": "en", "name": "abuse"}))
            await ws.send(b"\x00" * n_bytes)
            try:
                async with asyncio.timeout(5):
                    async for _ in ws:
                        pass
            except TimeoutError:
                print(f"  FAIL: {label} ({n_bytes}B) was accepted and the socket stayed open")
                return False
    except websockets.exceptions.ConnectionClosed as e:
        print(f"  ok: {label} ({n_bytes}B) closed the connection, code {e.code}")
        return True
    print(f"  ok: {label} ({n_bytes}B) closed the connection")
    return True


async def check_room_capacity():
    """One more than MAX_PARTICIPANTS must be told the room is full, not just
    dropped — a bare close looks identical to the server being down."""
    from translation_server import MAX_PARTICIPANTS
    held, told = [], None
    try:
        for i in range(MAX_PARTICIPANTS + 1):
            ws = await websockets.connect(URL, max_size=None)
            await ws.send(json.dumps({"type": "join", "lang": "en", "name": f"p{i}"}))
            held.append(ws)
            try:
                async with asyncio.timeout(2):
                    async for raw in ws:
                        m = json.loads(raw)
                        if m.get("type") == "room_full":
                            told = m
                            break
                        if m.get("type") == "welcome":
                            break
            except (TimeoutError, websockets.exceptions.ConnectionClosed):
                pass
        if told:
            print(f"  ok: joiner {MAX_PARTICIPANTS + 1} was told the room is full "
                  f"(limit {told.get('limit')})")
            return True
        print(f"  FAIL: {MAX_PARTICIPANTS + 1} participants were all admitted")
        return False
    finally:
        for ws in held:
            await ws.close()
        await asyncio.sleep(0.5)   # let the server drop them before the next check


async def check_idle_sockets_hold_no_slot():
    """Sockets that never join must not consume room capacity.

    Opening a socket against a public link and saying nothing costs an attacker
    nothing. Counting connections rather than joins let MAX_PARTICIPANTS idle
    sockets hold the room shut against everyone real.
    """
    from translation_server import MAX_PARTICIPANTS, PRE_JOIN_TIMEOUT_S
    idle = []
    try:
        for _ in range(MAX_PARTICIPANTS):
            idle.append(await websockets.connect(URL, max_size=None))
        await asyncio.sleep(1)

        async with websockets.connect(URL, max_size=None) as real:
            await real.send(json.dumps({"type": "join", "lang": "en", "name": "real"}))
            try:
                async with asyncio.timeout(5):
                    async for raw in real:
                        m = json.loads(raw)
                        if m.get("type") == "welcome":
                            print(f"  ok: a real join succeeds past {MAX_PARTICIPANTS} "
                                  f"idle sockets")
                            return True
                        if m.get("type") == "room_full":
                            print("  FAIL: idle sockets that never joined filled the room")
                            return False
            except (TimeoutError, websockets.exceptions.ConnectionClosed):
                pass
        print("  FAIL: a real join got no welcome while idle sockets were open")
        return False
    finally:
        for ws in idle:
            await ws.close()
        await asyncio.sleep(0.5)


async def check_chatty_unjoined_socket_is_closed():
    """Pre-join traffic must not renew the join deadline.

    With a per-receive timeout, a client keeps an unjoined socket alive forever
    simply by sending something ignorable more often than the timeout. The
    deadline has to be absolute, so this sends junk every second and expects to
    be hung up on anyway.
    """
    from translation_server import PRE_JOIN_TIMEOUT_S
    budget = PRE_JOIN_TIMEOUT_S * 2 + 5
    t0 = time.perf_counter()
    try:
        async with websockets.connect(URL, max_size=None) as ws:
            while time.perf_counter() - t0 < budget:
                await ws.send(json.dumps({"type": "not_a_join"}))
                await asyncio.sleep(1)
    except websockets.exceptions.ConnectionClosed:
        held = time.perf_counter() - t0
        print(f"  ok: a chatty unjoined socket was closed after {held:.0f}s "
              f"(deadline {PRE_JOIN_TIMEOUT_S}s)")
        return True
    print(f"  FAIL: an unjoined socket stayed open {budget}s by sending junk — "
          f"the join deadline is being reset per message")
    return False


async def check_oversized_frames_are_refused():
    """The room is served over a public tunnel, so a client is not trusted.

    Both layers are exercised, because a defense nobody tests is a defense
    nobody knows is dead: the app-level check in the /ws handler, and the
    transport-level ws_max_size that stops uvicorn buffering the message at all.
    """
    from translation_server import MAX_FRAME_BYTES, WS_MAX_SIZE
    ok = await _send_frame_of(MAX_FRAME_BYTES * 2, "app-level limit")
    await asyncio.sleep(0.3)
    ok &= await _send_frame_of(WS_MAX_SIZE * 4, "transport limit")

    ok &= await check_room_capacity()
    await asyncio.sleep(0.3)
    ok &= await check_idle_sockets_hold_no_slot()
    await asyncio.sleep(0.3)
    ok &= await check_chatty_unjoined_socket_is_closed()

    # And a legitimate 100ms frame must still be accepted, or the guard is
    # simply refusing everything.
    try:
        async with websockets.connect(URL, max_size=None) as ws:
            await ws.send(json.dumps({"type": "join", "lang": "en", "name": "normal"}))
            await ws.send(b"\x00" * 3200)
            await asyncio.sleep(1.0)
            alive = ws.state.name == "OPEN"
        print(("  ok: " if alive else "  FAIL: ") + "a normal 3200B frame is still accepted")
        ok &= alive
    except Exception as e:
        print(f"  FAIL: normal frame rejected: {e}")
        ok = False
    return ok


async def main():
    global URL
    URL = URL or create_room_ws_url()
    print("=== abuse checks ===")
    if not await check_oversized_frames_are_refused():
        print("guard checks failed — not reporting latency for this run")
        return
    await asyncio.sleep(0.5)

    if len(sys.argv) > 1:
        path = sys.argv[1]
        lang = sys.argv[2] if len(sys.argv) > 2 else "en"
        await run_clip(path, lang, "es" if lang == "en" else "en")
        return

    summary = {}
    for lang, other in (("en", "es"), ("es", "en")):
        path = os.path.join(FIXTURES, f"{lang}.wav")
        if not os.path.exists(path):
            print(f"missing fixture {path} — see windows/README.md to regenerate")
            continue
        summary[lang] = await run_clip(path, lang, other)
        await asyncio.sleep(1)

    print("\n=== summary ===")
    for lang, s in summary.items():
        if not s:
            continue
        fp = f"{s['first_partial_s']:.2f}s" if s["first_partial_s"] is not None else "none"
        fn = f"{s['final_s']:.2f}s" if s["final_s"] is not None else "none"
        print(f"  {lang}: first partial {fp}, final {fn}")
        print(f"      heard:      {s['text']}")
        print(f"      translated: {s['translation']}")


if __name__ == "__main__":
    asyncio.run(main())
