# Store rating and audience sources

Verified against primary platform guidance on **2026-08-26**. This file records questionnaire inputs for the current version 1.0 product; it is not a store-assigned age-rating receipt. Re-check the live questionnaires before submission because wording and regional ratings can change.

## Apple App Store age rating

Primary sources:

- Set an app age rating: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating
- Age rating values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/

Current product facts for the questionnaire:

- **Messaging and Chat: Yes.** Lingua Relay lets two users communicate directly by text, voice, and video inside one private invitation room.
- **Social Media: No.** There is no feed, reposting, liking, following, public profile, discovery, search, amplification, or public room browsing.
- **Unrestricted Web Access: No.** The installed product is not a general web browser and provides no arbitrary in-app web navigation surface. OAuth uses the system browser for a bounded authentication flow.
- **Advertising: No.** Version 1.0 has no advertising SDK or ad surface.
- **User-generated communication safety:** a participant can independently block the current peer. The app stores a random installation-scoped pseudonymous safety ID and a bounded device-local blocked-ID list; a later room join is refused before admission if either participant presents a block relationship involving the same safety ID. Reporting also adds the peer to the local block list, and a durably accepted report in the installed app closes the current reported room. The safety mechanism creates no guest account, searchable identity, public profile, discovery graph, or server-side block-history database.
- **User-Generated Content capability:** Apple's current age-rating definition describes broad distribution of user-created content. Version 1.0 has only private one-to-one room communication and no broad distribution; direct communication is declared under Messaging and Chat. Re-check Apple's exact wording at submission rather than carrying this interpretation forward indefinitely.
- **Made for Kids: No** for the current product contract. The public privacy policy says Lingua Relay is not directed to children under 13.

Apple calculates the displayed age rating from the completed questionnaire and any region-specific rules. Do not hard-code a numeric Apple age rating in source before App Store Connect assigns it.

## Google Play content rating and target audience

Primary sources:

- Content rating requirements: https://support.google.com/googleplay/android-developer/answer/9859655
- Online Interaction or Content Exchange: https://support.google.com/googleplay/android-developer/answer/7021383
- Target audience and app content: https://support.google.com/googleplay/android-developer/answer/9867159
- User Generated Content policy: https://support.google.com/googleplay/android-developer/answer/9876937

Current product facts for the questionnaire:

- **Online Interaction or Content Exchange: Yes.** Users directly exchange text, voice, and video through the app's own private-room service.
- **User-generated content policy applies.** Version 1.0 provides affirmative Terms acceptance, a category-only report path, and an independent participant-blocking function. The random installation safety ID plus bounded local block list let either side refuse the same safety ID on a future private-room encounter before that peer is admitted. The block list is never exposed to the other participant. Reporting also local-blocks the current peer; a durably accepted installed-app report closes the current room on the backend. There is no guest account, public profile, user directory, discovery/matching graph, or persistent server-side block-history database.
- **Advertising: No.** Version 1.0 contains no ads.
- **Target audience:** the product is not designed for children under 13. The exact Play target-age bands remain an owner/operator console decision based on the intended launch audience and distribution. Do not infer an 18+ audience from source: the product has no adult-only age gate.

Google/IARC assigns regional content ratings from the completed questionnaire. Do not copy a guessed numeric/content rating into source or store metadata before the questionnaire is completed.
