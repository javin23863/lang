import unittest

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
