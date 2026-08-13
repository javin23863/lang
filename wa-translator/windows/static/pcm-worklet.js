// pcm-worklet.js — microphone -> 16kHz mono int16 frames for the ASR feed.
//
// Runs on the audio thread, so a busy main thread (video repaint, caption
// rendering) cannot stall capture. Replaces createScriptProcessor, which is
// deprecated and ran on the main thread.
//
// Downsampling here rather than on the server cuts the uplink from ~192 KB/s
// (48kHz float32) to ~32 KB/s — which matters, because the other person is on
// a phone sharing that uplink with their WebRTC video.

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100ms at 16kHz

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // sampleRate is the context's, e.g. 48000
    this.pos = 0;        // fractional read position into the incoming stream
    this.consumed = 0;   // samples of input already retired
    this.out = new Int16Array(FRAME_SAMPLES);
    this.n = 0;
    this.muted = true;
    this.port.onmessage = (e) => { this.muted = !e.data.on; };
  }

  process(inputs) {
    const chan = inputs[0] && inputs[0][0];
    if (!chan) return true;
    if (this.muted) {
      // Retire muted input completely. Leaving `pos` behind makes the first
      // callback after unmute replay the whole muted interval as a burst of
      // zero/stale PCM frames; the public room then correctly closes the
      // socket for exceeding its microphone byte-rate ceiling.
      this.consumed += chan.length;
      this.pos = this.consumed;
      this.n = 0;
      return true;
    }

    // Linear interpolation between the two nearest input samples. Plain
    // decimation aliases badly on speech and whisper hears the artefacts.
    while (this.pos < this.consumed + chan.length - 1) {
      const idx = this.pos - this.consumed;
      const i0 = Math.floor(idx);
      const frac = idx - i0;
      const s = chan[i0] * (1 - frac) + chan[i0 + 1] * frac;
      this.out[this.n++] = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
      if (this.n === FRAME_SAMPLES) {
        const frame = this.out.slice();
        this.port.postMessage(frame.buffer, [frame.buffer]);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.consumed += chan.length;
    return true;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
