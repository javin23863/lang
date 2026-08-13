#!/usr/bin/env python3
"""test_room.py — room plumbing checks that do not need the GPU models.

    python test_room.py

Covers the two defects this rewrite exists to fix: a caption that told both
people they were the speaker, and a partial backlog that made latency grow
instead of converge.
"""

import os
import re
import time
import asyncio
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import translation_server as srv
import run_room
import language_catalog
from translation_server import Job, JobQueue, Participant, caption_message


SAME_ORIGIN = {"Origin": "http://testserver"}


def join_message(locale: str, name: str, voice_profile: str | None = None) -> dict:
    """Browser-facing multilingual join contract; no base-code shortcuts."""
    profile = language_catalog.locale_profile(locale)
    assert profile is not None
    return {"type": "join", "locale": locale, "name": name,
            "voice_profile": voice_profile}


def job(pid, seq, final, lang="en"):
    return Job(pid=pid, audio=np.zeros(16000, dtype=np.float32), lang=lang,
               targets=["es"], seq=seq, final=final, onset=time.time())


def test_partials_coalesce():
    q = JobQueue()
    for seq in (1, 2, 3):
        q.put(job(1, seq, final=False))
    assert len(q) == 1, f"three partials from one speaker left {len(q)} queued"
    assert q.dropped_partials == 2
    assert q.get().seq == 3, "the surviving partial was not the newest"


def test_finals_never_dropped():
    q = JobQueue()
    for seq in (1, 2, 3):
        q.put(job(1, seq, final=True))
    assert len(q) == 3, f"finals were coalesced: {len(q)} left"
    assert [q.get().seq for _ in range(3)] == [1, 2, 3]


def test_final_supersedes_pending_partial():
    q = JobQueue()
    q.put(job(1, 1, final=False))
    q.put(job(1, 1, final=True))
    assert len(q) == 1
    got = q.get()
    assert got.final, "the partial outlived the final that replaced it"


def test_finals_run_before_partials():
    q = JobQueue()
    q.put(job(2, 5, final=False))
    q.put(job(1, 1, final=True))
    assert q.get().final, "a partial jumped ahead of a final"


def test_two_speakers_keep_separate_partials():
    q = JobQueue()
    q.put(job(1, 1, final=False))
    q.put(job(2, 1, final=False))
    assert len(q) == 2, "one speaker's partial evicted another's"


def test_drop_speaker_clears_queue():
    q = JobQueue()
    q.put(job(1, 1, final=False))
    q.put(job(1, 2, final=True))
    q.put(job(2, 1, final=True))
    q.drop_speaker(1)
    assert len(q) == 1 and q.get().pid == 2


def test_caption_carries_speaker_not_a_role():
    msg = caption_message(job(7, 3, final=True), "hola", {"en": "hello"})
    assert msg["speaker"] == 7
    assert "who" not in msg, "the old me/remote label is back"
    assert msg["speaker_lang"] == "en" and msg["seq"] == 3 and msg["final"]
    assert msg["translations"] == {"en": "hello"}
    # Both people receive the identical bytes; the label is the client's job.
    assert set(msg) == {"type", "speaker", "speaker_lang", "seq", "final",
                        "original", "translations", "t_ms"}


def test_target_langs_is_the_other_side():
    srv.participants.clear()


def test_multi_target_fanout_deduplicates_same_base_locale_listeners():
    """One source transcript fans out to at most three unique base targets."""
    srv.participants.clear()
    speaker = Participant(id=1, ws=None, room="room-a", locale="en-US", lang="en")
    es_es = Participant(id=2, ws=None, room="room-a", locale="es-ES", lang="es")
    es_mx = Participant(id=3, ws=None, room="room-a", locale="es-MX", lang="es")
    fr = Participant(id=4, ws=None, room="room-a", locale="fr-FR", lang="fr")
    srv.participants.update({p.id: p for p in (speaker, es_es, es_mx, fr)})
    assert srv.target_langs(speaker) == ["es", "fr"]
    srv.participants.clear()
    a = Participant(id=1, ws=None, room="room-a", lang="en")
    b = Participant(id=2, ws=None, room="room-a", lang="es")
    elsewhere = Participant(id=3, ws=None, room="room-b", lang="es")
    srv.participants.update({1: a, 2: b, 3: elsewhere})
    assert srv.target_langs(a) == ["es"]
    assert srv.target_langs(b) == ["en"]

    # Same language inside this room means nothing to translate. The Spanish
    # participant in room-b must not make room-a request a translation.
    b.lang = "en"
    assert srv.target_langs(a) == []
    srv.participants.clear()


