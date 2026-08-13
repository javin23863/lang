import contextlib
import base64
import io
import unittest
import wave

import numpy as np

from live_bilingual_check import _assert_caption_semantics, _assert_tts


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

    def test_tts_receipt_uses_the_real_playing_blob_bytes(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(24000)
            wav_file.writeframes(np.full(7200, 500, dtype="<i2").tobytes())
        audio = base64.b64encode(output.getvalue()).decode()

        class Network:
            errors = []
            responses = {
                str(index): {
                    "body": {"text": f"phrase {index}", "lang": "en",
                             "voice_style": "female"},
                    "status": 200,
                    "mime": "audio/wav",
                }
                for index in range(3)
            }

        plays = []
        for _ in range(3):
            plays.append({"type": "playing", "audio_base64": audio})
            plays.append({"type": "ended", "duration": 0.3, "currentTime": 0.3})
        with contextlib.redirect_stdout(io.StringIO()):
            receipts = _assert_tts(Network(), plays, "en")
        self.assertEqual(len(receipts), 3)
        self.assertTrue(all(receipt["audio"].startswith(b"RIFF")
                            for receipt in receipts))


if __name__ == "__main__":
    unittest.main(verbosity=2)
