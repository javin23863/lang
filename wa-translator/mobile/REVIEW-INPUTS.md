# Store review operator inputs

This file lists submission information that cannot be derived safely from source code.
Do not put passwords, OAuth credentials, API keys, private phone numbers, or other
review secrets in Git. Enter sensitive values directly in App Store Connect / Play
Console or the team's approved secret manager.

## Public console URLs

Use these production destinations when the store consoles ask for public pages:

- Marketing / web app: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/`
- Privacy policy: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/privacy`
- Terms: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/terms`
- Support: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/support`
- External account deletion: `https://spoken-translation-room.spoken-translation-cloudflare.workers.dev/support#delete`

The deletion destination explains the authenticated browser deletion flow. A user who
can sign in with the account's provider can delete immediately from the same web app.
Do not route access-loss requests through the public GitHub issue tracker; a dedicated
private support contact remains a pre-submission requirement below.

## Apple App Review

Before submitting version 1.0, the account owner must provide:

- [ ] Review contact first and last name.
- [ ] Review contact email address.
- [ ] Review contact phone number in international format.
- [ ] Review notes explaining the two-person flow: a signed-in host creates a
      private room; the invited participant joins the HTTPS room link without an
      account; camera/microphone access begins only after the participant joins.
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
      using the private room link created by the reviewer.
- [ ] Current Data safety, target audience/content rating, ads, and other App
      content declarations in Play Console based on `STORE-DECLARATIONS.md`.
- [ ] Enter the external account-deletion URL above in the account deletion / Data
      safety area when requested by Play Console.

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

## Never commit

Keep these outside the repository:

- Demo/reviewer account passwords or recovery codes.
- Apple private keys, App Store Connect keys, signing certificates/passwords.
- Google Play service-account JSON.
- OAuth client secrets.
- Production report-admin credentials or TURN secrets.
