import os
import sys
import unittest
from unittest.mock import patch

import verify_multilingual_deployment as verifier


class DeploymentDriftTests(unittest.TestCase):
    def test_detects_catalog_model_and_voice_profile_drift(self):
        worker = {
            "revision": "catalog-a",
            "models": {"mt": {"revision": "mt-a"}},
            "locales": [{"voice_profiles": [{"id": "voice-a"}]}],
        }
        modal = {"revision": "catalog-b", "models": {"mt": {"revision": "mt-b"}}}
        health = {"catalog_revision": "catalog-b", "mt_revision": "mt-b",
                  "voice_profiles": ["voice-b"]}

        errors = verifier.deployment_drift(worker, modal, health)

        self.assertEqual(len(errors), 5)
        self.assertTrue(all("differs" in error for error in errors))

    def test_accepts_exact_shared_catalog_and_profile_set(self):
        catalog = {
            "revision": "catalog-a",
            "models": {"mt": {"revision": "mt-a"}},
            "locales": [
                {"voice_profiles": [{"id": "voice-b"}, {"id": "voice-a"}]},
                {"voice_profiles": [{"id": "voice-a"}]},
            ],
        }
        health = {"catalog_revision": "catalog-a", "mt_revision": "mt-a",
                  "voice_profiles": ["voice-a", "voice-b"]}
        self.assertEqual(verifier.deployment_drift(catalog, catalog, health), [])

    def test_fixed_receipts_are_mandatory_and_fail_on_semantic_miss(self):
        calls = []

        def request(url, *, secret, body):
            calls.append((url, secret, body))
            fixture_id = body["fixture_id"]
            return {
                "fixture_id": fixture_id,
                "target_language": "es",
                "translation": "fixed translation",
                "semantic_token_group_matches": [fixture_id != "en-ar-room-time"],
                "model": {"model": "facebook/m2m100_418M", "revision": "mt-a"},
            }

        fixtures, errors = verifier.verify_fixture_receipts(
            "https://modal.test", "fixture-secret", "mt-a", request=request)

        self.assertEqual(len(calls), len(verifier.FIXTURE_IDS))
        self.assertEqual(len(fixtures), len(verifier.FIXTURE_IDS))
        self.assertIn("fixture en-ar-room-time semantic hints did not match", errors)

    def test_main_passes_the_worker_m2m_revision_to_the_fixed_receipt_gate(self):
        worker = {
            "revision": "catalog-a",
            "models": {"mt": {"revision": "mt-a"}},
            "locales": [{"voice_profiles": [{"id": "voice-a"}]}],
        }
        health = {
            "catalog_revision": "catalog-a",
            "mt_revision": "mt-a",
            "voice_profiles": ["voice-a"],
        }
        with patch.dict(os.environ, {"MODAL_SHARED_SECRET": "test-secret"}), \
             patch.object(sys, "argv", [
                 "verify_multilingual_deployment.py",
                 "--worker-url", "https://worker.test",
                 "--modal-url", "https://modal.test",
             ]), \
             patch.object(verifier, "fetch_json", side_effect=[worker, worker, health]), \
             patch.object(verifier, "verify_fixture_receipts", return_value=([], [])) as receipts:
            self.assertEqual(verifier.main(), 0)

        receipts.assert_called_once_with("https://modal.test", "test-secret", "mt-a")


if __name__ == "__main__":
    unittest.main(verbosity=2)
