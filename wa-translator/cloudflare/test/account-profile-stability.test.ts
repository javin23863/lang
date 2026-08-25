import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const USER_ID = "AppleProfileUser123456";
const OTHER_ID = "OtherProfileUser123456";
const BLANK_ID = "BlankProfileUser123456";

function directory(userId = USER_ID) {
  return env.USERS.get(env.USERS.idFromName(userId));
}

async function writeProfile(
  body: Record<string, unknown>, userId = USER_ID
): Promise<Response> {
  return directory(userId).fetch(new Request("https://users.internal/", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  }));
}

describe("stable OAuth account metadata", () => {
  it("requires usable profile metadata on first account creation", async () => {
    const incomplete = await writeProfile({
      user_id: BLANK_ID,
      provider: "apple",
      name: "",
      email: "",
    }, BLANK_ID);
    expect(incomplete.status).toBe(422);

    const complete = await writeProfile({
      user_id: BLANK_ID,
      provider: "apple",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    }, BLANK_ID);
    expect(complete.ok).toBe(true);
  });

  it("preserves established Apple email/name when a later provider refresh omits them", async () => {
    const first = await writeProfile({
      user_id: USER_ID,
      provider: "apple",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    });
    expect(first.ok).toBe(true);

    const later = await writeProfile({
      user_id: USER_ID,
      provider: "apple",
      name: "",
      email: "",
    });
    expect(later.ok).toBe(true);

    const snapshot = await directory().fetch("https://users.internal/");
    expect(snapshot.status).toBe(200);
    const body = await snapshot.json<any>();
    expect(body.profile).toMatchObject({
      user_id: USER_ID,
      provider: "apple",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    });
  });

  it("rejects attempts to mutate provider or derived account id after creation", async () => {
    const initial = await writeProfile({
      user_id: USER_ID,
      provider: "apple",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    });
    expect(initial.ok).toBe(true);

    const changedProvider = await writeProfile({
      user_id: USER_ID,
      provider: "google",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    });
    expect(changedProvider.status).toBe(409);

    const changedId = await writeProfile({
      user_id: OTHER_ID,
      provider: "apple",
      name: "Relay User",
      email: "relay-user@privaterelay.appleid.com",
    });
    expect(changedId.status).toBe(409);
  });
});