def test_private_room_http_flow():
    """POST creates an unguessable room; opening the public root does not."""
    srv.participants.clear()
    srv.rooms.clear()
    client = TestClient(srv.app)

    created = client.post("/api/rooms", headers=SAME_ORIGIN)
    assert created.status_code == 201
    path = created.json()["path"]
    assert re.fullmatch(r"/room/[A-Za-z0-9_-]{24}", path), path

    page = client.get(path)
    assert page.status_code == 200
    assert 'id="shareBtn"' in page.text and "navigator.share" in page.text
    assert page.headers["cache-control"] == "no-store"
    assert page.headers["referrer-policy"] == "no-referrer"
    token = path.split("/")[-1]
    assert client.get("/api/room", headers={"Authorization": f"Bearer {token}"}).status_code == 204
    assert client.get("/api/room", headers={"Authorization": "Bearer invented"}).status_code == 401
    expiry = srv.rooms[path.split("/")[-1]]
    client.get(path)
    assert srv.rooms[path.split("/")[-1]] == expiry, "opening a room extended its hard expiry"
    assert client.get("/room/not-a-real-room").status_code == 404

    rooms_before = len(srv.rooms)
    landing = client.get("/")
    assert landing.status_code == 200
    assert 'id="createBtn"' in landing.text and 'id="closeBtn"' in landing.text
    assert "localStorage" in landing.text and "navigator.share" in landing.text
    assert len(srv.rooms) == rooms_before, "a GET allocated a private room"
    opened = client.post("/rooms", headers=SAME_ORIGIN, follow_redirects=False)
    assert opened.status_code == 303
    assert re.fullmatch(r"/room/[A-Za-z0-9_-]{24}", opened.headers["location"])
    assert opened.headers["location"] != path
    assert isinstance(client.get("/health").json()["participants"], int)
    capabilities = client.get("/api/capabilities")
    assert capabilities.status_code == 200
    assert capabilities.headers["cache-control"] == "no-store"
    assert capabilities.json()["counts"] == {
        "base_languages": 100, "locale_profiles": 122,
        "live_speech_languages": 6, "text_languages": 100,
        "voice_languages": 3, "voice_profiles": 7,
    }
    disabled_runtime = srv.local_runtime_capabilities(model_loading_enabled=False)
    assert disabled_runtime["captions_available"] is False
    assert "not load" in disabled_runtime["captions_unavailable_reason"].lower()
    assert disabled_runtime["voice_profile_ids"] == []
    allowed, reason = srv.local_model_load_preflight(
        True, whisper_model_path=None)
    assert allowed is False and "already provisioned" in reason

    expired_id = path.split("/")[-1]
    srv.rooms[expired_id] = time.time() - 1
    expired = client.get(path)
    invented = client.get("/room/not-a-real-room")
    assert expired.status_code == invented.status_code == 404
    assert expired.text == invented.text
    try:
        with client.websocket_connect(f"/ws/{expired_id}") as closed:
            closed.receive_json()
            raise AssertionError("expired WebSocket stayed open")
    except WebSocketDisconnect as exc:
        assert exc.code == 1008
    client.post("/api/rooms", headers=SAME_ORIGIN)
    assert expired_id not in srv.rooms, "new room creation did not prune expired state"

    before = len(srv.rooms)
    assert client.post("/api/rooms").status_code == 403
    assert client.post("/api/rooms", headers={"Origin": "https://attacker.test"}).status_code == 403
    assert client.post("/rooms", headers={"Origin": "https://attacker.test"}).status_code == 403
    assert len(srv.rooms) == before, "cross-site room creation consumed local room capacity"


