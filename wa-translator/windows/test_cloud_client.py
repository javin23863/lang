"""Cheap contract guard for the one shared local/cloud phone client.

The real browser lifecycle remains in browser_check.py.  These assertions make
the security/default-mode surface fail before a browser is even launched.
"""

import pathlib
import unittest


HTML = pathlib.Path(__file__).with_name("static").joinpath("room.html").read_text(
    encoding="utf-8")
# The room reads every sentence out of a dictionary now, so the words a person
# actually sees live in the runtime's English base rather than in the markup.
# Assertions about wording follow them there instead of being dropped.
RUNTIME = pathlib.Path(__file__).with_name("static").joinpath("app-runtime.js").read_text(
    encoding="utf-8")
LIVE_CHECK_PATH = pathlib.Path(__file__).with_name("live_bilingual_check.py")


class CloudClientContractTests(unittest.TestCase):
    def test_captions_only_and_controlled_voice_controls_are_literal_defaults(self):
        self.assertIn("let voiceOn = false", HTML)
        self.assertIn('id="publishVoiceSel"', HTML)
        self.assertIn("voice_profile: myVoiceProfileId", HTML)
        self.assertIn("option.textContent = t('voice.captionsOnly')", HTML)
        self.assertIn('"voice.captionsOnly": "Captions only"', RUNTIME)

    def test_free_device_voices_are_locale_matched_and_never_sent_to_the_server(self):
        self.assertIn("speechSynthesis.getVoices()", HTML)
        self.assertIn("voiceschanged", HTML)
        self.assertIn("new SpeechSynthesisUtterance", HTML)
        self.assertIn("device:", HTML)
        self.assertIn("cloud:", HTML)
        self.assertIn("voice.lang.toLowerCase() === locale", HTML)
        self.assertIn("voice.lang.split('-')[0].toLowerCase() === base", HTML)
        self.assertIn("speechSynthesis.cancel()", HTML)
        self.assertNotIn("voice_profile: myVoiceChoice", HTML)

    def test_device_voice_pauses_asr_before_native_playback_and_mutes_on_start(self):
        native_start = HTML.index("function requestDeviceSpeech")
        native_end = HTML.index("\n}", native_start)
        native_body = HTML[native_start:native_end]
        self.assertLess(native_body.index("setAsrPaused(true)"),
                        native_body.index("speechSynthesis.speak"))
        self.assertIn("utterance.onstart", native_body)
        self.assertIn("setNaturalAudioMuted(true)", native_body)

    def test_turn_and_tts_keep_bearer_in_headers(self):
        self.assertIn("fetch(runtime.apiUrl('/api/turn')", HTML)
        self.assertIn("'Authorization': 'Bearer ' + roomId", HTML)
        self.assertIn("voice_profile: item.voiceProfileId", HTML)
        self.assertNotIn("turn?token=", HTML)
        self.assertIn("'X-Participant-ID': myId", HTML)

    def test_turn_credentials_refresh_and_restart_existing_ice(self):
        self.assertIn("turnRefreshTimer", HTML)
        self.assertIn("pc.setConfiguration({iceServers})", HTML)
        self.assertIn("pc.restartIce()", HTML)
        self.assertIn("iceExpiresAt - Date.now() - 60000", HTML)

    def test_join_never_requests_media_before_an_explicit_media_action(self):
        peer_start = HTML.index("function startPeer")
        peer_end = HTML.index("\nasync function onSignal", peer_start)
        self.assertNotIn("getMedia()", HTML[peer_start:peer_end])
        self.assertIn("for (const p of peers.values()) addTracks(p.pc)", HTML)

    def test_invite_only_room_requires_terms_and_can_be_reported_and_blocked(self):
        self.assertIn('id="termsAgree"', HTML)
        self.assertIn('id="termsLink"', HTML)
        self.assertIn('id="reportBtn"', HTML)
        self.assertIn("profile?.capabilities?.asr?.available && termsAccepted()", HTML)
        self.assertIn("runtime.contentUrl('terms')", HTML)
        self.assertIn("runtime.apiUrl('/api/reports')", HTML)
        self.assertIn("'X-Participant-ID': myId", HTML)
        self.assertIn('id="reportCategory"', HTML)
        self.assertIn("localStorage.setItem(blockedRoomKey", HTML)
        self.assertNotIn("location.href = 'support.html#report'", HTML)

    def test_microphone_and_camera_permissions_are_independent(self):
        self.assertIn("function getAudioMedia()", HTML)
        self.assertIn("function getVideoMedia()", HTML)
        audio_start = HTML.index("function getAudioMedia()")
        audio_end = HTML.index("\n}", audio_start)
        video_start = HTML.index("function getVideoMedia()")
        video_end = HTML.index("\n}", video_start)
        self.assertIn("audio:", HTML[audio_start:audio_end])
        self.assertIn("video: false", HTML[audio_start:audio_end])
        self.assertIn("audio: false", HTML[video_start:video_end])
        self.assertIn("video:", HTML[video_start:video_end])
        self.assertNotIn("function getMedia()", HTML)

    def test_revoked_media_tracks_clear_their_cached_permission_promises(self):
        audio_start = HTML.index("function getAudioMedia()")
        audio_end = HTML.index("\n}\n\nfunction getVideoMedia", audio_start)
        video_start = HTML.index("function getVideoMedia()")
        video_end = HTML.index("\n}\n\n// Single owner", video_start)
        self.assertIn("stream.removeTrack(track)", HTML[audio_start:audio_end])
        self.assertIn("audioMediaPromise = null", HTML[audio_start:audio_end])
        self.assertIn("stream.removeTrack(track)", HTML[video_start:video_end])
        self.assertIn("videoMediaPromise = null", HTML[video_start:video_end])

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
        self.assertIn("setStatus('status.roomFull', {limit: m.limit}, true)", HTML)
        self.assertIn('"status.roomFull": "Room is full ({limit} people)"', RUNTIME)
        self.assertNotIn("closed devices clear within", HTML)
        self.assertNotIn("global GPU capacity", HTML)

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
        self.assertIn("runtime.i18n.use(profile.id)", HTML)
        self.assertIn('document.documentElement.dir = RTL_LANGUAGES.has(baseLanguage(uiLocale))',
                      RUNTIME)
        self.assertIn("$('joinBtn').onclick = () => chooseLocale($('roleLocaleSel').value)", HTML)
        start = HTML.index("function chooseLocale(localeId)")
        end = HTML.index("\n}", start)
        body = HTML[start:end]
        self.assertLess(body.index("roleChosen = true"), body.index("connect()"))

    def test_professional_ui_omits_implementation_explanations(self):
        self.assertNotIn('id="roleSummary"', HTML)
        self.assertNotIn("it maps to base", HTML)
        self.assertNotIn("One transcription is shared", HTML)
        self.assertNotIn("mapping_note", HTML)
        self.assertNotIn("verified language options", HTML)
        self.assertIn("document.createElement('optgroup')", HTML)
        self.assertIn("group.label = t(tier === 'verified' ? 'tier.verified' : 'tier.preview')",
                      HTML)
        self.assertIn('"tier.verified": "Tested"', RUNTIME)
        self.assertIn('"tier.preview": "Preview"', RUNTIME)

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
