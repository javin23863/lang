"""Cheap contract guard for the one shared local/cloud phone client.

The real browser lifecycle remains in browser_check.py.  These assertions make
the security/default-mode surface fail before a browser is even launched.
"""

import pathlib
import unittest


HTML = pathlib.Path(__file__).with_name("static").joinpath("room.html").read_text(
    encoding="utf-8")


class CloudClientContractTests(unittest.TestCase):
    def test_captions_only_and_controlled_voice_controls_are_literal_defaults(self):
        self.assertIn("let voiceOn = false", HTML)
        self.assertIn('id="listenVoiceSel"', HTML)
        self.assertIn('<option value="match">Match speaker</option>', HTML)
        self.assertIn('id="publishVoiceSel"', HTML)
        self.assertIn("voice_style: myVoiceStyle", HTML)

    def test_turn_and_tts_keep_bearer_in_headers(self):
        self.assertIn("fetch('/api/turn'", HTML)
        self.assertIn("'Authorization': 'Bearer ' + roomId", HTML)
        self.assertIn("voice_style: item.voiceStyle", HTML)
        self.assertNotIn("turn?token=", HTML)
        self.assertIn("'X-Participant-ID': myId", HTML)

    def test_turn_credentials_refresh_and_restart_existing_ice(self):
        self.assertIn("turnRefreshTimer", HTML)
        self.assertIn("pc.setConfiguration({iceServers})", HTML)
        self.assertIn("pc.restartIce()", HTML)
        self.assertIn("iceExpiresAt - Date.now() - 60000", HTML)

    def test_reconnect_preflights_expiry_and_stops_on_terminal_denial(self):
        self.assertIn("async function preflightRoom", HTML)
        self.assertIn("if (!await preflightRoom()) return", HTML)
        self.assertIn("terminalRoom = true", HTML)
        self.assertIn("response.status === 401", HTML)

    def test_mic_stop_and_asr_pause_flush_only_the_utterance_being_captured(self):
        self.assertIn("function sendSpeechEnd", HTML)
        mic_start = HTML.index("function setMicEnabled")
        mic_end = HTML.index("\n}", mic_start)
        self.assertIn("sendSpeechEnd()", HTML[mic_start:mic_end])
        pause_start = HTML.index("function setAsrPaused")
        pause_end = HTML.index("\n}", pause_start)
        pause_body = HTML[pause_start:pause_end]
        self.assertIn("if (p && !asrPaused)", pause_body)
        self.assertEqual(pause_body.count("sendSpeechEnd()"), 1)

    def test_voice_failure_path_restores_natural_audio(self):
        self.assertIn("function failVoice", HTML)
        self.assertIn("setNaturalAudioMuted(false)", HTML)
        self.assertIn("$('remoteVideo').muted = muted", HTML)

    def test_asr_guard_does_not_disable_webrtc_microphone_track(self):
        start = HTML.index("function setAsrPaused")
        end = HTML.index("\n}", start)
        self.assertNotIn("getAudioTracks", HTML[start:end])
        self.assertIn("workletNode.port.postMessage", HTML[start:end])


if __name__ == "__main__":
    unittest.main(verbosity=2)
