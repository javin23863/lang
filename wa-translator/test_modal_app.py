"""Public-interface security and queue tests for the Modal compute adapter."""

import contextlib
import hashlib
import io
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

import modal_app


SECRET = "test-modal-secret"
START_REVISIONS = {
    "catalog_revision": modal_app.CATALOG_REVISION,
    "mt_revision": modal_app.M2M100_REVISION,
}


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

    def transcribe_translate(self, pcm, source_lang, target_langs, stream_id, final):
        marker = int(round(float(pcm.max()) * 32768)) if len(pcm) else 0
        self.calls.append((marker, source_lang, target_langs, stream_id, final))
        return f"source-{marker}", {
            target: f"translated-{target}-{marker}" for target in target_langs
        }


class FailingCompute:
    def transcribe_translate(self, *_args):
        raise modal_app.ModelInitializationError(
            RuntimeError(f"model init failed token={SECRET} " + ("x" * 1_000))
        )


class FakeTTS:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice_profile):
        self.calls.append((text, voice_profile))
        # Minimal non-empty PCM WAV, not just an asserted browser API call.
        return (b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt "
                + (16).to_bytes(4, "little") + (1).to_bytes(2, "little")
                + (1).to_bytes(2, "little") + (24000).to_bytes(4, "little")
                + (48000).to_bytes(4, "little") + (2).to_bytes(2, "little")
                + (16).to_bytes(2, "little") + b"data" + (0).to_bytes(4, "little"))


class FailingTTS:
    def synthesize(self, text, *_args):
        raise RuntimeError(f"failed text={text} token={SECRET}")


class BlockingPreloadTTS(FakeTTS):
    def __init__(self):
        super().__init__()
        self.preload_calls = 0
        self.preload_started = __import__("threading").Event()
        self.preload_release = __import__("threading").Event()
        self.preload_finished = __import__("threading").Event()

    def preload(self):
        self.preload_calls += 1
        self.preload_started.set()
        self.preload_release.wait(timeout=5)
        self.preload_finished.set()


class BlockingPreloadCompute(FakeCompute):
    def __init__(self):
        super().__init__()
        self.preload_calls = 0
        self.preload_started = __import__("threading").Event()
        self.preload_release = __import__("threading").Event()

    def preload(self):
        self.preload_calls += 1
        self.preload_started.set()
        self.preload_release.wait(timeout=5)


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


