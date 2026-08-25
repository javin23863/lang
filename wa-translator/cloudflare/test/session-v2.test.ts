import { describe, expect, it } from "vitest";
import {
  SESSION_V1_PATTERN, SESSION_V2_PATTERN, inspectSessionToken, mintSessionV2, upgradeSessionV1,
} from "../src/session-v2";
import { hostSession } from "./session";

const SECRET = "test-only-room-signing-key-32-bytes";
const USER_ID = "SessionV2User000000001";

function mutateBase64url(value: string): string {
  const last = value.at(-1)!;
  const replacement = last === "A" ? "B" : "A";
  return value.slice(0, -1) + replacement;
}

describe("session v2 token boundary", () => {
  it("mints independent external sessions even when user and expiry are identical", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const first = await mintSessionV2(USER_ID, SECRET, expiresAt);
    const second = await mintSessionV2(USER_ID, SECRET, expiresAt);

    expect(first.token).toMatch(SESSION_V2_PATTERN);
    expect(second.token).toMatch(SESSION_V2_PATTERN);
    expect(first.token).not.toBe(second.token);

    const firstIdentity = await inspectSessionToken(first.token, SECRET);
    const secondIdentity = await inspectSessionToken(second.token, SECRET);
    expect(firstIdentity).not.toBeNull();
    expect(secondIdentity).not.toBeNull();
    expect(firstIdentity!.userId).toBe(USER_ID);
    expect(secondIdentity!.userId).toBe(USER_ID);
    expect(firstIdentity!.expiresAt).toBe(expiresAt);
    expect(secondIdentity!.expiresAt).toBe(expiresAt);
    expect(firstIdentity!.digest).not.toBe(secondIdentity!.digest);
    // The legacy representation is deliberately internal-only and can collapse;
    // revocation must therefore always use the external digest above.
    expect(firstIdentity!.legacyToken).toBe(secondIdentity!.legacyToken);
  });

  it("rejects nonce/signature tampering and non-canonical tokens", async () => {
    const token = (await mintSessionV2(USER_ID, SECRET)).token;
    const parts = token.split(".");

    const nonceTampered = [...parts];
    nonceTampered[3] = mutateBase64url(nonceTampered[3]);
    expect(await inspectSessionToken(nonceTampered.join("."), SECRET)).toBeNull();

    const signatureTampered = [...parts];
    signatureTampered[4] = mutateBase64url(signatureTampered[4]);
    expect(await inspectSessionToken(signatureTampered.join("."), SECRET)).toBeNull();
    expect(await inspectSessionToken(`${token}=`, SECRET)).toBeNull();
  });

  it("temporarily accepts a valid legacy session and upgrades it without extending expiry", async () => {
    const legacy = await hostSession(USER_ID, 3600);
    expect(legacy).toMatch(SESSION_V1_PATTERN);
    const inspected = await inspectSessionToken(legacy, SECRET);
    expect(inspected).not.toBeNull();
    expect(inspected!.version).toBe(1);
    expect(inspected!.legacyToken).toBe(legacy);

    const upgraded = await upgradeSessionV1(legacy, SECRET);
    expect(upgraded).toMatch(SESSION_V2_PATTERN);
    const upgradedIdentity = await inspectSessionToken(upgraded!, SECRET);
    expect(upgradedIdentity!.version).toBe(2);
    expect(upgradedIdentity!.userId).toBe(USER_ID);
    expect(upgradedIdentity!.expiresAt).toBe(inspected!.expiresAt);
  });
});