def test_local_host_control_closes_only_its_room_and_preserves_the_tombstone():
    """The dashboard's host bearer is separate from a participant invitation."""
    srv.participants.clear()
    srv.rooms.clear()
    srv.host_controls.clear()
    srv.closed_rooms.clear()
    client = TestClient(srv.app)

    created = client.post("/api/rooms", headers=SAME_ORIGIN)
    assert created.status_code == 201
    body = created.json()
    room_id = body["path"].split("/")[-1]
    assert re.fullmatch(r"[A-Za-z0-9_-]{24}", room_id)
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", body["host_control"])
    assert room_id not in body["host_control"]
    assert created.headers["cache-control"] == "no-store"
    assert created.headers["referrer-policy"] == "no-referrer"

    control = {**SAME_ORIGIN, "Authorization": f"Bearer {body['host_control']}"}
    participant = {**SAME_ORIGIN, "Authorization": f"Bearer {room_id}"}
    assert client.get("/api/room-control", headers=control).json() == {
        "state": "ready", "participant_count": 0, "participant_limit": 4
    }
    assert client.get("/api/room-control", headers=participant).status_code == 403
    assert client.get("/api/room-control", headers={
        "Origin": "https://attacker.test", "Authorization": f"Bearer {body['host_control']}"
    }).status_code == 403

    other = client.post("/api/rooms", headers=SAME_ORIGIN).json()
    with client.websocket_connect(f"/ws/{room_id}") as joined:
        joined.send_json(join_message("en-US", "host"))
        assert joined.receive_json()["type"] == "welcome"
        assert client.get("/api/room-control", headers=control).json()["state"] == "open"
        closed = client.post("/api/room-control/close", headers=control)
        assert closed.status_code == 200
        assert closed.json() == {"state": "closed", "participant_count": 0,
                                 "participant_limit": 4}
        assert joined.receive_json() == {"type": "room_closed"}
        try:
            joined.receive_json()
            raise AssertionError("host-closed room WebSocket stayed open")
        except WebSocketDisconnect as exc:
            assert exc.code == 4001

    assert client.get(body["path"]).status_code == 404
    assert client.get("/api/room", headers={"Authorization": f"Bearer {room_id}"}).status_code == 410
    assert client.get(other["path"]).status_code == 200
    assert room_id in srv.closed_rooms, "close must retain the participant-link tombstone"
    srv.rooms[room_id] = time.time() - 1
    assert client.get("/api/room-control", headers=control).status_code == 403


def test_speech_end_after_browser_mute_finalizes_pending_audio():
    class PendingSpeech:
        speech_seen = True

        def take(self):
            self.speech_seen = False
            return np.full(1600, 0.25, dtype=np.float32)

    srv.participants.clear()
    srv.jobs = JobQueue()
    p = Participant(id=91, ws=None, room="room-a", lang="en")
    listener = Participant(id=92, ws=None, room="room-a", lang="es")
    p.ep = PendingSpeech()
    p.seq = 1
    p.onset = time.time()
    srv.participants.update({p.id: p, listener.id: listener})
    assert p.ep.speech_seen and len(srv.jobs) == 0
    asyncio.run(srv._on_control(p, {"type": "speech_end"}))
    flushed = srv.jobs.get()
    assert flushed.final and flushed.pid == p.id and flushed.targets == ["es"]
    assert not p.ep.speech_seen and p.onset == 0.0
    srv.participants.clear()


def test_run_server_records_the_requested_startup_port():
    called = {}
    original = srv.uvicorn.run
    try:
        srv.uvicorn.run = lambda app, **kwargs: called.update(kwargs)
        srv.run_server(host="127.0.0.1", port=9123)
    finally:
        srv.uvicorn.run = original
    assert called["port"] == 9123
    assert srv.app.state.listen_port == 9123
    assert "127.0.0.1:9123" in srv.startup_message(
        srv.app.state.listen_host, srv.app.state.listen_port)


def test_tunnels_target_the_ipv4_server():
    """Tunnel clients must not resolve localhost to ::1 against an IPv4 server."""
    commands = [[part.format(port=8791) for part in provider[1]]
                for provider in run_room.PROVIDERS]
    assert "http://127.0.0.1:8791" in commands[0]
    assert "80:127.0.0.1:8791" in commands[1]


def test_room_peer_discovery_is_isolated():
    """A participant only learns about peers holding the same private URL."""
    srv.participants.clear()
    srv.rooms.clear()
    client = TestClient(srv.app)
    room_a = client.post("/api/rooms", headers=SAME_ORIGIN).json()["path"].split("/")[-1]
    room_b = client.post("/api/rooms", headers=SAME_ORIGIN).json()["path"].split("/")[-1]

    with client.websocket_connect(f"/ws/{room_a}") as a1:
        a1.send_json(join_message("en-US", "A1"))
        welcome_a1 = a1.receive_json()
        assert welcome_a1["type"] == "welcome" and welcome_a1["peers"] == []
        assert welcome_a1["tts_provider"] == "local"

        with client.websocket_connect(f"/ws/{room_b}") as b1:
            b1.send_json(join_message("es-MX", "B1"))
            welcome_b1 = b1.receive_json()
            assert welcome_b1["type"] == "welcome" and welcome_b1["peers"] == []

            with client.websocket_connect(f"/ws/{room_a}") as a2:
                a2.send_json(join_message("es-ES", "A2"))
                welcome_a2 = a2.receive_json()
                assert [p["id"] for p in welcome_a2["peers"]] == [welcome_a1["id"]]
                assert welcome_a2["peers"][0]["locale"] == "en-US"
                assert welcome_a2["peers"][0]["voice_profile"] is None

                # A2's join stays in room A. If it leaked to B, it would be the
                # next message B receives instead of its own update below.
                a1.receive_json()
                a1.send_json({"type": "signal", "to": welcome_b1["id"],
                              "data": {"candidate": {"candidate": "cross-room"}}})
                b1.send_json({"type": "set_locale", "locale": "en-GB",
                              "voice_profile": None})
                b_next = b1.receive_json()
                assert b_next["type"] == "peer_update", b_next

                # Invalid client languages cannot escape into the MT direction
                # names or poison what peers believe this caller speaks.
                a1.send_json({"type": "set_locale", "locale": "not-a-locale",
                              "voice_profile": None})
                try:
                    a1.receive_json()
                    raise AssertionError("unknown locale stayed connected")
                except WebSocketDisconnect as exc:
                    assert exc.code == 1008

    srv.participants.clear()