class ModalComputeTests(unittest.TestCase):
    def test_authenticated_capabilities_are_catalog_backed_and_not_cached(self):
        client, _compute, _tts = client_fixture()
        response = client.get(
            "/capabilities", headers={"authorization": f"Bearer {SECRET}"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["revision"],
                         "2026-08-14-m2m100-55c2e61-free84-tts13")
        self.assertEqual(response.json()["counts"]["base_languages"], 100)
        self.assertEqual(response.json()["counts"]["model_speech_languages"], 84)
        self.assertEqual(response.json()["counts"]["joinable_locale_profiles"], 106)

    def test_javanese_uses_whisper_jw_and_m2m_jv_codes(self):
        calls = []

        class ASR:
            def transcribe(self, _pcm, language, partial):
                calls.append(("asr", language, partial))
                return "teks"

        mt_ct2 = types.ModuleType("mt_ct2")
        mt_ct2.translate_many = lambda text, source, targets, **kwargs: (
            calls.append(("mt", text, source, targets, kwargs)) or ({"en": "text"}, ""))
        runtime = modal_app.ModelRuntime()
        runtime._asr = ASR()
        with mock.patch.dict(sys.modules, {"mt_ct2": mt_ct2}):
            original, translations = runtime.transcribe_translate(
                np.ones(1600, np.float32), "jv", ["en"], "stream", True)

        self.assertEqual(original, "teks")
        self.assertEqual(translations, {"en": "text"})
        self.assertEqual(calls[0], ("asr", "jw", False))
        self.assertEqual(calls[1][2:4], ("jv", ["en"]))

    def test_fixed_mt_receipt_endpoint_rejects_arbitrary_input_and_reports_pin(self):
        client, _compute, _tts = client_fixture()
        headers = {"authorization": f"Bearer {SECRET}"}
        self.assertEqual(client.post("/mt-receipt", json={}).status_code, 401)
        self.assertEqual(client.post("/mt-receipt", headers=headers,
                                     json={"text": "arbitrary text"}).status_code, 422)
        expected = {
            "fixture_id": "en-es-meeting-time", "source_language": "en",
            "target_language": "es", "translation": "La reunión empieza mañana a las nueve.",
            "semantic_token_group_matches": [True, True, True],
            "model": {"model": "facebook/m2m100_418M", "ready": True},
        }
        with mock.patch.object(modal_app, "_translate_receipt_fixture", return_value=expected):
            response = client.post("/mt-receipt", headers=headers,
                                   json={"fixture_id": "en-es-meeting-time"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), expected)

    def test_compute_preload_initializes_shared_vad_import_first(self):
        events = []
        endpointer = types.ModuleType("endpointer")
        endpointer.prime_vad_import = lambda: events.append("vad_import")
        faster_whisper = types.ModuleType("faster_whisper")
        faster_whisper.__path__ = []
        faster_whisper_utils = types.ModuleType("faster_whisper.utils")
        faster_whisper_utils.download_model = (
            lambda *_args, **_kwargs: events.append("download"))
        asr_whisper = types.ModuleType("asr_whisper")

        class FakeASR:
            def __init__(self, **_kwargs):
                events.append("asr")

        asr_whisper.WhisperASR = FakeASR
        mt_ct2 = types.ModuleType("mt_ct2")
        mt_ct2.preload = lambda: events.append("mt")

        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(modal_app, "MODEL_ROOT", pathlib.Path(folder)), \
                mock.patch.dict(sys.modules, {
                    "endpointer": endpointer,
                    "faster_whisper": faster_whisper,
                    "faster_whisper.utils": faster_whisper_utils,
                    "asr_whisper": asr_whisper,
                    "mt_ct2": mt_ct2,
                }):
            modal_app.ModelRuntime()._ensure_loaded()

        self.assertEqual(events, ["vad_import", "download", "asr", "mt"])


class ModalStreamTests(unittest.TestCase):
    def test_valid_stream_starts_one_nonblocking_sequential_model_preload(self):
        compute = BlockingPreloadCompute()
        tts = BlockingPreloadTTS()
        api = modal_app.create_api(
            shared_secret=SECRET,
            compute=compute,
            tts=tts,
            endpointer_factory=FakeEndpointer,
        )
        headers = {"authorization": f"Bearer {SECRET}"}
        client = TestClient(api)
        try:
            for stream_id in ("participant-1", "participant-2"):
                with client.websocket_connect("/stream", headers=headers) as ws:
                    ws.send_json({
                        "type": "start", "stream_id": stream_id,
                        "source_lang": "en", "source_locale": "en-US",
                        "target_langs": ["es"],
                        **START_REVISIONS,
                    })
                    self.assertTrue(compute.preload_started.wait(timeout=1))
                    if stream_id == "participant-1":
                        self.assertFalse(tts.preload_started.wait(timeout=0.05))
                        compute.preload_release.set()
                    self.assertTrue(tts.preload_started.wait(timeout=1))
                    ws.send_bytes(np.full(1600, 1000, dtype=np.int16).tobytes())
                    ws.send_json({"type": "speech_end"})
                    self.assertTrue(ws.receive_json()["final"])
                    if stream_id == "participant-1":
                        # Finish the daemon seam before TestClient tears down
                        # its event-loop portal; Starlette otherwise races the
                        # completed assertions with a cancelled cleanup future.
                        tts.preload_release.set()
                        self.assertTrue(tts.preload_finished.wait(timeout=1))
            self.assertEqual(compute.preload_calls, 1)
            self.assertEqual(tts.preload_calls, 1)
        finally:
            compute.preload_release.set()
            tts.preload_release.set()

    def test_capacity_reserves_four_streams_and_one_tts_input(self):
        capacity = modal_app.InputCapacity()
        self.assertEqual([capacity.try_stream() for _ in range(5)],
                         [True, True, True, True, False])
        self.assertTrue(capacity.try_tts())
        self.assertFalse(capacity.try_tts())
        capacity.release_tts()
        capacity.release_stream()
        self.assertTrue(capacity.try_stream())

    def test_global_stream_capacity_reports_status_before_closing(self):
        capacity = modal_app.InputCapacity()
        self.assertEqual([capacity.try_stream() for _ in range(4)], [True] * 4)
        api = modal_app.create_api(
            shared_secret=SECRET,
            compute=FakeCompute(),
            tts=FakeTTS(),
            endpointer_factory=FakeEndpointer,
            capacity=capacity,
        )
        with TestClient(api).websocket_connect(
                "/stream", headers={"authorization": f"Bearer {SECRET}"}) as ws:
            self.assertEqual(ws.receive_json(), {
                "type": "stream_status", "status": "capacity",
                "scope": "global", "retry_after_ms": modal_app.COMPUTE_CAPACITY_RETRY_MS,
            })
            with self.assertRaises(Exception):
                ws.receive_json()

    def test_stream_rejects_missing_bad_credentials_and_bad_start(self):
        client, _compute, _tts = client_fixture()
        for headers in ({}, {"authorization": "Bearer wrong"}):
            with self.assertRaises(Exception):
                with client.websocket_connect("/stream", headers=headers):
                    pass

        with client.websocket_connect(
                "/stream", headers={"authorization": f"Bearer {SECRET}"}) as ws:
            ws.send_json({"type": "start", "stream_id": "s", "source_lang": "fr",
                          "source_locale": "en-US", "target_langs": ["en"],
                          **START_REVISIONS})
            with self.assertRaises(Exception):
                ws.receive_json()

        with client.websocket_connect(
                "/stream", headers={"authorization": f"Bearer {SECRET}"}) as ws:
            ws.send_json({"type": "start", "stream_id": "preview",
                          "source_lang": "pt", "source_locale": "pt-BR",
                          "target_langs": ["en"], **START_REVISIONS})
            ws.send_bytes(np.full(1600, 1000, dtype=np.int16).tobytes())
            ws.send_json({"type": "speech_end"})
            self.assertTrue(ws.receive_json()["final"])

    def test_public_stream_keeps_finals_and_attributes_language(self):
        compute = FakeCompute()
        tts = FakeTTS()
        api = modal_app.create_api(
            shared_secret=SECRET, compute=compute, tts=tts,
            endpointer_factory=FakeEndpointer,
        )
        headers = {"authorization": f"Bearer {SECRET}"}
        # Starlette's current WebSocket test transport cancels a standalone
        # portal during close. Keep the ASGI lifespan open for the complete
        # multi-caption exchange so this verifies stream ordering, not a test
        # harness teardown race.
        with TestClient(api) as client:
            with client.websocket_connect("/stream", headers=headers) as ws:
                ws.send_json({"type": "start", "stream_id": "participant-1",
                              "source_lang": "en", "source_locale": "en-US",
                              "target_langs": ["es", "fr"], **START_REVISIONS})
                for marker in (1000, 2000):
                    ws.send_bytes(np.full(1600, marker, dtype=np.int16).tobytes())
                    ws.send_json({"type": "speech_end"})
                first = ws.receive_json()
                second = ws.receive_json()

        self.assertEqual([first["seq"], second["seq"]], [1, 2])
        self.assertEqual([first["original"], second["original"]],
                         ["source-1000", "source-2000"])
        self.assertEqual(first["translations"], {
            "es": "translated-es-1000", "fr": "translated-fr-1000"})
        self.assertTrue(first["final"] and second["final"])
        self.assertEqual([call[-1] for call in compute.calls], [True, True])

    def test_stream_caps_frames_and_control_messages(self):
        client, _compute, _tts = client_fixture()
        headers = {"authorization": f"Bearer {SECRET}"}
        with client.websocket_connect("/stream", headers=headers) as ws:
            ws.send_json({"type": "start", "stream_id": "s", "source_lang": "en",
                          "source_locale": "en-US", "target_langs": ["es"],
                          **START_REVISIONS})
            ws.send_bytes(b"\0" * 32002)
            with self.assertRaises(Exception):
                ws.receive_json()

    def test_stream_compute_failure_is_logged_without_audio_or_credentials(self):
        api = modal_app.create_api(
            shared_secret=SECRET,
            compute=FailingCompute(),
            tts=FakeTTS(),
            endpointer_factory=FakeEndpointer,
        )
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            with TestClient(api).websocket_connect(
                    "/stream", headers={"authorization": f"Bearer {SECRET}"}) as ws:
                ws.send_json({"type": "start", "stream_id": "s",
                              "source_lang": "en", "source_locale": "en-US",
                              "target_langs": ["es"], **START_REVISIONS})
                ws.send_bytes(np.full(1600, 1000, dtype=np.int16).tobytes())
                ws.send_json({"type": "speech_end"})
                with self.assertRaises(Exception):
                    ws.receive_json()
        logged = output.getvalue()
        self.assertIn("RuntimeError: model init failed", logged)
        self.assertNotIn(SECRET, logged)
        self.assertLessEqual(len(logged), 300)


class ModalTTSTests(unittest.TestCase):
    def test_preload_uses_representative_fixed_bilingual_phrases(self):
        calls = []
        tts = modal_app.KokoroTTS()
        tts.synthesize = lambda text, voice_profile: calls.append((text, voice_profile))

        tts.preload()

        self.assertEqual([voice_profile for _text, voice_profile in calls], [
            "en-us-af-heart", "en-gb-bf-emma", "es-ef-dora", "fr-ff-siwis",
        ])
        self.assertTrue(all(8 <= len(text) <= 50 for text, _voice_profile in calls))

    def test_tts_failure_logs_bounded_diagnostic_without_text_or_credentials(self):
        api = modal_app.create_api(
            shared_secret=SECRET, compute=FakeCompute(), tts=FailingTTS(),
            endpointer_factory=FakeEndpointer,
        )
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            response = TestClient(api).post(
                "/tts", headers={"authorization": f"Bearer {SECRET}"},
                json={"text": "private fixture", "voice_profile": "en-us-af-heart"},
            )
        self.assertEqual(response.status_code, 503)
        logged = output.getvalue()
        self.assertIn("RuntimeError", logged)
        self.assertNotIn(SECRET, logged)
        self.assertNotIn("private fixture", logged)

    def test_synthesis_places_supplied_model_on_available_cuda_and_eval(self):
        models = []

        class FakeModel:
            def __init__(self, **_kwargs):
                self.device = "cpu"
                self.training = True
                models.append(self)

            def to(self, device):
                self.device = device
                return self

            def eval(self):
                self.training = False
                return self

            def parameters(self):
                return iter((types.SimpleNamespace(
                    device=types.SimpleNamespace(type=self.device)),
                ))

        pipeline_languages = []

        class FakePipeline:
            def __init__(self, **kwargs):
                pipeline_languages.append(kwargs["lang_code"])

            def __call__(self, _text, *, voice):
                self.voice = voice
                return [types.SimpleNamespace(audio=np.ones(24, dtype=np.float32))]

        model_bytes = b"test-kokoro-model"
        hub = types.ModuleType("huggingface_hub")
        hub.snapshot_download = lambda *_args, **_kwargs: None
        kokoro = types.ModuleType("kokoro")
        kokoro.KModel = FakeModel
        kokoro.KPipeline = FakePipeline
        torch = types.ModuleType("torch")
        torch.cuda = types.SimpleNamespace(is_available=lambda: True)

        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            snapshot = root / "kokoro" / modal_app.KOKORO_REVISION
            (snapshot / "voices").mkdir(parents=True)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")
            (snapshot / "kokoro-v1_0.pth").write_bytes(model_bytes)
            for route in modal_app.VOICE_ROUTES.values():
                (snapshot / "voices" / f"{route['model_voice']}.pt").write_bytes(b"voice")
            with mock.patch.object(modal_app, "MODEL_ROOT", root), \
                    mock.patch.object(
                        modal_app, "KOKORO_MODEL_SHA256",
                        hashlib.sha256(model_bytes).hexdigest(),
                    ), mock.patch.object(
                        modal_app, "VOICE_ARTIFACT_SHA256",
                        {profile_id: hashlib.sha256(b"voice").hexdigest()
                         for profile_id in modal_app.VOICE_ROUTES},
                    ), mock.patch.dict(sys.modules, {
                        "huggingface_hub": hub, "kokoro": kokoro, "torch": torch,
                    }):
                engine = modal_app.KokoroTTS()
                audio = engine.synthesize("hello", "en-us-af-heart")
                for profile in ("hi-hf-alpha", "it-if-sara", "pt-br-pf-dora"):
                    self.assertTrue(engine.synthesize("hello", profile).startswith(b"RIFF"))

        self.assertTrue(audio.startswith(b"RIFF"))
        self.assertEqual(models[0].device, "cuda")
        self.assertFalse(models[0].training)
        self.assertEqual(pipeline_languages, ["a", "h", "i", "p"])

    def test_tts_auth_caps_and_declared_release_voice_profiles(self):
        client, _compute, tts = client_fixture()
        self.assertEqual(client.post("/tts", json={}).status_code, 401)
        headers = {"authorization": f"Bearer {SECRET}"}
        self.assertEqual(client.post("/tts", headers=headers, content=b"x" * 2049).status_code,
                         413)
        self.assertEqual(client.post("/tts", headers=headers,
                                     json={"text": "x" * 301,
                                           "voice_profile": "en-us-af-heart"}).status_code, 422)
        self.assertEqual(client.post("/tts", headers=headers,
                                     json={"text": "hi", "voice_profile": "ja-jf-alpha"}).status_code, 422)

        profiles = [
            "en-us-af-heart", "en-us-am-michael", "en-gb-bf-emma", "en-gb-bm-fable",
            "es-ef-dora", "es-em-alex", "fr-ff-siwis",
            "hi-hf-alpha", "hi-hm-omega", "it-if-sara", "it-im-nicola",
            "pt-br-pf-dora", "pt-br-pm-alex",
        ]
        for voice_profile in profiles:
            response = client.post("/tts", headers=headers,
                                   json={"text": "hello", "voice_profile": voice_profile})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"], "audio/wav")
            self.assertTrue(response.content.startswith(b"RIFF"))
        self.assertEqual(tts.calls, [
            ("hello", voice_profile) for voice_profile in profiles
        ])

    def test_voice_routes_are_selected_style_not_inferred_biometrics(self):
        self.assertEqual(modal_app.VOICE_ROUTES, {
            "en-us-af-heart": {"pipeline": "a", "model_voice": "af_heart"},
            "en-us-am-michael": {"pipeline": "a", "model_voice": "am_michael"},
            "en-gb-bf-emma": {"pipeline": "b", "model_voice": "bf_emma"},
            "en-gb-bm-fable": {"pipeline": "b", "model_voice": "bm_fable"},
            "es-ef-dora": {"pipeline": "e", "model_voice": "ef_dora"},
            "es-em-alex": {"pipeline": "e", "model_voice": "em_alex"},
            "fr-ff-siwis": {"pipeline": "f", "model_voice": "ff_siwis"},
            "hi-hf-alpha": {"pipeline": "h", "model_voice": "hf_alpha"},
            "hi-hm-omega": {"pipeline": "h", "model_voice": "hm_omega"},
            "it-if-sara": {"pipeline": "i", "model_voice": "if_sara"},
            "it-im-nicola": {"pipeline": "i", "model_voice": "im_nicola"},
            "pt-br-pf-dora": {"pipeline": "p", "model_voice": "pf_dora"},
            "pt-br-pm-alex": {"pipeline": "p", "model_voice": "pm_alex"},
        })
        self.assertEqual(modal_app.language_catalog.voice_profile(
            "fr-ff-siwis")["style"], "female")
        self.assertEqual(len(modal_app.KOKORO_REVISION), 40)
        self.assertEqual(len(modal_app.WHISPER_REVISION), 40)


if __name__ == "__main__":
    unittest.main(verbosity=2)
