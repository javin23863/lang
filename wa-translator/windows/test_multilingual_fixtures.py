"""Contract checks for the small, original multilingual model-receipt corpus."""

import json
import pathlib
import unittest

import language_catalog


FIXTURES = json.loads((pathlib.Path(__file__).parents[1] / "multilingual_fixtures.json")
                      .read_text(encoding="utf-8"))


class MultilingualFixtureTests(unittest.TestCase):
    def test_required_release_pairs_and_semantic_hints_are_present(self):
        pairs = {(item["source_language"], item["target_language"])
                 for item in FIXTURES["fixtures"]}
        self.assertTrue({
            ("en", "es"), ("es", "en"), ("en", "fr"), ("en", "de"),
            ("en", "ja"), ("en", "ar"), ("es", "fr"),
        }.issubset(pairs))
        for item in FIXTURES["fixtures"]:
            self.assertLessEqual(len(item["source_text"]), 300)
            self.assertTrue(item["semantic_token_groups"])
            self.assertTrue(all(all(token for token in group)
                                for group in item["semantic_token_groups"]))

    def test_spanish_locale_fixture_maps_to_one_base_model_without_quality_claim(self):
        mapping = FIXTURES["locale_mapping_fixture"]
        source = language_catalog.locale_profile(mapping["source_locale"])
        target = language_catalog.locale_profile(mapping["target_locale"])
        self.assertEqual(source["language"], mapping["source_base_language"])
        self.assertEqual(target["language"], mapping["target_base_language"])
        self.assertFalse(mapping["expect_distinct_mt_model"])
        self.assertFalse(mapping["expect_locale_quality_claim"])
        self.assertFalse(source["dialect_quality_claim"])
        self.assertFalse(target["dialect_quality_claim"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
