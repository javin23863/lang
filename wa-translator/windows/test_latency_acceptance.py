import unittest

from latency_acceptance import (
    assert_warm_targets,
    measurement_schedule,
    prime_stream_for_preload,
    send_heartbeat,
)
from live_bilingual_check import _voice_latency_records, assert_warm_voice_targets


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


class StreamPreloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_heartbeat_keeps_public_participant_live_during_samples(self):
        class Socket:
            sent = []

            async def send(self, value):
                self.sent.append(value)

        socket = Socket()
        await send_heartbeat(socket)
        self.assertEqual(socket.sent, ['{"type":"heartbeat"}'])

    async def test_preload_probe_sends_one_silent_frame_then_waits(self):
        class Socket:
            sent = []

            async def send(self, value):
                self.sent.append(value)

        waits = []

        async def sleep(seconds):
            waits.append(seconds)

        socket = Socket()
        await prime_stream_for_preload(socket, 7.5, sleep=sleep)
        self.assertEqual(socket.sent, [b"\0" * 3200])
        self.assertEqual(waits, [7.5])


class BrowserVoiceLatencyTests(unittest.TestCase):
    def test_browser_events_produce_same_clock_voice_stages_and_gate(self):
        acceptance = {
            "remoteSpeechEnds": [{"at": 1000}, {"at": 5000}, {"at": 9000}],
            "captions": [
                {"at": 1700, "mine": False},
                {"at": 2000, "mine": True},
                {"at": 5700, "mine": False},
                {"at": 9700, "mine": False},
            ],
            "plays": [
                {"at": 2900, "type": "playing"},
                {"at": 4000, "type": "ended"},
                {"at": 6900, "type": "playing"},
                {"at": 10900, "type": "playing"},
            ],
        }
        records = _voice_latency_records(acceptance, "es")
        self.assertEqual([record["turn"] for record in records], [1, 3, 5])
        self.assertEqual(records[0]["speech_end_to_final_s"], 0.7)
        self.assertEqual(records[0]["final_to_voice_start_s"], 1.2)
        self.assertEqual(records[0]["speech_end_to_voice_start_s"], 1.9)
        assert_warm_voice_targets(records)

        records[-1]["speech_end_to_voice_start_s"] = 3.001
        with self.assertRaisesRegex(AssertionError, "turn 5 warm voice"):
            assert_warm_voice_targets(records)


if __name__ == "__main__":
    unittest.main(verbosity=2)
