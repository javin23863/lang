"""M2M100 adapter contract tests; no model download or GPU is required."""

from types import SimpleNamespace
import tempfile
import unittest

import asr_whisper
import mt_ct2


class FakeTokenizer:
    def __init__(self):
        self.src_lang = None
        self.encoded = []

    def __call__(self, text, return_tensors=None):
        self.encoded.append((text, return_tensors, self.src_lang))
        return {"input_ids": [10, 11]}

    def convert_ids_to_tokens(self, _ids):
        return ["source", "</s>"]

    def get_lang_token(self, code):
        return f"__{code}__"

    def convert_tokens_to_ids(self, tokens):
        return list(range(len(tokens)))

    def decode(self, ids, skip_special_tokens=True):
        return f"translated-{len(ids)}"


class FakeTranslator:
    def __init__(self, hypotheses=None):
        self.calls = []
        self.hypotheses = hypotheses

    def translate_batch(self, sources, *, target_prefix, beam_size, max_decoding_length):
        self.calls.append({
            "sources": sources, "target_prefix": target_prefix,
            "beam_size": beam_size, "max_decoding_length": max_decoding_length,
        })
        hypotheses = self.hypotheses or [["one", "two"] for _source in sources]
        return [SimpleNamespace(hypotheses=[tokens]) for tokens in hypotheses]


class M2M100CatalogTests(unittest.TestCase):
    def test_one_model_tokenization_fans_out_to_unique_target_languages(self):
        tokenizer = FakeTokenizer()
        translator = FakeTranslator()
        adapter = mt_ct2.M2M100CT2(tokenizer=tokenizer, translator=translator)

        translated, reason = adapter.translate_many(
            "Where is the station?", "en", ["es", "fr", "es", "ja"],
            stream_id="speaker-a", final=True,
        )

        self.assertEqual(reason, "ok")
        self.assertEqual(set(translated), {"es", "fr", "ja"})
        self.assertEqual(len(tokenizer.encoded), 1)
        self.assertEqual(translator.calls[0]["target_prefix"],
                         [["__es__"], ["__fr__"], ["__ja__"]])
        self.assertEqual(len(translator.calls[0]["sources"]), 3)

    def test_same_language_is_a_passthrough_without_model_loading(self):
        adapter = mt_ct2.M2M100CT2()

        translated, reason = adapter.translate_many(
            "No translation needed", "en", ["en"], stream_id="speaker-a", final=True)

        self.assertEqual((translated, reason), ({"en": "No translation needed"},
                                                  "same_language"))
        self.assertFalse(adapter.started)

    def test_output_is_bounded_and_finals_deduplicate_per_stream(self):
        tokenizer = FakeTokenizer()
        translator = FakeTranslator(hypotheses=[["x"] * 500])
        adapter = mt_ct2.M2M100CT2(tokenizer=tokenizer, translator=translator)

        first, reason = adapter.translate_many("Hello", "en", ["es"], "one", True)
        repeated, repeat_reason = adapter.translate_many("Hello", "en", ["es"], "one", True)

        self.assertEqual(reason, "ok")
        self.assertLessEqual(len(first["es"]), mt_ct2.MAX_CAPTION_CHARS)
        self.assertEqual((repeated, repeat_reason), ({}, "duplicate_of_prev"))

    def test_m2m_model_is_revision_pinned_mit_and_catalog_limited(self):
        self.assertEqual(mt_ct2.M2M100_MODEL, "facebook/m2m100_418M")
        self.assertEqual(mt_ct2.M2M100_REVISION,
                         "55c2e61bbf05dfb8d7abccdc3fae6fc8512fd636")
        self.assertEqual(mt_ct2.M2M100_LICENSE, "MIT")
        self.assertEqual(mt_ct2.MAX_TARGET_LANGUAGES, 3)

    def test_local_adapter_never_materializes_the_heavy_model_lane(self):
        """A pre-provisioned local cache may be read, never downloaded/converted."""
        self.assertFalse(mt_ct2.can_materialize_models(False))
        self.assertTrue(mt_ct2.can_materialize_models(True))
        with self.assertRaisesRegex(RuntimeError, "downloads are disabled"):
            asr_whisper.resolve_model_reference("large-v3-turbo", model_path="")
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(asr_whisper.resolve_model_reference(
                "large-v3-turbo", model_path=folder), folder)


if __name__ == "__main__":
    unittest.main(verbosity=2)
