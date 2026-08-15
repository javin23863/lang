// Minimal Chrome DevTools Protocol driver: launch a real Chrome, drive a real
// page, take real screenshots. No test framework, no browser download.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = process.env.LINGUA_CHROME
  || "C:/Program Files/Google/Chrome/Application/chrome.exe";

export async function launch({ port = 9333, headless = true } = {}) {
  const profile = await mkdtemp(path.join(tmpdir(), "lingua-cdp-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--disable-sync", "--mute-audio",
    // The room asks for a microphone and a camera; grant fake ones so the real
    // user path runs end to end instead of stalling on a permission prompt.
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ];
  if (headless) args.unshift("--headless=new", "--disable-gpu");
  const chrome = spawn(CHROME, args, { stdio: "ignore", detached: false });

  let target = null;
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = list.find(t => t.type === "page" && t.webSocketDebuggerUrl);
    } catch { /* not listening yet */ }
  }
  if (!target) { chrome.kill(); throw new Error("Chrome never exposed a debuggable page"); }
  return { chrome, port, wsUrl: target.webSocketDebuggerUrl };
}

export async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.method ?? ""})`));
      else resolve(message.result);
      return;
    }
    events.push(message);
    for (const listener of listeners) listener(message);
  });

  function send(method, params = {}) {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  const page = {
    send,
    events,
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    close: () => socket.close(),

    async ready(origin) {
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Log.enable");
      await send("Network.enable");
      if (origin) await page.grantMedia(origin);
    },

    // The command-line fake-device flags supply the hardware; the permission
    // itself still has to be granted, or getUserMedia rejects exactly as it
    // would for a person who tapped "Block".
    async grantMedia(origin) {
      await send("Browser.grantPermissions", {
        origin,
        permissions: ["audioCapture", "videoCapture"],
      });
    },

    async viewport(width, height, mobile = true) {
      await send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 2, mobile,
        screenWidth: width, screenHeight: height,
      });
    },

    async language(tag) {
      await send("Emulation.setLocaleOverride", { locale: tag });
      await send("Network.setUserAgentOverride", {
        userAgent: await page.eval("navigator.userAgent"),
        acceptLanguage: tag,
      });
    },

    async goto(url) {
      const loaded = new Promise((resolve) => {
        const stop = page.on((message) => {
          if (message.method === "Page.loadEventFired") { stop(); resolve(); }
        });
      });
      await send("Page.navigate", { url });
      await loaded;
      await settle(page);
    },

    async eval(expression, { awaitPromise = true } = {}) {
      const result = await send("Runtime.evaluate", {
        expression, awaitPromise, returnByValue: true, userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description
                        ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },

    // A real tap, dispatched at the element's own centre, so anything that
    // depends on a user gesture (audio unlock, share, permissions) behaves as
    // it does for a person holding the phone.
    async tap(selector) {
      const box = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height};
      })()`);
      if (!box) throw new Error(`no element for ${selector}`);
      if (box.w === 0 || box.h === 0) throw new Error(`${selector} has no size`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type, x: box.x, y: box.y, button: "left", clickCount: 1,
        });
      }
      await settle(page);
      return box;
    },

    async select(selector, value) {
      await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', {bubbles: true}));
        return el.value;
      })()`);
      await settle(page);
    },

    async shot(file) {
      await mkdir(path.dirname(file), { recursive: true });
      const { data } = await send("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: false,
      });
      await writeFile(file, Buffer.from(data, "base64"));
      return file;
    },

    consoleErrors() {
      return events
        .filter(e => e.method === "Runtime.exceptionThrown"
          || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
          || (e.method === "Log.entryAdded" && e.params.entry.level === "error"))
        .map(e => e.params.exceptionDetails?.exception?.description
          ?? e.params.entry?.text
          ?? (e.params.args ?? []).map(a => a.value ?? a.description).join(" "));
    },

    failedRequests() {
      return events.filter(e => e.method === "Network.loadingFailed")
        .map(e => e.params.errorText);
    },
  };
  return page;
}

async function settle(page) {
  await page.eval("new Promise(r => requestAnimationFrame(() => setTimeout(r, 250)))");
}

export async function open({ port = 9333, headless = true, origin } = {}) {
  const { chrome, wsUrl } = await launch({ port, headless });
  const page = await connect(wsUrl);
  await page.ready(origin);
  return { page, close: () => { page.close(); chrome.kill(); } };
}
