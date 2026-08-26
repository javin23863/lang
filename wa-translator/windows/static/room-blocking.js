(() => {
  "use strict";

  const BLOCK_ID_KEY = "lingua-relay.block-id.v1";
  const BLOCKED_IDS_KEY = "lingua-relay.blocked-participants.v1";
  const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const BLOCK_LIST_LIMIT = 128;
  const roomSockets = new Set();
  const peerBlocks = new Map();
  let blockButton = null;

  function base64url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function newBlockId() {
    return base64url(crypto.getRandomValues(new Uint8Array(16)));
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function ownBlockId() {
    const existing = storageGet(BLOCK_ID_KEY);
    if (existing && BLOCK_ID_PATTERN.test(existing)) return existing;
    const created = newBlockId();
    storageSet(BLOCK_ID_KEY, created);
    return created;
  }

  function loadBlockedIds() {
    try {
      const parsed = JSON.parse(storageGet(BLOCKED_IDS_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      const unique = [];
      const seen = new Set();
      for (const value of parsed) {
        if (typeof value !== "string" || !BLOCK_ID_PATTERN.test(value) || seen.has(value)) continue;
        seen.add(value);
        unique.push(value);
      }
      return unique.slice(-BLOCK_LIST_LIMIT);
    } catch (_) {
      return [];
    }
  }

  const myBlockId = ownBlockId();
  let blockedIds = loadBlockedIds();
  let blockedSet = new Set(blockedIds);

  function persistBlockedIds() {
    blockedIds = blockedIds.filter(value => value !== myBlockId).slice(-BLOCK_LIST_LIMIT);
    blockedSet = new Set(blockedIds);
    storageSet(BLOCKED_IDS_KEY, JSON.stringify(blockedIds));
  }

  function rememberBlockedId(value) {
    if (!BLOCK_ID_PATTERN.test(value || "") || value === myBlockId) return false;
    blockedIds = blockedIds.filter(item => item !== value);
    blockedIds.push(value);
    persistBlockedIds();
    updateBlockButton();
    return true;
  }

  function currentPeerBlockId() {
    for (const value of peerBlocks.values()) {
      if (BLOCK_ID_PATTERN.test(value)) return value;
    }
    return null;
  }

  function markCurrentRoomBlocked() {
    try {
      const token = window.LinguaRuntime?.roomToken?.();
      if (typeof token === "string" && token) {
        storageSet(`lingua-relay.blocked-room.${token}`, "1");
      }
    } catch (_) {}
  }

  function updateBlockButton() {
    if (blockButton) blockButton.disabled = !currentPeerBlockId();
  }

  function leaveBlockedRoom() {
    markCurrentRoomBlocked();
    try {
      if (typeof window.leaveRoom === "function") {
        window.leaveRoom();
      } else {
        for (const socket of roomSockets) {
          try { socket.close(1000, "participant blocked"); } catch (_) {}
        }
      }
    } finally {
      try {
        if (typeof window.setStatus === "function") window.setStatus("gate.blocked", null, true);
      } catch (_) {}
    }
  }

  function participantMessages(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    if (message.type === "welcome" && Array.isArray(message.peers)) return message.peers;
    if (message.type === "peer_join" || message.type === "peer_update") return [message];
    if (message.type === "signal" && typeof message.from === "string") {
      return [{id: message.from, block_id: message.from_block_id}];
    }
    if ((message.type === "caption" || message.type === "chat")
        && typeof message.speaker === "string") {
      return [{id: message.speaker, block_id: message.speaker_block_id}];
    }
    return [];
  }

  function observePeerState(message) {
    if (message?.type === "peer_leave" && typeof message.id === "string") {
      peerBlocks.delete(message.id);
      updateBlockButton();
      return false;
    }
    let blocked = message?.type === "peer_blocked";
    for (const peer of participantMessages(message)) {
      if (!peer || typeof peer !== "object" || Array.isArray(peer)) continue;
      if (typeof peer.id !== "string" || !BLOCK_ID_PATTERN.test(peer.block_id || "")) continue;
      peerBlocks.set(peer.id, peer.block_id);
      if (blockedSet.has(peer.block_id)) blocked = true;
    }
    updateBlockButton();
    return blocked;
  }

  function roomSocketUrl(value) {
    try {
      const path = new URL(String(value), location.href).pathname;
      return /^\/ws\/(?:v1\/)?[^/]+$/.test(path);
    } catch (_) {
      return false;
    }
  }

  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === "function") {
    class BlockingWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        if (protocols === undefined) super(url); else super(url, protocols);
        this.__linguaRoomSocket = roomSocketUrl(url);
        if (!this.__linguaRoomSocket) return;
        roomSockets.add(this);
        this.addEventListener("message", event => {
          if (typeof event.data !== "string") return;
          let message;
          try { message = JSON.parse(event.data); } catch (_) { return; }
          if (!observePeerState(message)) return;
          event.stopImmediatePropagation();
          leaveBlockedRoom();
        });
        this.addEventListener("close", () => roomSockets.delete(this));
      }

      send(data) {
        if (this.__linguaRoomSocket && typeof data === "string") {
          try {
            const message = JSON.parse(data);
            if (message && typeof message === "object" && !Array.isArray(message)
                && message.type === "join") {
              message.block_id = myBlockId;
              message.blocked_ids = blockedIds.slice(-BLOCK_LIST_LIMIT);
              return super.send(JSON.stringify(message));
            }
          } catch (_) {}
        }
        return super.send(data);
      }
    }
    window.WebSocket = BlockingWebSocket;
  }

  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = async function(input, init) {
      let reportRequest = false;
      try {
        const requestUrl = input instanceof Request ? input.url : String(input);
        const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        const path = new URL(requestUrl, location.href).pathname;
        reportRequest = method === "POST" && (path === "/api/reports" || path === "/api/v1/reports");
      } catch (_) {}
      try {
        return await nativeFetch(input, init);
      } finally {
        if (reportRequest) {
          const peer = currentPeerBlockId();
          if (peer) rememberBlockedId(peer);
        }
      }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const report = document.getElementById("reportBtn");
    const menu = document.getElementById("roomMenu");
    if (!report || !menu || document.getElementById("blockParticipantBtn")) return;
    blockButton = document.createElement("button");
    blockButton.id = "blockParticipantBtn";
    blockButton.type = "button";
    blockButton.textContent = "Block participant";
    blockButton.setAttribute("aria-label", "Block participant on this device");
    blockButton.style.gridColumn = "1 / -1";
    blockButton.style.background = "transparent";
    blockButton.style.color = "var(--destructive)";
    blockButton.style.fontSize = "17px";
    blockButton.style.fontWeight = "400";
    blockButton.style.borderRadius = "10px";
    blockButton.style.width = "100%";
    blockButton.disabled = !currentPeerBlockId();
    blockButton.addEventListener("click", () => {
      const peer = currentPeerBlockId();
      if (!peer) return;
      if (typeof confirm === "function"
          && !confirm("Block this participant on this device and leave the room?")) return;
      rememberBlockedId(peer);
      leaveBlockedRoom();
    });
    menu.insertBefore(blockButton, report);
  });

  window.LinguaRoomBlocking = Object.freeze({
    blockId: myBlockId,
    blockedIds: () => [...blockedIds],
    isBlocked: value => blockedSet.has(value),
    block: rememberBlockedId,
  });
})();
