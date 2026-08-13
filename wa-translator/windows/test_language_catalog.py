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
        self.assertFalse(language_catalog.is_joinable_locale("pt-BR"))
        self.assertIsNone(language_catalog.locale_profile("xx-XX"))

    def test_search_exposes_native_english_and_regional_names(self):
        results = language_catalog.search_locales("mexico")
        self.assertEqual([entry["id"] for entry in results], ["es-MX"])
        results = language_catalog.search_locales("Español")
        self.assertIn("es-ES", [entry["id"] for entry in results])


if __name__ == "__main__":
    unittest.main(verbosity=2)
