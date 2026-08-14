const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function worklet() {
  let Processor;
  const posted = [];
  class FakeAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: value => posted.push(value),
      };
    }
  }
  const source = fs.readFileSync(
    path.join(__dirname, 'static', 'pcm-worklet.js'), 'utf8');
  vm.runInNewContext(source, {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    Float32Array,
    Int16Array,
    Math,
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    sampleRate: 48_000,
  });
  return { processor: new Processor(), posted };
}

const block = () => [[new Float32Array(128).fill(0.2)]];

test('unmuting discards the muted interval instead of bursting stale PCM', () => {
  const { processor, posted } = worklet();
  for (let index = 0; index < Math.ceil(10 * 48_000 / 128); index++) {
    processor.process(block());
  }
  assert.equal(posted.length, 0);

  processor.port.onmessage({ data: { on: true } });
  processor.process(block());
  assert.equal(posted.length, 0,
    'one 128-sample callback cannot legitimately produce a 1600-sample PCM frame');
});

test('unmuted capture still emits bounded 100ms frames', () => {
  const { processor, posted } = worklet();
  processor.port.onmessage({ data: { on: true } });
  for (let index = 0; index < 40; index++) processor.process(block());
  assert.equal(posted.length, 1);
  assert.equal(posted[0].byteLength, 3200);
});
