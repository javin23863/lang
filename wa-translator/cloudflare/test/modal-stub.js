export default {
  async fetch(request) {
    if (request.headers.get("Authorization") !== "Bearer test-only-modal-secret") {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/tts") {
      const body = await request.json();
      const voiceProfiles = {
        "en-us-af-heart": true,
        "en-us-am-michael": true,
        "en-gb-bf-emma": true,
        "en-gb-bm-fable": true,
        "es-ef-dora": true,
        "es-em-alex": true,
        "fr-ff-siwis": true,
        "ja-jf-alpha": true,
        "ja-jm-kumo": true,
      };
      if (request.method !== "POST"
          || !voiceProfiles[body.voice_profile]
          || Object.keys(body).some(key => !["text", "voice_profile"].includes(key))) {
        return new Response("invalid", { status: 422 });
      }
      const streamed = (value, length) => {
        const stream = length === undefined
          ? new TransformStream() : new FixedLengthStream(length);
        const writer = stream.writable.getWriter();
        void writer.write(new TextEncoder().encode(value))
          .then(() => writer.close()).catch(() => writer.abort().catch(() => {}));
        return stream.readable;
      };
      if (body.text === "fixture-missing-length") {
        return new Response(streamed("RIFFmissing"), {
          headers: { "Content-Type": "audio/wav" }
        });
      }
      if (body.text === "fixture-oversize-length") {
        return new Response(streamed("RIFFoversize", 4194305), {
          headers: { "Content-Type": "audio/wav", "Content-Length": "4194305" }
        });
      }
      if (body.text === "fixture-non-riff") {
        return new Response(new TextEncoder().encode("NOPEaudio"), {
          headers: { "Content-Type": "audio/wav" }
        });
      }
      if (body.text === "fixture-truncated") {
        return new Response(streamed("RIFFtiny", 100), {
          headers: { "Content-Type": "audio/wav", "Content-Length": "100" }
        });
      }
      const marker = `${body.voice_profile}:${body.text}`;
      const audio = new TextEncoder().encode("RIFF" + marker);
      return new Response(audio, {
        headers: {
          "Content-Type": "audio/wav", "Content-Length": String(audio.byteLength),
          "X-Upstream-Secret": "must-not-leak"
        }
      });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let init = null;
    let pendingFlush = false;
    let capacityRefused = false;
    server.addEventListener("message", event => {
      if (typeof event.data === "string") {
        const control = JSON.parse(event.data);
        if (!init) {
          init = control;
          if (init.source_lang === "de") {
            capacityRefused = true;
            server.send(JSON.stringify({
              type: "stream_status", status: "capacity", scope: "global",
              retry_after_ms: 1000
            }));
            server.close(1013, "stream capacity reached");
          }
          return;
        }
        if (control.type === "speech_end" && pendingFlush) {
          pendingFlush = false;
          const targets = init.target_langs || [];
          server.send(JSON.stringify({
            type: "caption", seq: 1, final: true, original: "flushed",
            translations: Object.fromEntries(targets.map(target =>
              [target, `translated-${target}-flush`])), t_ms: 5
          }));
        }
        return;
      }
      if (capacityRefused) return;
      if (!init) return server.close(1008, "start required");
      if (new Uint8Array(event.data)[0] === 7) {
        pendingFlush = true;
        return;
      }
      const targets = init.target_langs || [];
      server.send(JSON.stringify({
        type: "caption",
        speaker: "untrusted-modal-speaker",
        speaker_lang: "untrusted",
        seq: 1,
        final: true,
        original: init.source_lang === "en" ? "hello" : "hola",
        translations: Object.fromEntries(targets.map(target =>
          [target, target === "es" ? "hola" : `translated-${target}`])),
        t_ms: 5
      }));
      setTimeout(() => server.close(1012, "simulated process replacement"), 0);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
};
