#!/usr/bin/env python3
"""test_room.py — room plumbing checks that do not need the GPU models.

    python test_room.py

Covers the two defects this rewrite exists to fix: a caption that told both
people they were the speaker, and a partial backlog that made latency grow
instead of converge.
"""

import os
import time

import numpy as np

import translation_server as srv
from translation_server import Job, JobQueue, Participant, caption_message


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
    a = Participant(id=1, ws=None, lang="en")
    b = Participant(id=2, ws=None, lang="es")
    srv.participants.update({1: a, 2: b})
    assert srv.target_langs(a) == ["es"]
    assert srv.target_langs(b) == ["en"]

    # Same language on both sides means nothing to translate.
    b.lang = "en"
    assert srv.target_langs(a) == []
    srv.participants.clear()


def test_ingest_ignores_silence():
    srv.participants.clear()
    p = Participant(id=1, ws=None, lang="en")
    srv.participants[1] = p
    before = len(srv.jobs)
    for _ in range(50):  # 5s of digital silence
        srv.ingest(p, np.zeros(1600, dtype=np.float32))
    assert len(srv.jobs) == before, "silence queued ASR work"
    assert p.seq == 0, "silence opened an utterance"
    assert p.ep.duration_ms <= srv.IDLE_DROP_S * 1000, "silence buffer grew unbounded"
    srv.participants.clear()


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
    srv.participants.clear()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"  PASS {t.__name__}")
    print(f"{len(tests)}/{len(tests)} passed")


if __name__ == "__main__":
    main()
