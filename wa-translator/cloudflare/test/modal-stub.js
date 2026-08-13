export default {
  async fetch(request) {
    if (request.headers.get("Authorization") !== "Bearer test-only-modal-secret") {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/tts") {
      const body = await request.json();
      if (request.method !== "POST"
          || !["en", "es"].includes(body.lang)
          || !["female", "male"].includes(body.voice_style)) {
        return new Response("invalid", { status: 422 });
      }
      const marker = `${body.lang}:${body.voice_style}:${body.text}`;
      return new Response(new TextEncoder().encode("RIFF" + marker), {
        headers: { "Content-Type": "audio/wav", "X-Upstream-Secret": "must-not-leak" }
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
    server.addEventListener("message", event => {
      if (typeof event.data === "string") {
        const control = JSON.parse(event.data);
        if (!init) {
          init = control;
          return;
        }
        if (control.type === "speech_end" && pendingFlush) {
          pendingFlush = false;
          const target = init.source_lang === "en" ? "es" : "en";
          server.send(JSON.stringify({
            type: "caption", seq: 1, final: true, original: "flushed",
            translations: { [target]: "translated flush" }, t_ms: 5
          }));
        }
        return;
      }
      if (!init) return server.close(1008, "start required");
      if (new Uint8Array(event.data)[0] === 7) {
        pendingFlush = true;
        return;
      }
      const target = init.source_lang === "en" ? "es" : "en";
      server.send(JSON.stringify({
        type: "caption",
        speaker: "untrusted-modal-speaker",
        speaker_lang: "untrusted",
        seq: 1,
        final: true,
        original: init.source_lang === "en" ? "hello" : "hola",
        translations: { [target]: target === "es" ? "hola" : "hello" },
        t_ms: 5
      }));
      setTimeout(() => server.close(1012, "simulated process replacement"), 0);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
};
