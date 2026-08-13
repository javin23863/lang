import contextlib
import io
import unittest

from live_bilingual_check import _assert_caption_semantics


ORIGINALS = (
    "Hello Maria today", "Hola David gracias", "train station Madrid",
    "estacion tren hotel", "help reservation tomorrow",
    "reserva confirmada manana",
)
TRANSLATIONS = (
    "Hola Maria hoy", "Hello David thank you", "tren estacion Madrid",
    "train station hotel", "ayuda reserva manana",
    "reservation confirmed tomorrow",
)
LANGS = ("en", "es", "en", "es", "en", "es")


def captions_for(device_lang):
    captions = []
    for original, translation, speaker_lang in zip(
            ORIGINALS, TRANSLATIONS, LANGS):
        mine = speaker_lang == device_lang
        captions.append({
            "mine": mine,
            "lead": original if mine else translation,
            "sub": "" if mine else original,
        })
    return captions


class LiveBilingualReceiptTests(unittest.TestCase):
    def test_semantics_are_checked_on_the_incoming_listener(self):
        with contextlib.redirect_stdout(io.StringIO()):
            _assert_caption_semantics(captions_for("en"), "en")
            _assert_caption_semantics(captions_for("es"), "es")

    def test_outbound_translation_on_the_speakers_device_is_rejected(self):
        captions = captions_for("en")
        captions[0]["sub"] = "Hola Maria hoy"
        with self.assertRaisesRegex(AssertionError, "outbound translation"):
            _assert_caption_semantics(captions, "en")


if __name__ == "__main__":
    unittest.main(verbosity=2)
