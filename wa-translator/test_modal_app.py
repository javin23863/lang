"""Public-interface security and queue tests for the Modal compute adapter."""

import json
import unittest

import numpy as np
from fastapi.testclient import TestClient

import modal_app


SECRET = "test-modal-secret"


class FakeEndpointer:
    """Deterministic endpoint seam; production still uses the Silero endpoint."""

    def __init__(self):
        self.frames = []
        self.speech_seen = False

    def feed(self, frame):
        self.frames.append(frame.copy())
        self.speech_seen = bool(np.any(frame))
        return self.speech_seen, 0.0

    @property
    def speech_ms(self):
        return sum(len(frame) for frame in self.frames) / 16

    @property
    def duration_ms(self):
        return self.speech_ms

    def pending(self):
        return np.concatenate(self.frames) if self.frames else np.zeros(0, np.float32)

    def take(self):
        audio = self.pending()
        self.frames = []
        self.speech_seen = False
        return audio


class FakeCompute:
    def __init__(self):
        self.calls = []

    def transcribe_translate(self, pcm, source_lang, target_lang, stream_id, final):
        marker = int(round(float(pcm.max()) * 32768)) if len(pcm) else 0
        self.calls.append((marker, source_lang, target_lang, stream_id, final))
        return f"source-{marker}", f"translated-{marker}"


class FakeTTS:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, lang, voice_style):
        self.calls.append((text, lang, voice_style))
        # Minimal non-empty PCM WAV, not just an asserted browser API call.
        return (b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt "
                + (16).to_bytes(4, "little") + (1).to_bytes(2, "little")
                + (1).to_bytes(2, "little") + (24000).to_bytes(4, "little")
                + (48000).to_bytes(4, "little") + (2).to_bytes(2, "little")
                + (16).to_bytes(2, "little") + b"data" + (0).to_bytes(4, "little"))


def client_fixture():
    compute = FakeCompute()
    tts = FakeTTS()
    api = modal_app.create_api(
        shared_secret=SECRET,
        compute=compute,
        tts=tts,
        endpointer_factory=FakeEndpointer,
    )
    return TestClient(api), compute, tts


class ModalStreamTests(unittest.TestCase):
    def test_capacity_reserves_four_streams_and_one_tts_input(self):
        capacity = modal_app.InputCapacity()
        self.assertEqual([capacity.try_stream() for _ in range(5)],
                         [True, True, True, True, False])
        self.assertTrue(capacity.try_tts())
        self.assertFalse(capacity.try_tts())
        capacity.release_tts()
        capacity.release_stream()
        self.assertTrue(capacity.try_stream())

    def test_stream_rejects_missing_bad_credentials_and_bad_start(self):
        client, _compute, _tts = client_fixture()
        for headers in ({}, {"authorization": "Bearer wrong"}):
            with self.assertRaises(Exception):
                with client.websocket_connect("/stream", headers=headers):
                    pass

        with client.websocket_connect(
                "/stream", headers={"authorization": f"Bearer {SECRET}"}) as ws:
            ws.send_json({"type": "start", "stream_id": "s", "source_lang": "fr",
                          "target_lang": "en"})
            with self.assertRaises(Exception):
                ws.receive_json()

    def test_public_stream_keeps_finals_and_attributes_language(self):
        client, compute, _tts = client_fixture()
        headers = {"authorization": f"Bearer {SECRET}"}
        with client.websocket_connect("/stream", headers=headers) as ws:
            ws.send_json({"type": "start", "stream_id": "participant-1",
                          "source_lang": "en", "target_lang": "es"})
            for marker in (1000, 2000):
                ws.send_bytes(np.full(1600, marker, dtype=np.int16).tobytes())
                ws.send_json({"type": "speech_end"})
            first = ws.receive_json()
            second = ws.receive_json()

        self.assertEqual([first["seq"], second["seq"]], [1, 2])
        self.assertEqual([first["original"], second["original"]],
                         ["source-1000", "source-2000"])
        self.assertEqual(first["translations"], {"es": "translated-1000"})
        self.assertTrue(first["final"] and second["final"])
        self.assertEqual([call[-1] for call in compute.calls], [True, True])

    def test_stream_caps_frames_and_control_messages(self):
        client, _compute, _tts = client_fixture()
        headers = {"authorization": f"Bearer {SECRET}"}
        with client.websocket_connect("/stream", headers=headers) as ws:
            ws.send_json({"type": "start", "stream_id": "s", "source_lang": "en",
                          "target_lang": "es"})
            ws.send_bytes(b"\0" * 32002)
            with self.assertRaises(Exception):
                ws.receive_json()


class ModalTTSTests(unittest.TestCase):
    def test_tts_auth_caps_and_four_controlled_routes(self):
        client, _compute, tts = client_fixture()
        self.assertEqual(client.post("/tts", json={}).status_code, 401)
        headers = {"authorization": f"Bearer {SECRET}"}
        self.assertEqual(client.post("/tts", headers=headers, content=b"x" * 2049).status_code,
                         413)
        self.assertEqual(client.post("/tts", headers=headers,
                                     json={"text": "x" * 301, "lang": "en",
                                           "voice_style": "female"}).status_code, 422)
        self.assertEqual(client.post("/tts", headers=headers,
                                     json={"text": "hi", "lang": "en",
                                           "voice_style": "match"}).status_code, 422)

        for lang in ("en", "es"):
            for style in ("female", "male"):
                response = client.post("/tts", headers=headers,
                                       json={"text": "hello", "lang": lang,
                                             "voice_style": style})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/wav")
                self.assertTrue(response.content.startswith(b"RIFF"))
        self.assertEqual(tts.calls, [
            ("hello", "en", "female"), ("hello", "en", "male"),
            ("hello", "es", "female"), ("hello", "es", "male"),
        ])

    def test_voice_routes_are_selected_style_not_inferred_biometrics(self):
        self.assertEqual(modal_app.VOICE_ROUTES, {
            ("en", "female"): "af_heart",
            ("en", "male"): "am_michael",
            ("es", "female"): "ef_dora",
            ("es", "male"): "em_alex",
        })
        self.assertEqual(len(modal_app.KOKORO_REVISION), 40)
        self.assertEqual(len(modal_app.WHISPER_REVISION), 40)


if __name__ == "__main__":
    unittest.main(verbosity=2)
