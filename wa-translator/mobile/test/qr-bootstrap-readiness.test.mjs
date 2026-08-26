import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bootstrap = new URL("../../windows/static/qr.js", import.meta.url);
const encoder = new URL("../../windows/static/qr-encoder.js", import.meta.url);

test("QR bootstrap keeps the control unavailable until the unchanged encoder loads", async () => {
  const source = await readFile(bootstrap, "utf8");
  const encoderSource = await readFile(encoder, "utf8");

  assert.match(source, /const qrButton = document\.getElementById\("qrBtn"\)/);
  assert.match(source, /if \(qrButton\) qrButton\.disabled = true/,
    "a slow first encoder fetch cannot expose a crashing QR action");
  assert.match(source, /qrCore\.src = "\/qr-encoder\.js"/);
  assert.match(source, /qrCore\.addEventListener\("load", \(\) => \{/);
  assert.match(source, /if \(qrButton\) qrButton\.disabled = false/,
    "the QR action is restored only after encoder readiness");
  assert.match(source, /\}, \{once: true\}\)/);
  assert.match(encoderSource, /window\.LinguaQR = \{svg: svg, _matrix: matrix\}/,
    "the split retains the original synchronous LinguaQR surface");
});