def test_ingest_ignores_silence():
    srv.participants.clear()
    srv._asr_ready.set()
    try:
        p = Participant(id=1, ws=None, lang="en")
        srv.participants[1] = p
        before = len(srv.jobs)
        for _ in range(50):  # 5s of digital silence
            srv.ingest(p, np.zeros(1600, dtype=np.float32))
        assert len(srv.jobs) == before, "silence queued ASR work"
        assert p.seq == 0, "silence opened an utterance"
        assert p.ep.duration_ms <= srv.IDLE_DROP_S * 1000, "silence buffer grew unbounded"
    finally:
        srv._asr_ready.clear()
        srv.participants.clear()


def test_unloaded_local_caption_runtime_drops_pcm_without_queueing():
    srv.participants.clear()
    srv._asr_ready.clear()
    srv.jobs = JobQueue()
    p = Participant(id=1, ws=None, lang="en")
    srv.participants[p.id] = p
    try:
        srv.ingest(p, np.full(1600, 0.25, dtype=np.float32))
        assert len(srv.jobs) == 0
        assert p.seq == 0
    finally:
        srv.participants.clear()


def test_local_launcher_accepts_the_captions_only_adapter_health():
    """The development launcher must not wait for intentionally disabled models."""
    launcher = Path(__file__).with_name("persistent_host.ps1").read_text(
        encoding="utf-8")
    assert "$health.status -eq 'ok'" in launcher
    assert "$health.models_ready" not in launcher
    assert "$health.tts.en" not in launcher
    assert "$publicUrl = 'https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/'" in launcher
    assert "--app=$publicUrl" in launcher


def test_no_partial_below_min_speech():
    """Whisper returns confident filler ("Gracias.") for ~0.6s of Spanish, so a
    partial must never be requested that early. Uses the real fixture: synthetic
    noise would not reproduce the failure this guard exists for."""
    import wave
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "test-audio", "es.wav")
    if not os.path.exists(path):
        print("  SKIP test_no_partial_below_min_speech (no fixture)")
        return
    with wave.open(path, "rb") as w:
        clip = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    clip = clip.astype(np.float32) / 32768.0

    srv.participants.clear()
    srv._asr_ready.set()
    try:
        p = Participant(id=1, ws=None, lang="es")
        srv.participants[1] = p
        srv.jobs = JobQueue()
        shortest = None
        for i in range(0, int(srv.SAMPLE_RATE * 1.4), 1600):
            srv.ingest(p, clip[i:i + 1600])
            if len(srv.jobs) and shortest is None:
                shortest = srv.jobs.get().audio
        assert shortest is not None, "no partial was ever queued for 1.4s of speech"
        # The fixture opens with 0.5s of silence. Measuring the queued buffer's
        # total length would count that silence as speech and pass at 0.4s of real
        # audio, which is the bug this test exists for — so measure the speech.
        from endpointer import speech_probs, SPEECH_THRESHOLD, WINDOW
        probs = speech_probs(shortest)
        voiced = np.nonzero(probs >= SPEECH_THRESHOLD)[0]
        assert voiced.size, "queued a partial containing no speech at all"
        speech_s = (len(shortest) - int(voiced[0]) * WINDOW) / srv.SAMPLE_RATE
        assert speech_s >= srv.MIN_PARTIAL_S - 0.25, \
            f"queued a partial on {speech_s:.2f}s of speech, below MIN_PARTIAL_S"
    finally:
        srv._asr_ready.clear()
        srv.participants.clear()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  PASS {t.__name__}")
    print(f"{len(tests)}/{len(tests)} passed")


if __name__ == "__main__":
    main()
