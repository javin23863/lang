import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("OAuth providers remain independently provisioned and Facebook is optional", async () => {
  const [worker, deployment, declarations] = await Promise.all([
    read("../../cloudflare/src/worker.ts"),
    read("../../cloudflare/DEPLOYMENT.md"),
    read("../STORE-DECLARATIONS.md"),
  ]);

  assert.match(worker,
    /if \(env\.GOOGLE_CLIENT_ID && env\.GOOGLE_CLIENT_SECRET\) \{[\s\S]*?providers\.set\("google"/,
    "Google appears only when its complete credential pair exists");
  assert.match(worker,
    /if \(env\.FACEBOOK_APP_ID && env\.FACEBOOK_APP_SECRET\) \{[\s\S]*?providers\.set\("facebook"/,
    "Facebook remains an independently optional provider, not a launch prerequisite");
  assert.match(worker,
    /if \(env\.APPLE_CLIENT_ID && env\.APPLE_KEY_ID && env\.APPLE_PRIVATE_KEY[\s\S]*?env\.MOBILE_APPLE_TEAM_ID\) \{[\s\S]*?providers\.set\("apple"/,
    "Apple appears only when its complete signing configuration exists");
  assert.match(worker, /const providers = \[\.\.\.oauthProviders\(env\)\.keys\(\)\]/,
    "/api/me must expose exactly the providers that are actually provisioned");
  assert.match(worker,
    /const provider = oauthProviders\(env\)\.get\(providerId\);[\s\S]*?if \(!provider\) return new Response\("Unknown sign-in provider", \{[\s\S]*?status: 404/,
    "an unprovisioned provider must have no usable OAuth start route");

  assert.match(deployment,
    /A provider with no secrets is absent: its `\/auth\/<p>\/start` 404s and[\s\S]*?`\/api\/me` never offers its button\. Nothing else degrades\./,
    "operator instructions must keep optional-provider behavior explicit");
  assert.match(declarations,
    /signs in with\s+one of the OAuth providers enabled for that release\.[\s\S]*?supports Google\s+and Apple plus optional Facebook; `\/api\/me` shows only fully configured\s+providers/,
    "store declarations must describe the live configured provider set, not promise Facebook");
  assert.doesNotMatch(declarations, /signs in with\s+Google, Apple, or Facebook/,
    "review paperwork must not present optional Facebook as guaranteed launch functionality");
});
