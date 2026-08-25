import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Apple one-time user metadata can set display name but never account identity", async () => {
  const mobile = await read("../../cloudflare/src/mobile-entry.ts");
  const directory = await read("../../cloudflare/src/account-directory.ts");

  assert.match(mobile, /const APPLE_CALLBACK_BODY_BYTES = 8192/,
               "the wrapper never reads more Apple callback data than the base OAuth callback accepts");
  assert.match(mobile,
    /readLimited\(request\.clone\(\)\.body, APPLE_CALLBACK_BODY_BYTES\)/,
    "optional Apple metadata is read from a bounded clone so the validated callback still owns the original body");
  assert.match(mobile, /const value = form\.get\("user"\)/);
  assert.match(mobile, /record\.firstName/);
  assert.match(mobile, /record\.lastName/);
  assert.doesNotMatch(mobile, /\(parsed as Record<string, unknown>\)\.email/,
                      "the one-time form email is never used as account email or identity");
  assert.match(mobile, /combined\.length > 80 \|\| \/\[\\u0000-\\u001f\\u007f\]\//,
               "display metadata remains bounded and control-character free");
  assert.match(mobile,
    /const upstream = await routeWorker\(request, env, ctx\);[\s\S]*?const session = extractSession\(upstream\.headers\);[\s\S]*?if \(userId && appleName\) await applyAppleDisplayName/,
    "the display-name patch is impossible until the normal OAuth callback has minted a valid session");
  assert.match(mobile, /https:\/\/users\.internal\/profile-name/);

  assert.match(directory, /url\.pathname !== "\/profile-name"/);
  assert.match(directory, /Object\.keys\(data\)\.join\(","\) !== "name"/,
               "the internal patch accepts exactly one display-name field");
  assert.match(directory, /profile\.provider !== "apple"/,
               "the Apple-only patch cannot mutate another provider's profile");
  assert.match(directory, /profile\.name = name/);
  assert.doesNotMatch(directory,
    /profile\.(?:email|provider|user_id)\s*=\s*name/,
    "display metadata never crosses into identity fields");

  assert.match(directory,
    /data\.provider !== "apple"[\s\S]*?data\.name !== data\.email[\s\S]*?existing\.name === existing\.email/,
    "later Apple callbacks are recognized only when they carry the email-as-name fallback");
  assert.match(directory, /data\.name = existing\.name/,
               "an already-captured Apple display name survives later logins that omit the one-time user payload");
});
