"""Static deployment-ceiling assertions; live receipts are intentionally separate."""

import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).parent
MODAL = (ROOT / "modal_app.py").read_text(encoding="utf-8")
WORKER = (ROOT / "cloudflare/src/worker.ts").read_text(encoding="utf-8")
WRANGLER = json.loads((ROOT / "cloudflare/wrangler.jsonc").read_text(encoding="utf-8"))
LOCK = (ROOT / "modal-runtime-requirements.txt").read_text(encoding="utf-8")
RECEIPTS = (ROOT / "cloudflare/ACCEPTANCE-RECEIPTS.md").read_text(encoding="utf-8")
MT = (ROOT / "windows/mt_ct2.py").read_text(encoding="utf-8")


class DeploymentConfigTests(unittest.TestCase):
    def test_modal_beta_ceiling_and_persistent_cache_are_explicit(self):
        for literal in ('gpu="L4"', "max_containers=1", "min_containers=0",
                        "scaledown_window=60", "timeout=86_400",
                        "@modal.concurrent(max_inputs=5, target_inputs=5)",
                        'volumes={"/model-cache": modal_volume}'):
            self.assertIn(literal, MODAL)
        self.assertIn('"HOME": "/root"', MODAL)
        self.assertIn('"HF_HOME": "/model-cache/huggingface"', MODAL)
        self.assertIn('"LANG_ROOM_MODEL_ROOT": "/model-cache/lang-room"', MODAL)
        self.assertNotIn('"HOME": "/model-cache/', MODAL)
        for helper in ("asr_whisper.py", "cuda_dlls.py", "endpointer.py", "mt_ct2.py"):
            self.assertIn(f'"/root/windows/{helper}"', MODAL)
        self.assertNotIn('"/root/wa-translator/windows/', MODAL)
        self.assertNotIn('os.chdir("/root/wa-translator")', MODAL)
        self.assertIn('os.environ.get("LANG_ROOM_MODEL_ROOT")', MT)
        self.assertIn('Volume.from_name("spoken-translation-model-cache"', MODAL)
        self.assertIn("KOKORO_REVISION =", MODAL)
        self.assertIn("WHISPER_REVISION =", MODAL)
        self.assertIn("MAX_STREAM_INPUTS = 4", MODAL)
        self.assertIn("MAX_TTS_INPUTS = 1", MODAL)

    def test_compute_websocket_uses_fetch_upgrade_https_not_wss(self):
        docs = (ROOT / "cloudflare/DEPLOYMENT.md").read_text(encoding="utf-8")
        self.assertIn("`https://.../stream`", docs)
        self.assertNotIn("`wss://.../stream`", docs)
        self.assertIn('url.protocol !== "https:"', WORKER)

    def test_one_durable_object_binding_uses_hibernation_attachments_only(self):
        self.assertEqual(WRANGLER["durable_objects"]["bindings"], [
            {"name": "ROOMS", "class_name": "Room"}
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

    def test_deployment_docs_disclose_required_operational_ceiling(self):
        docs = (ROOT / "cloudflare/DEPLOYMENT.md").read_text(encoding="utf-8").lower()
        for phrase in ("cold start", "short utterance", "one l4", "four participants",
                       "four stream slots", "one tts slot",
                       "active outbound modal", "replayable", "24 hours", "cost ceiling",
                       "no database", "workers.dev"):
            self.assertIn(phrase, docs)

    def test_exact_acceptance_values_name_reproducible_commands(self):
        for command in ("probe_kokoro_tts.py", "probe_stream.py", "browser_check.py",
                        "Get-FileHash"):
            self.assertIn(command, RECEIPTS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
