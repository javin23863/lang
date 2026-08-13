"""Cheap contract guard for the one shared local/cloud phone client.

The real browser lifecycle remains in browser_check.py.  These assertions make
the security/default-mode surface fail before a browser is even launched.
"""

import pathlib
import unittest


HTML = pathlib.Path(__file__).with_name("static").joinpath("room.html").read_text(
    encoding="utf-8")
LIVE_CHECK_PATH = pathlib.Path(__file__).with_name("live_bilingual_check.py")


class CloudClientContractTests(unittest.TestCase):
    def test_captions_only_and_controlled_voice_controls_are_literal_defaults(self):
        self.assertIn("let voiceOn = false", HTML)
        self.assertIn('id="publishVoiceSel"', HTML)
        self.assertIn("voice_profile: myVoiceProfileId", HTML)
        self.assertIn("Voice unavailable — captions only", HTML)

    def test_turn_and_tts_keep_bearer_in_headers(self):
        self.assertIn("fetch('/api/turn'", HTML)
        self.assertIn("'Authorization': 'Bearer ' + roomId", HTML)
        self.assertIn("voice_profile: item.voiceProfileId", HTML)
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

    def test_natural_audio_stays_live_until_translated_playback_actually_starts(self):
        toggle_start = HTML.index("$('voiceBtn').onclick")
        toggle_end = HTML.index("\n};", toggle_start)
        self.assertNotIn("setNaturalAudioMuted(true)", HTML[toggle_start:toggle_end])
        playing_start = HTML.index("fallbackAudio.onplaying")
        playing_end = HTML.index("\n    };", playing_start)
        self.assertIn("setNaturalAudioMuted(true)", HTML[playing_start:playing_end])
        self.assertNotIn("setAsrPaused(true)", HTML[playing_start:playing_end])
        request_start = HTML.index("async function requestFallbackSpeech")
        play_start = HTML.index("await fallbackAudio.play()", request_start)
        self.assertLess(
            HTML.index("setAsrPaused(true)", request_start), play_start,
        )
        finish_start = HTML.index("function finishSpeech")
        finish_end = HTML.index("\n}", finish_start)
        self.assertIn("setNaturalAudioMuted(false)", HTML[finish_start:finish_end])

    def test_asr_guard_does_not_disable_webrtc_microphone_track(self):
        start = HTML.index("function setAsrPaused")
        end = HTML.index("\n}", start)
        self.assertNotIn("getAudioTracks", HTML[start:end])
        self.assertIn("workletNode.port.postMessage", HTML[start:end])

    def test_presence_lease_heartbeat_and_explicit_leave_are_user_visible(self):
        self.assertIn('id="participantCount"', HTML)
        self.assertIn('id="leaveBtn"', HTML)
        self.assertIn("presenceHeartbeatTimer", HTML)
        self.assertIn("heartbeat_interval_ms", HTML)
        self.assertIn("send({type: 'heartbeat'})", HTML)
        self.assertIn("send({type: 'leave'})", HTML)
        self.assertIn("if (notifyServer) send({type: 'leave'})", HTML)
        self.assertIn("window.addEventListener('pagehide', suspendRoom)", HTML)
        self.assertIn("closed devices clear within 90 seconds", HTML)

    def test_language_role_is_explicit_before_the_room_connects(self):
        self.assertIn('id="roleGate"', HTML)
        self.assertIn('role="dialog"', HTML)
        self.assertIn('id="roleLocaleSel"', HTML)
        self.assertIn('id="joinBtn"', HTML)
        self.assertNotIn('id="localeSearch"', HTML)
        self.assertNotIn('id="roleChoices"', HTML)
        self.assertIn("function localeOptionLabel(profile)", HTML)
        self.assertIn("profile.native_name + ' — ' + profile.display_name", HTML)
        self.assertIn("overflow-y:auto", HTML)
        self.assertIn("max-height:calc(100dvh - 36px)", HTML)
        self.assertIn("let ws, myId = null, ttsToken = null, myLang = null", HTML)
        self.assertNotIn("navigator.language", HTML)
        self.assertIn("function chooseLocale(localeId)", HTML)
        self.assertIn("function previewRoleLocale()", HTML)
        self.assertIn("document.documentElement.dir = profile.rtl ? 'rtl' : 'ltr'", HTML)
        self.assertIn("$('joinBtn').onclick = () => chooseLocale($('roleLocaleSel').value)", HTML)
        start = HTML.index("function chooseLocale(localeId)")
        end = HTML.index("\n}", start)
        body = HTML[start:end]
        self.assertLess(body.index("roleChosen = true"), body.index("connect()"))

    def test_role_summary_declares_the_shared_base_language_route(self):
        self.assertIn('id="roleSummary"', HTML)
        self.assertIn("it maps to base ${profile.language}", HTML)
        self.assertIn("One transcription is shared with the unique listener languages", HTML)

    def test_bfcache_restore_rejoins_but_explicit_leave_stays_terminal(self):
        self.assertIn("let explicitLeave = false", HTML)
        self.assertIn("function suspendRoom()", HTML)
        self.assertIn("function restoreSuspendedRoom(event)", HTML)
        self.assertIn("if (!event.persisted || explicitLeave)", HTML)
        self.assertIn("disconnectRoom(false)", HTML)
        self.assertIn("disconnectRoom(true)", HTML)
        self.assertIn("window.addEventListener('pageshow', restoreSuspendedRoom)", HTML)
        self.assertIn("window.addEventListener('pagehide', suspendRoom)", HTML)

    def test_live_acceptance_uses_real_browser_audio_and_server_results(self):
        source = LIVE_CHECK_PATH.read_text(encoding="utf-8")
        self.assertIn("--use-file-for-fake-audio-capture", source)
        self.assertIn("fetch(fallbackAudio.src)", source)
        self.assertIn("audio_base64", source)
        self.assertIn("AudioWorkletNode", source)
        self.assertIn("Page.setWebLifecycleState", source)
        self.assertIn("previous_id", source)
        self.assertIn("participant_count", source)
        self.assertIn("SEMANTIC_TURNS", source)
        self.assertIn("document.readyState === 'complete'", source)
        self.assertIn("typeof $ === 'function'", source)
        self.assertIn('page.get("url", "").startswith(room_url)', source)
        self.assertIn("fallbackAudio.src.startsWith('blob:')", source)
        self.assertIn("speech_end_to_voice_start_s", source)
        self.assertIn("final_to_voice_start_s", source)
        self.assertIn("assert_warm_voice_targets", source)
        self.assertIn("if (!voiceOn) $('voiceBtn').click()", source)
        self.assertNotIn("handle(", source)
        self.assertNotIn("window.fetch =", source)
        self.assertNotIn("Network.getResponseBody", source)
        self.assertNotIn("CONTROLLED_TTS_SPY", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
