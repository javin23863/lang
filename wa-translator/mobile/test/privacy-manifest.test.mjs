import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MANIFEST = new URL("../ios/App/App/PrivacyInfo.xcprivacy", import.meta.url);

function collectedTypes(xml) {
  const entries = new Map();
  const pattern = /<dict>\s*<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>([\s\S]*?)<\/dict>/g;
  for (const match of xml.matchAll(pattern)) {
    const [, type, body] = match;
    assert.ok(!entries.has(type), `privacy manifest duplicates ${type}`);
    entries.set(type, body);
  }
  return entries;
}

function assertType(entries, type, linked) {
  const body = entries.get(type);
  assert.ok(body, `privacy manifest is missing ${type}`);
  assert.match(body,
    new RegExp(`<key>NSPrivacyCollectedDataTypeLinked<\\/key>\\s*<${linked ? "true" : "false"}\\/>`),
    `${type} linked-to-user status must match retained storage behavior`);
  assert.match(body, /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/,
               `${type} must not be used for tracking`);
  assert.match(body,
    /<string>NSPrivacyCollectedDataTypePurposeAppFunctionality<\/string>/,
    `${type} must be collected only for app functionality`);
}

test("iOS first-party privacy manifest matches retained product data", async () => {
  const xml = await readFile(MANIFEST, "utf8");
  assert.match(xml, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  const entries = collectedTypes(xml);

  assert.deepEqual([...entries.keys()].sort(), [
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypeName",
    "NSPrivacyCollectedDataTypeOtherDataTypes",
    "NSPrivacyCollectedDataTypeOtherUsageData",
    "NSPrivacyCollectedDataTypeOtherUserContent",
    "NSPrivacyCollectedDataTypeUserID",
  ]);

  assertType(entries, "NSPrivacyCollectedDataTypeName", true);
  assertType(entries, "NSPrivacyCollectedDataTypeEmailAddress", true);
  assertType(entries, "NSPrivacyCollectedDataTypeUserID", true);
  assertType(entries, "NSPrivacyCollectedDataTypeOtherUsageData", true);
  assertType(entries, "NSPrivacyCollectedDataTypeOtherUserContent", false);
  assertType(entries, "NSPrivacyCollectedDataTypeOtherDataTypes", false);

  assert.doesNotMatch(xml, /NSPrivacyCollectedDataTypeAudioData|NSPrivacyCollectedDataTypeEmailsOrTextMessages/,
                      "ephemeral call/chat content is not retained after real-time request servicing");
});
