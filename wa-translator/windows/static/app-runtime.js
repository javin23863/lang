(() => {
  "use strict";
  const native = window.LinguaNative?.isNative === true;
  const publicOrigin = native ? window.LinguaNative.publicOrigin : location.origin;
  const hostRoomKey = "live-translator.host-room.v1";
  const uiLanguageKey = "lingua-relay.ui-language";

  // Browser/PWA calls use the shared room document directly, so they need the
  // same bounded network-handoff policy that the native build applies while
  // preparing its generated room asset. Keep this browser-only: native has
  // stronger lifecycle state (`leaving`/`terminalRoom`) available in room.js.
  const BROWSER_ICE_RESTART_WINDOW_MS = 60 * 1000;
  const BROWSER_ICE_RESTART_MAX_PER_WINDOW = 3;

  function installBrowserRoomNetworkRecovery() {
    if (native || !/^\/room\/[^/]+$/.test(location.pathname)) return;
    const NativeWebSocket = window.WebSocket;
    const NativePeerConnection = window.RTCPeerConnection;
    const nativeFetch = window.fetch.bind(window);
    if (typeof NativeWebSocket !== "function" || typeof NativePeerConnection !== "function") return;

    let roomSocket = null;
    let turnRetryNotBefore = 0;
    let wrappedTurnScheduler = null;
    const restartAttempts = new WeakMap();

    function TrackingWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
      roomSocket = socket;
      socket.addEventListener("close", () => {
        if (roomSocket === socket) roomSocket = null;
      });
      return socket;
    }
    TrackingWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(TrackingWebSocket, NativeWebSocket);
    window.WebSocket = TrackingWebSocket;

    function RecoveringRTCPeerConnection(...args) {
      const pc = new NativePeerConnection(...args);
      restartAttempts.set(pc, []);
      pc.addEventListener("iceconnectionstatechange", () => {
        if (pc.iceConnectionState !== "failed"
            || !roomSocket || roomSocket.readyState !== NativeWebSocket.OPEN) return;
        const now = Date.now();
        const attempts = (restartAttempts.get(pc) || [])
          .filter(attemptedAt => now - attemptedAt < BROWSER_ICE_RESTART_WINDOW_MS);
        if (attempts.length >= BROWSER_ICE_RESTART_MAX_PER_WINDOW) {
          restartAttempts.set(pc, attempts);
          return;
        }
        attempts.push(now);
        restartAttempts.set(pc, attempts);
        try { pc.restartIce(); } catch { /* peer teardown wins */ }
      });
      return pc;
    }
    RecoveringRTCPeerConnection.prototype = NativePeerConnection.prototype;
    Object.setPrototypeOf(RecoveringRTCPeerConnection, NativePeerConnection);
    window.RTCPeerConnection = RecoveringRTCPeerConnection;

    function ensureTurnSchedulerGuard() {
      const current = window.scheduleTurnRefresh;
      if (typeof current !== "function") return false;
      if (wrappedTurnScheduler === current) return true;
      const original = current;
      wrappedTurnScheduler = function guardedTurnRefresh(delay) {
        const retryFloor = Math.max(0, turnRetryNotBefore - Date.now());
        return original(Math.max(Number(delay) || 0, retryFloor));
      };
      window.scheduleTurnRefresh = wrappedTurnScheduler;
      return true;
    }

    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      let url;
      try {
        const target = typeof Request !== "undefined" && input instanceof Request ? input.url : input;
        url = new URL(target, location.href);
      } catch {
        return response;
      }
      if (url.pathname !== "/api/turn") return response;
      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("Retry-After") || 0);
        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000 : 30000;
        turnRetryNotBefore = Date.now() + Math.max(30000, retryAfterMs);
        ensureTurnSchedulerGuard();
      } else {
        turnRetryNotBefore = 0;
      }
      return response;
    };
  }

  installBrowserRoomNetworkRecovery();

  // ── Interface language ───────────────────────────────────
  // The catalog language a person picks is the language the whole interface
  // speaks. English is the built-in base: a missing dictionary or a missing
  // key falls back to it one key at a time, so a partial translation is still
  // a usable screen.
  const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ps", "sd", "ur", "yi"]);
  const TRANSLATED_LANGUAGES = new Set([
    "af", "am", "ar", "ast", "az", "ba", "be", "bg", "bn", "br", "bs", "ca", "ceb", "cs", "cy",
    "da", "de", "el", "en", "es", "et", "fa", "ff", "fi", "fr", "fy", "ga", "gd", "gl", "gu",
    "ha", "he", "hi", "hr", "ht", "hu", "hy", "id", "ig", "ilo", "is", "it", "ja", "jv", "ka",
    "kk", "km", "kn", "ko", "lb", "lg", "ln", "lo", "lt", "lv", "mg", "mk", "ml", "mn", "mr",
    "ms", "my", "ne", "nl", "no", "ns", "oc", "or", "pa", "pl", "ps", "pt", "ro", "ru", "sd",
    "si", "sk", "sl", "so", "sq", "sr", "ss", "su", "sv", "sw", "ta", "th", "tl", "tn", "tr",
    "uk", "ur", "uz", "vi", "wo", "xh", "yi", "yo", "zh", "zu",
  ]);

  // `auth.signOutFailed` was added after the original 99 locale files were
  // generated. Keep its translation coverage explicit and source-controlled
  // while avoiding 99 noisy whole-file rewrites. The catalog guard requires
  // this map to cover every shipped non-English locale exactly.
  const SIGN_OUT_FAILED_TRANSLATIONS = Object.freeze({
    "af": "Kon nie afmeld nie. Probeer weer.",
    "am": "መውጣት አልተቻለም። እንደገና ይሞክሩ።",
    "ar": "تعذّر تسجيل الخروج. حاول مرة أخرى.",
    "ast": "Nun se pudo zarrar sesión. Inténtalo otra vuelta.",
    "az": "Hesabdan çıxmaq mümkün olmadı. Yenidən cəhd edin.",
    "ba": "Системанан сығып булманы. Тағы бер тапҡыр ҡабатлап ҡарағыҙ.",
    "be": "Не ўдалося выйсці. Паспрабуйце яшчэ раз.",
    "bg": "Неуспешно излизане. Опитайте отново.",
    "bn": "সাইন আউট করা যায়নি। আবার চেষ্টা করুন।",
    "br": "N'eus ket bet gallet digevreañ. Klaskit en-dro.",
    "bs": "Odjava nije uspjela. Pokušajte ponovo.",
    "ca": "No s'ha pogut tancar la sessió. Torna-ho a provar.",
    "ceb": "Dili maka-sign out. Sulayi pag-usab.",
    "cs": "Odhlášení se nezdařilo. Zkuste to znovu.",
    "cy": "Methu allgofnodi. Rhowch gynnig arall arni.",
    "da": "Kunne ikke logge ud. Prøv igen.",
    "de": "Abmelden nicht möglich. Versuche es erneut.",
    "el": "Δεν ήταν δυνατή η αποσύνδεση. Δοκιμάστε ξανά.",
    "es": "No se pudo cerrar sesión. Inténtalo de nuevo.",
    "et": "Väljalogimine ebaõnnestus. Proovige uuesti.",
    "fa": "خروج از حساب ممکن نشد. دوباره تلاش کنید.",
    "ff": "Horiima seŋaade. Eto kadi.",
    "fi": "Uloskirjautuminen epäonnistui. Yritä uudelleen.",
    "fr": "Impossible de se déconnecter. Réessayez.",
    "fy": "Ofmelde is net slagge. Besykje it nochris.",
    "ga": "Níorbh fhéidir síniú amach. Bain triail eile as.",
    "gd": "Cha b’ urrainn dhuinn do chlàradh a-mach. Feuch ris a-rithist.",
    "gl": "Non se puido pechar a sesión. Téntao de novo.",
    "gu": "સાઇન આઉટ થઈ શક્યું નથી. ફરી પ્રયાસ કરો.",
    "ha": "Ba a iya fita ba. Sake gwadawa.",
    "he": "לא ניתן להתנתק. נסו שוב.",
    "hi": "साइन आउट नहीं हो सका। फिर से कोशिश करें।",
    "hr": "Odjava nije uspjela. Pokušajte ponovno.",
    "ht": "Pa t kapab dekonekte. Eseye ankò.",
    "hu": "Nem sikerült kijelentkezni. Próbálja újra.",
    "hy": "Չհաջողվեց դուրս գալ։ Կրկին փորձեք։",
    "id": "Tidak dapat keluar. Coba lagi.",
    "ig": "Enweghị ike ịpụ. Nwaa ọzọ.",
    "ilo": "Saan a nakapag-sign out. Padasem manen.",
    "is": "Ekki tókst að skrá út. Reyndu aftur.",
    "it": "Impossibile uscire. Riprova.",
    "ja": "サインアウトできませんでした。もう一度お試しください。",
    "jv": "Ora bisa metu. Coba maneh.",
    "ka": "გასვლა ვერ მოხერხდა. სცადეთ ხელახლა.",
    "kk": "Жүйеден шығу мүмкін болмады. Қайталап көріңіз.",
    "km": "មិនអាចចាកចេញពីគណនីបានទេ។ សូមព្យាយាមម្តងទៀត។",
    "kn": "ಸೈನ್ ಔಟ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    "ko": "로그아웃할 수 없습니다. 다시 시도하세요.",
    "lb": "Ofmellen ass net gelongen. Probéiert nach eng Kéier.",
    "lg": "Tekisobose kufuluma. Gezaako nate.",
    "ln": "Kobima na compte esimbaki te. Meka lisusu.",
    "lo": "ບໍ່ສາມາດອອກຈາກລະບົບໄດ້. ລອງໃໝ່ອີກຄັ້ງ.",
    "lt": "Nepavyko atsijungti. Bandykite dar kartą.",
    "lv": "Neizdevās izrakstīties. Mēģiniet vēlreiz.",
    "mg": "Tsy afaka nivoaka. Andramo indray.",
    "mk": "Не можеше да се одјавите. Обидете се повторно.",
    "ml": "സൈൻ ഔട്ട് ചെയ്യാനായില്ല. വീണ്ടും ശ്രമിക്കുക.",
    "mn": "Гарах боломжгүй байна. Дахин оролдоно уу.",
    "mr": "साइन आउट करता आले नाही. पुन्हा प्रयत्न करा.",
    "ms": "Tidak dapat log keluar. Cuba lagi.",
    "my": "အကောင့်မှ ထွက်၍ မရပါ။ ထပ်မံကြိုးစားပါ။",
    "ne": "साइन आउट गर्न सकिएन। फेरि प्रयास गर्नुहोस्।",
    "nl": "Afmelden is niet gelukt. Probeer het opnieuw.",
    "no": "Kunne ikke logge ut. Prøv igjen.",
    "ns": "Ga se gwa kgonega go tšwa. Leka gape.",
    "oc": "Impossible de se desconnectar. Tornatz ensajar.",
    "or": "ସାଇନ୍ ଆଉଟ୍ କରିହେଲା ନାହିଁ। ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।",
    "pa": "ਸਾਈਨ ਆਉਟ ਨਹੀਂ ਕੀਤਾ ਜਾ ਸਕਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
    "pl": "Nie udało się wylogować. Spróbuj ponownie.",
    "ps": "وتل ممکن نه شول. بیا هڅه وکړئ.",
    "pt": "Não foi possível terminar sessão. Tente novamente.",
    "ro": "Nu s-a putut face deconectarea. Încercați din nou.",
    "ru": "Не удалось выйти. Попробуйте ещё раз.",
    "sd": "سائن آئوٽ نه ٿي سگهيو. ٻيهر ڪوشش ڪريو.",
    "si": "වරනය වීමට නොහැකි විය. නැවත උත්සාහ කරන්න.",
    "sk": "Odhlásenie sa nepodarilo. Skúste to znova.",
    "sl": "Odjava ni uspela. Poskusite znova.",
    "so": "Lagama bixi karin. Mar kale isku day.",
    "sq": "Nuk u bë dot dalja. Provo përsëri.",
    "sr": "Одјављивање није успело. Покушајте поново.",
    "ss": "Akukwazekanga kuphuma. Zama futsi.",
    "su": "Teu tiasa kaluar. Cobian deui.",
    "sv": "Det gick inte att logga ut. Försök igen.",
    "sw": "Haikuwezekana kuondoka. Jaribu tena.",
    "ta": "வெளியேற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
    "th": "ออกจากระบบไม่ได้ โปรดลองอีกครั้ง",
    "tl": "Hindi makapag-sign out. Subukan ulit.",
    "tn": "Ga go a kgonega go tswa. Leka gape.",
    "tr": "Çıkış yapılamadı. Tekrar deneyin.",
    "uk": "Не вдалося вийти. Спробуйте ще раз.",
    "ur": "سائن آؤٹ نہیں ہو سکا۔ دوبارہ کوشش کریں۔",
    "uz": "Hisobdan chiqib bo‘lmadi. Qayta urinib ko‘ring.",
    "vi": "Không thể đăng xuất. Hãy thử lại.",
    "wo": "Mëneesul génn. Jéemaatal.",
    "xh": "Akukwazekanga ukuphuma. Zama kwakhona.",
    "yi": "מען האָט נישט געקענט זיך אָפּמעלדן. פּרוּווט ווידער.",
    "yo": "Kò ṣeé jáde kúrò nínú àkọọ́lẹ̀. Gbìyànjú lẹ́ẹ̀kan síi.",
    "zh": "无法退出登录。请重试。",
    "zu": "Akukwazekanga ukuphuma. Zama futhi."
  });

  const BASE_STRINGS = Object.freeze({
    "legal.privacy": "Privacy",
    "legal.terms": "Terms",
    "legal.support": "Support",
    "share.title": "Private translated video call",
    "share.text": "Join my private translated video call.",
    "share.qr": "QR code",
    "share.textVoice": "Join my translated call:",
    "share.textChat": "Join my translated chat:",
    "share.textVideo": "Join my translated video call:",

    "home.noRoom": "No active room on this device.",
    "home.roomControl": "Room control",
    "home.participantLink": "Participant link",
    "home.copyLink": "Copy link",
    "home.share": "Share",
    "home.openRoom": "Open room",
    "home.closeRoom": "Close room",
    "home.roomOpenOne": "Room open — 1 participant.",
    "home.roomOpenMany": "Room open — {count} participants.",
    "home.roomReady": "Room ready — no participants joined yet.",
    "home.confirmReplace":
      "Close the active room and create a new one? Everyone in it will be disconnected.",
    "home.linkReady": "Private participant link is ready to share.",
    "home.createFailed": "Could not create and save a private room on this device.",
    "home.linkCopied": "Participant link copied.",
    "home.selectToCopy": "Select and copy the participant link.",
    "home.linkShared": "Participant link shared.",
    "home.openBlocked": "Opening was blocked. Copy the participant link instead.",
    "home.confirmClose":
      "Close this room now? Everyone will be disconnected and the participant link will stop working.",
    "home.roomClosedLink": "This room is closed. Its participant link no longer works.",
    "home.closeFailed": "Could not close the room. It remains saved on this device.",
    "home.statusUnavailable":
      "Room status is temporarily unavailable. The control stays saved on this device.",
    "home.needsUpdate": "This app cannot connect or needs an update.",
    "home.roomExpired": "This room has expired.",
    "home.roomClosed": "This room is closed.",
    "home.controlLost": "This room has expired or is no longer controlled by this device.",

    "auth.signInPrompt": "Sign in to start a call. Joining an invite link never needs an account.",
    "auth.signInGoogle": "Continue with Google",
    "auth.signInApple": "Continue with Apple",
    "auth.signInFacebook": "Continue with Facebook",
    "auth.signOut": "Sign out",
    "auth.signOutFailed": "Could not sign out. Try again.",
    "auth.signedInAs": "{name}",
    "auth.failed": "Sign-in did not finish. Try again.",
    "auth.deleteAccount": "Delete account",
    "auth.deleteConfirm": "Delete this account and everything saved with it? This cannot be undone.",
    "auth.deleted": "Account deleted.",
    "auth.deleteFailed": "Could not delete this account. Try again.",

    "credits.heading": "Credits",
    "credits.balance": "{count} credits",
    "credits.buy": "Buy credits",
    "credits.buyUnavailable": "Buying credits is not available yet.",
    "credits.usageHeading": "Recent usage",
    "credits.usageEmpty": "No usage yet.",
    "credits.callMinutes": "{count} call minutes",
    "credits.chatMessages": "{count} messages",
    "credits.ttsPhrases": "{count} spoken translations",

    "tile.voice": "Voice call",
    "tile.chat": "Text chat",
    "tile.video": "Video call",
    "tile.calleeName": "Who are you calling?",
    "tile.calleeHint": "Optional — shown on the call screen.",

    "gate.title": "Choose language",
    "gate.language": "Language",
    "gate.loading": "Loading…",
    "gate.agreeBefore": "I agree to the ",
    "gate.agreeAfter": "",
    "gate.join": "Join room",
    "gate.blocked": "Blocked on this device",
    "gate.languagesUnavailable": "Languages unavailable",
    "gate.updateRequired": "App update or connection required",

    "tier.verified": "Tested",
    "tier.preview": "Preview",
    "capability.captions": "Captions",
    "capability.captionsUnavailable": "Captions unavailable",

    "voice.captionsOnly": "Captions only",
    "voice.onThisDevice": "On this device",
    "voice.included": "Included",
    "voice.female": "female",
    "voice.male": "male",
    "voice.on": "Voice on",
    "voice.off": "Voice off",
    "voice.unavailable": "Voice unavailable",
    "voice.playFailed": "Could not play spoken translation",
    "voice.playTimedOut": "Spoken translation playback timed out",
    "voice.naturalAudioRestored": "Natural audio restored",
    "voice.speakingAloud": "Speaking translations aloud",
    "voice.mutedCaptionsOnly": "Translations muted — captions only",

    "bar.startMic": "Start microphone",
    "bar.listening": "Listening — tap to mute",
    "bar.starting": "Starting…",
    "bar.shareTitle": "Share this private room",
    "bar.camera": "Camera",
    "bar.cameraTitle": "Turn camera on or off",
    "bar.voiceTitle": "Turn translated voice on or off",
    "bar.leaveTitle": "Leave this room",
    "bar.moreTitle": "More options",

    "call.call": "Call",
    "call.calling": "Calling…",
    "call.ringing": "Ringing…",
    "call.connected": "Connected",
    "call.ended": "Call ended",
    "call.declined": "Declined",
    "call.accept": "Accept",
    "call.decline": "Decline",
    "call.incoming": "Incoming call",
    "call.with": "{name}",
    "call.mute": "Mute",
    "call.unmute": "Unmute",
    "call.soundOn": "Sound on",
    "call.soundOff": "Sound off",
    "call.end": "End call",
    "call.captionsShow": "Show captions",
    "call.captionsHide": "Hide captions",

    "chat.placeholder": "Message",
    "chat.send": "Send",
    "chat.empty": "No messages yet.",
    "chat.failed": "Message could not be sent.",
    "chat.tooLong": "Message is too long.",

    "settings.language": "Language",
    "settings.voice": "Voice",
    "settings.reportReason": "Report reason",
    "report.harassment": "Harassment",
    "report.threat": "Threats",
    "report.sexual": "Sexual content",
    "report.hate": "Hate",
    "report.scam": "Scam",
    "report.other": "Other",
    "report.button": "Report & block this room",
    "report.confirm": "Send a private report and block this room on this device?",
    "report.sent": "Report sent. Room blocked on this device.",
    "report.failed": "Room blocked. Report could not be sent.",

    "captions.heading": "Captions",
    "captions.you": "You",
    "captions.live": "live",

    "stage.waiting": "Waiting for the other person to join…",
    "stage.countOne": "{count} / 2 person",
    "stage.countMany": "{count} / 2 people",

    "status.joiningAs": "Joining as {language}…",
    "status.connected": "Connected",
    "status.reconnecting": "Reconnecting…",
    "status.roomExpired": "This private room has expired or is unavailable",
    "status.roomClosed": "This private room has been closed",
    "status.youLeft": "You left this room",
    "status.rejoining": "Rejoining this room…",
    "status.languagesUpdated": "Languages updated — reload to continue",
    "status.speakerJoined": "{language} speaker joined",
    "status.captionsBusy": "Captions are busy. Try again in about {seconds}s.",
    "status.roomFull": "Room is full ({limit} people)",
    "status.invitationShared": "Invitation shared",
    "status.linkCopied": "Private room link copied",
    "status.shareFailed": "Could not open the share app — copy the address-bar link",
    "status.muted": "Muted — the other person cannot hear you",
    "status.micOn": "Mic on — speak {language}",
    "status.micUnavailable": "Microphone unavailable",
    "status.cameraUnavailable": "Camera unavailable — microphone still works",
    "status.languageChanged": "Language changed to {language}",
    "status.backgroundPaused": "Call paused while Lingua Relay is in the background",

    "note.askForNewRoom": "Ask the caller to create a new private room.",
    "note.closedByHost": "This private room has been closed by its host.",
    "note.youLeft": "You left this private room.",
    "note.reconnectingPeer": "Reconnecting to the other person…",
    "note.otherLeft": "The other person left.",
    "note.roomFull": "Room is full. If someone just closed it, try again within 90 seconds.",
    "note.videoFailed": "Video could not connect through your networks. Captions are still live.",
    "note.videoSlow": "Still trying to connect video… captions are already live.",
  });

  let uiLanguage = "en";
  let uiLocale = "en-US";
  let strings = BASE_STRINGS;
  const languageListeners = new Set();

  function baseLanguage(value) {
    return String(value || "").replaceAll("_", "-").split("-")[0].toLowerCase();
  }

  function t(key, params) {
    // Room capacity is a product invariant, not translator-owned copy. Keeping
    // this numeric removes stale /4 strings from older locale dictionaries and
    // prevents localization data from ever advertising multiparty support.
    if ((key === "stage.countOne" || key === "stage.countMany")
        && params && Object.prototype.hasOwnProperty.call(params, "count")) {
      return `${params.count} / 2`;
    }
    const template = typeof strings[key] === "string" ? strings[key] : BASE_STRINGS[key];
    if (typeof template !== "string") return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }

  function applyTranslatedDom(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;
    for (const el of scope.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of scope.querySelectorAll("[data-i18n-title]")) {
      el.title = t(el.dataset.i18nTitle);
    }
    for (const el of scope.querySelectorAll("[data-i18n-label]")) {
      el.setAttribute("aria-label", t(el.dataset.i18nLabel));
    }
  }

  function whenDomReady(run) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else run();
  }

  function commitLanguage() {
    // Direction follows the language the person chose, not the dictionary that
    // happened to load: an unreachable Arabic dictionary still has to lay the
    // room's Arabic captions out right-to-left.
    document.documentElement.lang = uiLocale || uiLanguage;
    document.documentElement.dir = RTL_LANGUAGES.has(baseLanguage(uiLocale)) ? "rtl" : "ltr";
    whenDomReady(() => {
      applyTranslatedDom(document);
      for (const listener of languageListeners) {
        try { listener(uiLanguage); } catch { /* one bad listener never blocks the rest */ }
      }
    });
  }

  let languageCommitted = false;

  async function useLanguage(locale) {
    const language = baseLanguage(locale);
    const supported = TRANSLATED_LANGUAGES.has(language) ? language : "en";
    const nextLocale = String(locale || "") || supported;
    if (supported === uiLanguage) {
      // The first call always commits, even when it lands on the English the
      // runtime already holds: that is the pass that stamps lang and dir and
      // paints the marked elements for the very first screen.
      if (nextLocale !== uiLocale || !languageCommitted) {
        uiLocale = nextLocale;
        languageCommitted = true;
        commitLanguage();
      }
      return uiLanguage;
    }
    let loaded = BASE_STRINGS;
    if (supported !== "en") {
      try {
        const response = await fetch(new URL(`/static/i18n/${supported}.json`, location.href),
                                    { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = await response.json();
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("invalid dictionary");
        }
        const signOutFailed = SIGN_OUT_FAILED_TRANSLATIONS[supported];
        if (typeof signOutFailed !== "string" || !signOutFailed) {
          throw new Error("incomplete dictionary");
        }
        loaded = {...value, "auth.signOutFailed": signOutFailed};
      } catch {
        // An unreachable dictionary must not strand the person on a blank
        // screen: English is always complete and always local.
        loaded = BASE_STRINGS;
      }
    }
    uiLanguage = loaded === BASE_STRINGS && supported !== "en" ? "en" : supported;
    uiLocale = nextLocale;
    strings = loaded;
    languageCommitted = true;
    try { localStorage.setItem(uiLanguageKey, uiLocale); } catch { /* private mode */ }
    commitLanguage();
    return uiLanguage;
  }

  function preferredLocale() {
    try {
      const saved = localStorage.getItem(uiLanguageKey) || localStorage.getItem("lingua-relay.locale");
      if (saved && TRANSLATED_LANGUAGES.has(baseLanguage(saved))) return saved;
    } catch { /* private mode */ }
    const offered = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of offered) {
      if (candidate && TRANSLATED_LANGUAGES.has(baseLanguage(candidate))) return candidate;
    }
    return "en-US";
  }

  const i18n = Object.freeze({
    t,
    apply: applyTranslatedDom,
    use: useLanguage,
    languages: Object.freeze([...TRANSLATED_LANGUAGES].sort()),
    get language() { return uiLanguage; },
    get locale() { return uiLocale; },
    isRtl: (locale) => RTL_LANGUAGES.has(baseLanguage(locale)),
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      languageListeners.add(listener);
      try { listener(uiLanguage); } catch { /* first paint stays English */ }
      return () => languageListeners.delete(listener);
    },
  });

  function apiUrl(path) {
    const resolved = native ? window.LinguaNative.apiPath(path) : path;
    return new URL(resolved, publicOrigin).toString();
  }

  function websocketUrl(token) {
    const base = new URL(publicOrigin);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = native ? window.LinguaNative.websocketPath(token) : `/ws/${token}`;
    return base.toString();
  }

  function roomToken() {
    if (native) {
      const token = new URLSearchParams(location.search).get("room") || "";
      return window.LinguaNative.isRoomToken(token) ? token : null;
    }
    return location.pathname.match(/^\/room\/([^/]+)$/)?.[1] || null;
  }

  function inviteUrl(room) {
    const path = typeof room === "string" ? room : room?.path;
    return new URL(path, publicOrigin).toString();
  }

  function currentRoomMode() {
    const mode = new URLSearchParams(location.search).get("m");
    return mode === "voice" || mode === "chat" ? mode : "";
  }

  function contentUrl(page, hash = "") {
    if (!["privacy", "terms", "support"].includes(page)) {
      throw new Error("Unsupported content page");
    }
    const url = new URL(native ? `${page}.html` : `/${page}`,
                        native ? location.href : publicOrigin);
    const token = roomToken();
    if (token) {
      const mode = currentRoomMode();
      const returnPath = native
        ? `room.html?room=${encodeURIComponent(token)}${mode ? `&m=${mode}` : ""}`
        : `/room/${token}${mode ? `?m=${mode}` : ""}`;
      url.searchParams.set("return", returnPath);
    }
    if (hash) url.hash = hash;
    return url.toString();
  }

  async function loadHostRoom() {
    return native
      ? await window.LinguaNative.getItem(hostRoomKey)
      : localStorage.getItem(hostRoomKey);
  }

  async function saveHostRoom(value) {
    try {
      if (native) await window.LinguaNative.setItem(hostRoomKey, value);
      else localStorage.setItem(hostRoomKey, value);
      return true;
    } catch {
      return false;
    }
  }

  async function forgetHostRoom() {
    try {
      if (native) await window.LinguaNative.removeItem(hostRoomKey);
      else localStorage.removeItem(hostRoomKey);
    } catch { /* an expired server token still fails closed */ }
  }

  async function share(value) {
    if (native) return window.LinguaNative.share(value);
    if (!navigator.share) return false;
    try {
      await navigator.share(value);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return true;
      return false;
    }
  }

  // `mode` rearranges the room's own furniture and nothing else, so a shell
  // built before modes existed still opens the right room from one argument.
  function openRoom(room, mode) {
    const token = String((typeof room === "string" ? room : room?.path) || "")
      .split("/").filter(Boolean).pop();
    if (native) return window.LinguaNative.openRoom(token, mode);
    const opened = window.open("about:blank", "_blank");
    if (!opened) return false;
    opened.opener = null;
    const url = new URL(inviteUrl(room));
    if (mode && mode !== "video") url.searchParams.set("m", mode);
    // Personal labels from older saved-room records are deliberately ignored:
    // participant bearer URLs contain only the signed room token and call mode.
    url.searchParams.delete("n");
    opened.location.replace(url.toString());
    return true;
  }

  function ready() {
    return native ? window.LinguaNative.ready() : Promise.resolve(true);
  }

  window.LinguaRuntime = Object.freeze({
    isNative: native, publicOrigin, apiUrl, websocketUrl, roomToken, inviteUrl, contentUrl,
    loadHostRoom, saveHostRoom, forgetHostRoom, share, openRoom, ready, i18n, t,
  });

  // Every screen opens in the language this device already chose — the host
  // dashboard has no language picker of its own, so the room choice and the
  // device language are what it has to go on.
  useLanguage(preferredLocale());
})();
