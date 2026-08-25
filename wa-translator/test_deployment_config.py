"""Static deployment-shape assertions; live receipts are intentionally separate."""

import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).parent
MODAL = (ROOT / "modal_app.py").read_text(encoding="utf-8")
WORKER = (ROOT / "cloudflare/src/worker.ts").read_text(encoding="utf-8")
WRANGLER = json.loads((ROOT / "cloudflare/wrangler.jsonc").read_text(encoding="utf-8"))
LOCK = (ROOT / "modal-runtime-requirements.txt").read_text(encoding="utf-8")
RUNTIME_INPUT = (ROOT / "modal-runtime-requirements.in").read_text(encoding="utf-8")
RECEIPTS = (ROOT / "cloudflare/ACCEPTANCE-RECEIPTS.md").read_text(encoding="utf-8")
MT = (ROOT / "windows/mt_ct2.py").read_text(encoding="utf-8")
VERIFIER = (ROOT / "verify_multilingual_deployment.py").read_text(encoding="utf-8")


class DeploymentConfigTests(unittest.TestCase):
    def test_modal_capacity_defaults_are_safe_and_production_scale_is_configurable(self):
        # The Modal CLI resolves a conventional ``app`` export for file deploys.
        # Keep the descriptive internal name while exposing that stable entrypoint.
        self.assertIn("app = modal_application", MODAL)
        for literal in (
            'gpu="L4"',
            "max_containers=MODAL_MAX_CONTAINERS",
            "min_containers=MODAL_MIN_CONTAINERS",
            "scaledown_window=MODAL_SCALEDOWN_WINDOW_S",
            "timeout=86_400",
            "@modal.concurrent(max_inputs=MODAL_MAX_INPUTS, target_inputs=MODAL_TARGET_INPUTS)",
            'volumes={"/model-cache": modal_volume}',
        ):
            self.assertIn(literal, MODAL)
        # Development keeps the old cost envelope by default, but changing
        # production capacity no longer requires editing application source.
        for setting in (
            "LINGUA_MODAL_STREAM_INPUTS",
            "LINGUA_MODAL_TTS_INPUTS",
            "LINGUA_MODAL_MAX_CONTAINERS",
            "LINGUA_MODAL_MIN_CONTAINERS",
            "LINGUA_MODAL_SCALEDOWN_WINDOW_S",
            "LINGUA_MODAL_ROUTING_REGION",
        ):
            self.assertIn(setting, MODAL)
        self.assertIn('"LINGUA_MODAL_STREAM_INPUTS": str(MAX_STREAM_INPUTS)', MODAL)
        self.assertIn('"LINGUA_MODAL_TTS_INPUTS": str(MAX_TTS_INPUTS)', MODAL)
        self.assertIn("MODAL_MAX_INPUTS = MAX_STREAM_INPUTS + MAX_TTS_INPUTS", MODAL)
        self.assertIn("MODAL_TARGET_INPUTS = MAX_STREAM_INPUTS", MODAL)
        self.assertNotIn("max_containers=1", MODAL)
        self.assertNotIn("@modal.concurrent(max_inputs=5, target_inputs=5)", MODAL)

        self.assertIn('"HOME": "/root"', MODAL)
        self.assertIn('"HF_HOME": "/model-cache/huggingface"', MODAL)
        self.assertIn('"LANG_ROOM_MODEL_ROOT": "/model-cache/lang-room"', MODAL)
        self.assertIn('"MODAL_IS_REMOTE": "1"', MODAL)
        self.assertNotIn('"HOME": "/model-cache/', MODAL)
        for helper in ("asr_whisper.py", "cuda_dlls.py", "endpointer.py", "mt_ct2.py",
                       "language_catalog.py"):
            self.assertIn(f'"/root/windows/{helper}"', MODAL)
        self.assertIn('"/root/capabilities.json"', MODAL)
        self.assertIn('"/root/multilingual_fixtures.json"', MODAL)
        self.assertIn('Path("/root/windows/language_catalog.py")', MODAL)
        self.assertIn('WINDOWS_DIR =', MODAL)
        self.assertNotIn('"/root/wa-translator/windows/', MODAL)
        self.assertNotIn('os.chdir("/root/wa-translator")', MODAL)
        self.assertIn('os.environ.get("LANG_ROOM_MODEL_ROOT")', MT)
        self.assertIn('Volume.from_name("spoken-translation-model-cache"', MODAL)
        self.assertIn("KOKORO_REVISION =", MODAL)
        self.assertIn("WHISPER_REVISION =", MODAL)
        self.assertIn('MAX_STREAM_INPUTS = _bounded_int_setting("LINGUA_MODAL_STREAM_INPUTS", 4, 2, 16)', MODAL)
        self.assertIn('MAX_TTS_INPUTS = _bounded_int_setting("LINGUA_MODAL_TTS_INPUTS", 1, 1, 4)', MODAL)
        self.assertIn("M2M100_REVISION", MODAL)
        self.assertIn("VOICE_ROUTES = _live_voice_routes()", MODAL)
        self.assertIn("VOICE_ARTIFACT_SHA256", MODAL)
        self.assertIn('"/mt-receipt"', MODAL)

    def test_single_public_gpu_function_uses_configured_routing(self):
        self.assertIn("routing_region=MODAL_ROUTING_REGION", MODAL)
        self.assertIn('_routing_region_setting("LINGUA_MODAL_ROUTING_REGION", "ap-south")', MODAL)
        # Preserve the established function name/URL while routing becomes an
        # operator setting. Renaming the Function would unnecessarily rotate the
        # endpoint configured in Cloudflare.
        self.assertIn("def web_ap_south() -> FastAPI:", MODAL)
        self.assertNotIn("def web() -> FastAPI:", MODAL)
        self.assertEqual(MODAL.count("@modal_application.function("), 1)
        self.assertEqual(MODAL.count('gpu="L4"'), 1)
        self.assertNotIn('routing_region="ap-south"', MODAL)
        self.assertNotIn('region="ap"', MODAL)
        self.assertNotIn('region="ap-southeast"', MODAL)

    def test_modal_pins_cuda12_runtime_for_ctranslate2(self):
        source = (ROOT / "modal-runtime-requirements.in").read_text(encoding="utf-8")
        notices = (ROOT / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")
        for artifact in (
            "nvidia-cublas-cu12==12.9.2.10",
            "nvidia-cudnn-cu12==9.20.0.48",
        ):
            self.assertIn(artifact, source)
            self.assertIn(artifact, LOCK)
            self.assertIn(artifact, notices)
        self.assertIn('"LD_LIBRARY_PATH": "/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib"', MODAL)
        self.assertIn("ctypes.CDLL('libcublas.so.12')", MODAL)
        self.assertIn("ctypes.CDLL('libcudnn.so.9')", MODAL)

    def test_compute_websocket_uses_fetch_upgrade_https_not_wss(self):
        docs = (ROOT / "cloudflare/DEPLOYMENT.md").read_text(encoding="utf-8")
        self.assertIn("`https://.../stream`", docs)
        self.assertNotIn("`wss://.../stream`", docs)
        self.assertIn('url.protocol !== "https:"', WORKER)

    def test_durable_objects_are_limited_to_rooms_abuse_reports_and_accounts(self):
        self.assertEqual(WRANGLER["durable_objects"]["bindings"], [
            {"name": "ROOMS", "class_name": "Room"},
            {"name": "ABUSE", "class_name": "AbuseGate"},
            {"name": "REPORTS", "class_name": "ReportInbox"},
            {"name": "USERS", "class_name": "UserDirectory"},
        ])
        self.assertIn("this.ctx.acceptWebSocket", WORKER)
        self.assertIn("serializeAttachment", WORKER)
        self.assertIn('storage.put("expiresAt"', WORKER)
        self.assertIn('storage.setAlarm', WORKER)
        self.assertIn('storage.deleteAll', WORKER)
        self.assertNotIn('storage.put("caption', WORKER)
        self.assertNotIn('storage.put("media', WORKER)
        for forbidden in ("d1_databases", "kv_namespaces", "r2_buckets", "routes"):
            self.assertNotIn(forbidden, WRANGLER)

    def test_runtime_lock_contains_audited_kokoro_modal_and_g2p_artifacts(self):
        for artifact in (
            "kokoro==0.9.4",
            "a129dc6364a286bd6a92c396e9862459d3d3e45f2c15596ed5a94dcee5789efd",
            "modal==1.5.4",
            "3e54e26037c445af42f9a9ef9862b66bdd2e0b1faeced5fcc7adf3e5f59e44ed",
            "en_core_web_sm-3.8.0",
            "1932429db727d4bff3deed6b34cfc05df17794f4a52eeb26cf8928f7c1a0fb85",
        ):
            self.assertIn(artifact, LOCK)

    def test_unpinned_japanese_dictionary_cannot_be_advertised_or_bundled(self):
        # Kokoro 0.9.4's Japanese route needs a separately downloaded MeCab
        # dictionary. Until that artifact and license are reviewed and pinned,
        # Japanese is captions-only and the image must not imply it is enabled.
        self.assertNotIn("misaki[ja]", RUNTIME_INPUT)
        for artifact in ("fugashi==", "jaconv==", "mojimoji==", "pyopenjtalk==", "unidic=="):
            self.assertNotIn(artifact, LOCK)

    def test_deployment_docs_disclose_capacity_and_operational_limits(self):
        docs = (ROOT / "cloudflare/DEPLOYMENT.md").read_text(encoding="utf-8").lower()
        for phrase in (
            "cold start", "short utterance", "two participants", "stream slots",
            "tts/translate", "active outbound modal", "replayable", "24 hours",
            "cost ceiling", "bounded durable object inbox", "workers.dev",
            "lingua_modal_max_containers", "lingua_modal_routing_region",
        ):
            self.assertIn(phrase, docs)
        self.assertIn("capacity", docs)
        self.assertIn("caption_status", WORKER)
        self.assertIn("COMPUTE_CAPACITY_RETRY_MS", MODAL)

    def test_exact_acceptance_values_name_reproducible_commands(self):
        for command in ("probe_kokoro_tts.py", "probe_stream.py", "browser_check.py",
                        "Get-FileHash"):
            self.assertIn(command, RECEIPTS)

    def test_post_deploy_verifier_detects_worker_modal_catalog_drift(self):
        self.assertIn("deployment_drift", VERIFIER)
        self.assertIn("/api/capabilities", VERIFIER)
        self.assertIn("mt-receipt", VERIFIER)
        self.assertIn("verify_fixture_receipts", VERIFIER)
        self.assertNotIn("--run-fixtures", VERIFIER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
