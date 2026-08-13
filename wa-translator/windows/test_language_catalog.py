"""Public capability-catalog contract tests.

The catalog is the one source of truth for browser, Worker, Modal, and the
local adapter.  These checks deliberately inspect only its public helpers.
"""

import unittest

import language_catalog


class LanguageCatalogTests(unittest.TestCase):
    def test_catalog_has_all_m2m_base_languages_and_release_live_speech_set(self):
        catalog = language_catalog.public_catalog()

        self.assertEqual(catalog["counts"]["base_languages"], 100)
        self.assertEqual(catalog["counts"]["locale_profiles"], len(catalog["locales"]))
        self.assertGreaterEqual(catalog["counts"]["locale_profiles"], 117)
        self.assertEqual(
            set(catalog["release_live_speech_languages"]),
            {"ar", "de", "en", "es", "fr", "ja"},
        )
        self.assertTrue(all(language["mt_code"] for language in catalog["languages"]))

    def test_locales_are_unique_bcp47_profiles_with_explicit_spanish_mapping(self):
        catalog = language_catalog.public_catalog()
        locales = {entry["id"]: entry for entry in catalog["locales"]}
        self.assertEqual(len(locales), len(catalog["locales"]))

        spanish = ("es-ES", "es-MX", "es-US", "es-AR", "es-CO", "es-CL",
                   "es-PE", "es-VE", "es-DO", "es-PR")
        for locale_id in spanish:
            profile = locales[locale_id]
            self.assertEqual(profile["language"], "es")
            self.assertEqual(profile["asr_code"], "es")
            self.assertEqual(profile["mt_code"], "es")
            self.assertIn("same base language", profile["mapping_note"].lower())
            self.assertFalse(profile["dialect_quality_claim"])

    def test_capabilities_and_rtl_fail_closed(self):
        arabic = language_catalog.locale_profile("ar-SA")
        self.assertTrue(arabic["rtl"])
        self.assertTrue(arabic["capabilities"]["asr"]["available"])
        self.assertTrue(arabic["capabilities"]["captions"]["available"])
        self.assertFalse(arabic["capabilities"]["tts"]["available"])
        self.assertTrue(arabic["capabilities"]["tts"]["reason"])

        french = language_catalog.locale_profile("fr-FR")
        self.assertTrue(french["capabilities"]["tts"]["available"])
        self.assertEqual([voice["style"] for voice in french["voice_profiles"]], ["female"])
        japanese = language_catalog.locale_profile("ja-JP")
        self.assertFalse(japanese["capabilities"]["tts"]["available"])
        self.assertIn("documented provider voice", japanese["capabilities"]["tts"]["reason"])
        self.assertEqual(
            (language_catalog.public_catalog()["counts"]["voice_languages"],
             language_catalog.public_catalog()["counts"]["voice_profiles"]),
            (3, 7),
        )
        self.assertFalse(language_catalog.is_joinable_locale("pt-BR"))
        self.assertIsNone(language_catalog.locale_profile("xx-XX"))

    def test_search_exposes_native_english_and_regional_names(self):
        results = language_catalog.search_locales("mexico")
        self.assertEqual([entry["id"] for entry in results], ["es-MX"])
        results = language_catalog.search_locales("Español")
        self.assertIn("es-ES", [entry["id"] for entry in results])

    def test_release_voice_pins_are_verified_content_hashes(self):
        """Pins are SHA-256s of resolve-response bytes, not HF ETags."""
        pins = language_catalog.public_catalog()["models"]["tts"][
            "release_voice_artifact_sha256"]
        self.assertEqual(pins, {
            "en-us-af-heart": "0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff",
            "en-us-am-michael": "9a443b79a4b22489a5b0ab7c651a0bcd1a30bef675c28333f06971abbd47bd37",
            "en-gb-bf-emma": "d0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701",
            "en-gb-bm-fable": "d44935f3135257a9064df99f007fc1342ff1aa767552b4a4fa4c3b2e6e59079c",
            "es-ef-dora": "d9d69b0f8a2b87a345f269d89639f89dfbd1a6c9da0c498ae36dd34afcf35530",
            "es-em-alex": "5eac53f767c3f31a081918ba531969aea850bed18fe56419b804d642c6973431",
            "fr-ff-siwis": "8073bf2d2c4b9543a90f2f0fd2144de4ed157e2d4b79ddeb0d5123066171fbc9",
        })


if __name__ == "__main__":
    unittest.main(verbosity=2)
