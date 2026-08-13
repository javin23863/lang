import unittest

from latency_acceptance import assert_warm_targets, measurement_schedule


class LatencyAcceptanceTests(unittest.TestCase):
    def test_schedule_uses_only_the_operator_declared_phase(self):
        self.assertEqual(
            measurement_schedule("cold", ("es_to_en",), 2),
            [("cold", "es_to_en", 1), ("cold", "es_to_en", 2)],
        )

    def test_warm_voice_above_three_seconds_fails_both_direction_gate(self):
        records = [
            {"stage": "tts", "phase": "warm", "direction": "en_to_es",
             "seconds": 1.2},
            {"stage": "tts", "phase": "warm", "direction": "es_to_en",
             "seconds": 1.3},
            {"stage": "voice", "phase": "warm", "direction": "en_to_es",
             "seconds": 2.9},
            {"stage": "voice", "phase": "warm", "direction": "es_to_en",
             "seconds": 3.001},
        ]
        with self.assertRaisesRegex(AssertionError, "es_to_en warm voice"):
            assert_warm_targets(records)


if __name__ == "__main__":
    unittest.main(verbosity=2)
