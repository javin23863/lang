import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../../windows/static/qr.js", import.meta.url),
  "utf8",
);

class MockTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }
  dispatch(type, event = {}) {
    event.type ||= type;
    for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, event);
  }
}

class MockWebSocket extends MockTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = MockWebSocket.CONNECTING;
  }
}

class MockRTCPeerConnection {}

class MockTrack {
  constructor(kind) {
    this.kind = kind;
    this.enabled = true;
    this.readyState = "live";
    this.stopCount = 0;
    this.onended = null;
  }
  stop() {
    this.stopCount++;
    this.readyState = "ended";
  }
}

class MockStream {
  constructor(...tracks) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
  addTrack(track) {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }
  removeTrack(track) {
    this.tracks = this.tracks.filter(candidate => candidate !== track);
  }
}

function element() {
  const target = new MockTarget();
  target.disabled = false;
  target.className = "";
  target.hidden = false;
  target.attributes = new Map();
  target.classList = {
    values: new Set(),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    contains(value) { return this.values.has(value); },
  };
  target.setAttribute = (name, value) => target.attributes.set(name, String(value));
  return target;
}

function harness() {
  const pendingMedia = [];
  const platformGetUserMedia = constraints =>
    new Promise((resolve, reject) => pendingMedia.push({constraints, resolve, reject}));

  const windowTarget = new MockTarget();
  windowTarget.fetch = async () => ({ok: true, status: 200});
  windowTarget.WebSocket = MockWebSocket;
  windowTarget.RTCPeerConnection = MockRTCPeerConnection;
  windowTarget.LinguaNative = undefined;
  windowTarget.setTimeout = () => 1;
  windowTarget.clearTimeout = () => {};

  const navigatorTarget = {
    mediaDevices: {getUserMedia: platformGetUserMedia},
  };

  const elements = new Map([
    ["roleLocaleSel", element()],
    ["joinBtn", element()],
    ["roleCapability", element()],
    ["camBtn", element()],
    ["leaveBtn", element()],
    ["reportBtn", element()],
    ["qrBtn", element()],
  ]);
  const qrCore = new MockTarget();
  const document = new MockTarget();
  document.visibilityState = "visible";
  document.getElementById = id => elements.get(id) || null;
  document.createElement = tag => {
    assert.equal(tag, "script");
    return qrCore;
  };
  document.head = {appendChild() {}};

  const context = vm.createContext({
    window: windowTarget,
    navigator: navigatorTarget,
    document,
    location: {
      pathname: "/room/example",
      origin: "https://room.test",
      href: "https://room.test/room/example",
    },
    URL,
    Request,
    AbortController,
    DOMException,
    EventTarget,
    MediaStream: MockStream,
    Date,
    Map,
    Promise,
    queueMicrotask,
    setTimeout,
    clearTimeout,
  });

  vm.runInContext(`
    let leaving = false;
    let explicitLeave = false;
    let terminalRoom = false;
    let mediaStream = null;
    let audioMediaPromise = null;
    let videoMediaPromise = null;
    let camOn = false;
    const peers = new Map();
    const statuses = [];

    function combinedMediaStream() {
      if (!mediaStream) mediaStream = new MediaStream();
      return mediaStream;
    }

    function getAudioMedia() {
      if (!audioMediaPromise) {
        audioMediaPromise = navigator.mediaDevices.getUserMedia({audio: true, video: false})
          .then(captured => {
            const stream = combinedMediaStream();
            captured.getAudioTracks().forEach(track => {
              track.onended = () => {
                stream.removeTrack(track);
                audioMediaPromise = null;
              };
              stream.addTrack(track);
            });
            return stream;
          }).catch(error => {
            audioMediaPromise = null;
            throw error;
          });
      }
      return audioMediaPromise;
    }

    function getVideoMedia() {
      if (!videoMediaPromise) {
        videoMediaPromise = navigator.mediaDevices.getUserMedia({audio: false, video: true})
          .then(captured => {
            const stream = combinedMediaStream();
            captured.getVideoTracks().forEach(track => {
              track.onended = () => {
                stream.removeTrack(track);
                videoMediaPromise = null;
                camOn = false;
                document.getElementById("camBtn").className = "icon off";
              };
              stream.addTrack(track);
            });
            return stream;
          }).catch(error => {
            videoMediaPromise = null;
            throw error;
          });
      }
      return videoMediaPromise;
    }

    function addTracks() {}
    function setStatus(key) { statuses.push(key); }

    document.getElementById("camBtn").onclick = async () => {
      if (camOn) {
        camOn = false;
        if (mediaStream) mediaStream.getVideoTracks().forEach(track => { track.enabled = false; });
        document.getElementById("camBtn").className = "icon off";
        return;
      }
      try {
        await getVideoMedia();
        camOn = true;
        mediaStream.getVideoTracks().forEach(track => { track.enabled = true; });
        for (const peer of peers.values()) addTracks(peer.pc);
        document.getElementById("camBtn").className = "icon";
      } catch (_) {
        camOn = false;
        document.getElementById("camBtn").className = "icon off";
        setStatus("status.cameraUnavailable", null, true);
      }
    };

    function disconnectRoom() {
      leaving = true;
      if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
      audioMediaPromise = null;
      videoMediaPromise = null;
      camOn = false;
      document.getElementById("camBtn").className = "icon off";
    }

    function directDisconnectForTest() { disconnectRoom(false); }
    function restoreRoomForTest() { leaving = false; }
    function getAudioMediaForTest() { return getAudioMedia(); }
    function getVideoMediaForTest() { return getVideoMedia(); }
    function roomMediaStateForTest() {
      return {
        camOn,
        camClass: document.getElementById("camBtn").className,
        statuses: [...statuses],
      };
    }
  `, context, {filename: "room-media-owner-globals.js"});

  vm.runInContext(source, context, {filename: "qr.js"});

  return {
    context,
    pendingMedia,
    camButton: elements.get("camBtn"),
    state: () => context.roomMediaStateForTest(),
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("stale camera rejection cannot clear or repaint a fresh restored camera", async () => {
  const h = harness();
  const oldAction = h.camButton.onclick();
  assert.equal(h.pendingMedia.length, 1);

  h.context.directDisconnectForTest();
  h.context.restoreRoomForTest();
  const freshAction = h.camButton.onclick();
  assert.equal(h.pendingMedia.length, 2);

  const freshTrack = new MockTrack("video");
  const freshRaw = new MockStream(freshTrack);
  h.pendingMedia[1].resolve(freshRaw);
  await freshAction;
  assert.equal(h.state().camOn, true);
  assert.equal(h.state().camClass, "icon");

  const oldTrack = new MockTrack("video");
  h.pendingMedia[0].resolve(new MockStream(oldTrack));
  await oldAction;
  await settle();

  assert.equal(oldTrack.stopCount, 1, "stale platform capture is physically stopped");
  assert.equal(h.state().camOn, true, "old rejection cannot turn the fresh camera off");
  assert.equal(h.state().camClass, "icon");
  assert.deepEqual(h.state().statuses, []);

  await h.camButton.onclick();
  await h.camButton.onclick();
  assert.equal(h.pendingMedia.length, 2,
    "old promise cleanup cannot make the fresh generation acquire a duplicate camera");
});

test("stale audio rejection cannot clear fresh media promise ownership", async () => {
  const h = harness();
  const oldAudio = h.context.getAudioMediaForTest();
  assert.equal(h.pendingMedia.length, 1);

  h.context.directDisconnectForTest();
  h.context.restoreRoomForTest();
  const freshAudio = h.context.getAudioMediaForTest();
  assert.equal(h.pendingMedia.length, 2);

  const freshTrack = new MockTrack("audio");
  h.pendingMedia[1].resolve(new MockStream(freshTrack));
  const freshStream = await freshAudio;

  const oldTrack = new MockTrack("audio");
  h.pendingMedia[0].resolve(new MockStream(oldTrack));
  await assert.rejects(oldAudio, error => error?.name === "AbortError");
  assert.equal(oldTrack.stopCount, 1);

  const reused = await h.context.getAudioMediaForTest();
  assert.equal(reused, freshStream);
  assert.equal(h.pendingMedia.length, 2,
    "stale room catch cleanup cannot trigger a duplicate fresh microphone acquisition");
});

test("an ended old-generation track cannot clear fresh camera ownership", async () => {
  const h = harness();
  const first = h.context.getVideoMediaForTest();
  const oldTrack = new MockTrack("video");
  h.pendingMedia[0].resolve(new MockStream(oldTrack));
  await first;
  assert.equal(typeof oldTrack.onended, "function");

  h.context.directDisconnectForTest();
  h.context.restoreRoomForTest();
  const freshAction = h.camButton.onclick();
  const freshTrack = new MockTrack("video");
  h.pendingMedia[1].resolve(new MockStream(freshTrack));
  await freshAction;
  assert.equal(h.state().camOn, true);

  oldTrack.onended({type: "ended"});
  assert.equal(h.state().camOn, true);
  assert.equal(h.state().camClass, "icon");

  const reused = await h.context.getVideoMediaForTest();
  assert.equal(reused.getVideoTracks()[0], freshTrack);
  assert.equal(h.pendingMedia.length, 2);
});

test("current-generation camera failure still reports unavailable", async () => {
  const h = harness();
  const action = h.camButton.onclick();
  assert.equal(h.pendingMedia.length, 1);
  h.pendingMedia[0].reject(new DOMException("Permission denied", "NotAllowedError"));
  await action;

  assert.equal(h.state().camOn, false);
  assert.equal(h.state().camClass, "icon off");
  assert.deepEqual(h.state().statuses, ["status.cameraUnavailable"]);
});

test("source pins browser media promise and camera UI ownership to room generation", () => {
  assert.match(source, /const browserMediaTasks = new Map\(\)/);
  assert.match(source, /function lifecycleMediaTask\(kind, roomGetter\)/);
  assert.match(source, /current\?\.generation === generation/);
  assert.match(source, /browserMediaTasks\.get\(kind\)\?\.task === task/);
  assert.match(source, /track\.onended = event => \{/);
  assert.match(source, /generation !== browserRoomGeneration \|\| !browserRoomWorkActive\(\)/);
  assert.match(source, /getAudioMedia = function lifecycleAwareGetAudioMedia/);
  assert.match(source, /getVideoMedia = function lifecycleAwareGetVideoMedia/);
  assert.match(source, /camButton\.onclick = async \(\) => \{/);
  assert.match(source, /await getVideoMedia\(\);[\s\S]*?generation !== browserRoomGeneration/);
  assert.match(source, /setStatus\("status\.cameraUnavailable", null, true\)/);
});
