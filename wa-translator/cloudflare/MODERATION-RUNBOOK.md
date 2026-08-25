# Lingua Relay moderation runbook

Lingua Relay version 1.0 deliberately keeps moderation data small. A report
contains only its category, platform, creation time, an opaque room reference,
and (while the room can still be closed) internal routing metadata. It does not
contain free text, names, participant links, messages, captions, audio, video,
or screenshots.

## Operator setup

Set these values in the operator shell. Do not commit them and do not put the
admin token in shell arguments, screenshots, tickets, or chat messages.

```text
LINGUA_PUBLIC_ORIGIN=https://<production-origin>
MOBILE_REPORT_ADMIN_TOKEN=<production-admin-token>
```

List the private queue:

```text
npm run reports:list
```

Close the still-live room associated with one report:

```text
npm run reports:close -- <report-id>
```

The command deliberately cannot fetch transcripts or conversation content;
that data is not stored. A report whose room-routing metadata has already
expired cannot be used to close the old room and returns a not-found/no-longer-
available result rather than exposing historical routing data.

## Triage target

These are internal operating targets, not promises that expand what the app
collects:

- `threat`, `sexual`, and `hate`: review as soon as practicable, target within
  4 hours while the reported room can still be closed.
- `harassment` and `scam`: target review within 24 hours.
- `other`: target review within 24 hours and classify operationally without
  adding free-text report collection.

When a report credibly indicates immediate abuse and the room is still live,
close it with the report ID. If a report cannot be resolved from the minimized
record alone, do not invent conversation evidence or ask an operator to access
content the service does not retain.

## Retention and access

- Category report records are retained for at most 30 days.
- Internal room-routing fields are removed when the room expires, no later than
  24 hours after creation.
- The admin token is a production secret and should be rotated if exposed.
- Queue access is an operator action; never embed the admin token in a client,
  mobile build, public page, analytics system, or support workflow.
- Public support requests must not ask users to paste room links or private
  conversation content into a public issue.

## Release gate

Before public store submission, assign a monitored operator/on-call owner for
this queue and verify the production token/origin with `reports:list`. This is
separate from the public support contact required by the store listing.
