# Store review operator inputs

This file lists submission information that cannot be derived safely from source code.
Do not put passwords, OAuth credentials, API keys, private phone numbers, or other
review secrets in Git. Enter sensitive values directly in App Store Connect / Play
Console or the team's approved secret manager.

## Public console URLs

The repository is still configured to the current development Worker origin:

- Web app: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/`
- Privacy policy: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/privacy`
- Terms: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/terms`
- Support: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/support`
- External account deletion: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/delete-account.html`

**Do not copy those URLs into final store records merely because they are present
here.** Before submission, select/configure the actual public production origin,
update the single product-origin configuration, re-sync Android/iOS associations,
revalidate OAuth callbacks, and replace every console URL below with that exact
production origin. If the Worker origin is intentionally retained for launch, make
that an explicit release decision and verify it as the production origin.

The deletion resource explains the authenticated browser deletion flow. A user who
can sign in with the account's provider can delete from the same web app. Successful
deletion first closes every still-live room owned by the account; if all owned rooms
cannot be confirmed closed, deletion fails and remains retryable instead of erasing
the account while an invitation stays active. Do not route access-loss requests
through the public GitHub issue tracker; a dedicated private support contact remains
a pre-submission requirement below.

## Apple App Review

Before submitting version 1.0, the account owner must provide:

- [ ] Review contact first and last name.
- [ ] Review contact email address.
- [ ] Review contact phone number in international format.
- [ ] Review notes explaining the core two-person flow: a signed-in host creates
      one private, signed HTTPS invitation; exactly one invited participant can
      join it without an account. The room expires no later than 24 hours.
- [ ] Review notes explicitly state that version 1.0 has **no public posting,
      public profile/user directory, people search, discovery feed, follower
      graph, random matching, stranger pairing, or open room browsing**. A user
      can communicate with another participant only by possessing that private
      room invitation.
- [ ] Review notes explain account deletion: room ownership is registered before
      a newly created room bearer is returned. Delete account closes every still-
      live room owned by the account before erasing account data, so its invite
      stops working. A concurrent create cannot escape deletion; if room closure
      cannot be confirmed, deletion fails closed and remains retryable.
- [ ] Review notes explain the safety flow: first-time entry requires an
      unchecked affirmative Terms checkbox for the current Terms version. A live
      participant has an independent **Block participant** action. Each install
      carries a random pseudonymous safety ID plus a bounded device-local block
      list; if either participant has blocked the other's safety ID, a later room
      join is refused before that participant is admitted. The peer receives only
      the safety ID needed for this safety function, never the local block list.
      The category-only report action also adds the current participant to the
      local block list; in the installed app, once the report is durably accepted,
      the backend invalidates that current private room so its invitation cannot
      continue or be re-entered. This creates no guest account, public profile,
      searchable identity, discovery graph, or server-side block-history database.
- [ ] Review notes explain that the safety ID is installation-scoped rather than
      an account identity: clearing app/site data or reinstalling resets the ID
      and local block list. Reviewers should demonstrate a future-room refusal
      without expecting an account-level global block across independent installs.
- [ ] Review notes explain that microphone/camera permission is requested only
      from explicit Call/Accept, microphone, or camera actions and never merely
      by opening the invitation.
- [ ] A non-expiring review/demo identity that can complete the production OAuth
      flow used by the app. Store the credentials only in App Store Connect.
- [ ] Any additional provider-specific steps the reviewer needs to complete SSO.
- [ ] TestFlight feedback email before inviting external testers.

The review identity must exercise the real production account flow. Do not add a
hard-coded reviewer bypass or hidden password path to the app.

## Google Play review access

Before submitting to review, the account owner must provide:

- [ ] App-access instructions showing how a reviewer reaches signed-in host
      functionality.
- [ ] A working review/demo identity for the production OAuth flow, with any
      additional SSO instructions needed to complete sign-in.
- [ ] Confirmation that invited participants do not need an account and can join
      only using the private room link created by the reviewer; there is no
      public discovery, search, random matching, or stranger-chat surface.
- [ ] Instructions for verifying account deletion: create a room, delete the host
      account, then confirm that the previously issued invitation is closed. If
      owned-room shutdown cannot be confirmed, the deletion operation must fail
      rather than claim success.
- [ ] Instructions for exercising the independent **Block participant** action:
      block the current peer on one install, then show that a later private-room
      join presenting the same pseudonymous safety ID is refused before admission.
      Also exercise the category-only report action; it adds that participant to
      the local block list and a successfully accepted installed-app report
      invalidates the reported current room on the backend.
- [ ] Current Data safety, target audience/content rating, ads, and other App
      content declarations in Play Console based on `STORE-DECLARATIONS.md`.
- [ ] Enter the final production external account-deletion URL ending in
      `/delete-account.html` in the account deletion / Data safety area when
      requested by Play Console.

## Public support contact

Before App Store submission, publish a dedicated product-support contact on the
production `/support` page. The support URL must lead to real contact information.
The repository deliberately does not infer this from Git author/commit metadata.

Required owner-supplied values:

- [ ] Public support email or equivalent product-support contact.
- [ ] Any legal address / phone information required for the countries where the
      app will be distributed.
- [ ] Confirm the support contact is monitored and can receive reviewer/user
      messages.
- [ ] Confirm access-loss account requests can be handled privately without asking
      the user to publish account-identifying information in a public tracker.

## Production URL gate

Before entering any URL in either store console:

- [ ] Confirm the exact production public origin.
- [ ] Confirm `/privacy`, `/terms`, `/support`, and `/delete-account.html` return
      200 from that origin without authentication.
- [ ] Confirm Android `assetlinks.json` and Apple AASA are valid for the same host.
- [ ] Confirm every enabled OAuth provider callback is registered for that origin.
- [ ] Confirm the mobile runtime bootstrap reports that same `public_origin`.
- [ ] Confirm the native build was synced after the final origin was selected.

## Never commit

Keep these outside the repository:

- Demo/reviewer account passwords or recovery codes.
- Apple private keys, App Store Connect keys, signing certificates/passwords.
- Google Play service-account JSON.
- OAuth client secrets.
- Production report-admin credentials or TURN secrets.
