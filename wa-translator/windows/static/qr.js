(() => {
  "use strict";

  const native = window.LinguaNative?.isNative === true;
  const roomRoute = /^\/room\/[^/]+$/.test(location.pathname);
  const ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000;
  const ROOM_CONTROL_PATHS = new Set([
    "/api/capabilities",
    "/api/turn",
    "/api/room",
    "/api/reports",
  ]);

  // app-runtime.js installs browser ICE/TURN recovery before this deferred
  // bootstrap runs. The shared room document has no connect-generation token,
  // so this browser-only seam also prevents stale async join work from opening
  // signalling again after page suspension or an explicit Leave/End action.
  if (!native && roomRoute && typeof window.fetch === "function") {
    const boundedFetch = window.fetch.bind(window);
    const RoomWebSocket = window.WebSocket;
    const activeControlControllers = new Set();
    let roomSuspended = false;
    let roomLifecycleEnded = false;
    let activeRoomSocket = null;

    function lifecycleAbortError() {
      return new DOMException("Room lifecycle ended", "AbortError");
    }

    function abortControlRequests() {
      for (const controller of activeControlControllers) controller.abort();
      activeControlControllers.clear();
    }

    function endRoomLifecycle() {
      roomLifecycleEnded = true;
      abortControlRequests();
    }

    window.addEventListener("pagehide", () => {
      roomSuspended = true;
      abortControlRequests();
    });
    window.addEventListener("pageshow", event => {
      if (event.persisted && !roomLifecycleEnded) roomSuspended = false;
    });

    const leaveButton = document.getElementById("leaveBtn");
    leaveButton?.addEventListener("click", endRoomLifecycle, {capture: true});
    const reportButton = document.getElementById("reportBtn");
    reportButton?.addEventListener("click", () => {
      // reportAndBlockRoom() disables the button synchronously only after its
      // confirmation succeeds, before its first await. Read that result after
      // the click dispatch so cancelling the confirmation does not end a room.
      queueMicrotask(() => {
        if (reportButton.disabled) endRoomLifecycle();
      });
    }, {capture: true});

    window.fetch = async (input, init = {}) => {
      let url;
      try {
        const target = typeof Request !== "undefined" && input instanceof Request
          ? input.url : input;
        url = new URL(target, location.href);
      } catch {
        return boundedFetch(input, init);
      }

      if (url.origin !== location.origin || !ROOM_CONTROL_PATHS.has(url.pathname)) {
        return boundedFetch(input, init);
      }
      if (roomSuspended || roomLifecycleEnded) throw lifecycleAbortError();

      const callerSignal = init.signal
        || (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
      const controller = new AbortController();
      activeControlControllers.add(controller);
      const abortFromCaller = () => controller.abort();
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener("abort", abortFromCaller, {once: true});
      const timer = setTimeout(() => controller.abort(), ROOM_CONTROL_FETCH_TIMEOUT_MS);

      try {
        return await boundedFetch(input, {...init, signal: controller.signal});
      } finally {
        clearTimeout(timer);
        activeControlControllers.delete(controller);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      }
    };

    if (typeof RoomWebSocket === "function") {
      function closedLifecycleSocket(url) {
        const socket = new EventTarget();
        socket.url = String(url);
        socket.readyState = RoomWebSocket.CLOSED;
        socket.binaryType = "blob";
        socket.bufferedAmount = 0;
        socket.extensions = "";
        socket.protocol = "";
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close = () => {};
        socket.send = () => { throw lifecycleAbortError(); };
        return socket;
      }

      function LifecycleWebSocket(url, protocols) {
        if (roomSuspended || roomLifecycleEnded) return closedLifecycleSocket(url);
        if (activeRoomSocket && activeRoomSocket.readyState < RoomWebSocket.CLOSING) {
          return activeRoomSocket;
        }
        const socket = protocols === undefined
          ? new RoomWebSocket(url)
          : new RoomWebSocket(url, protocols);
        activeRoomSocket = socket;
        socket.addEventListener("close", () => {
          if (activeRoomSocket === socket) activeRoomSocket = null;
        });
        return socket;
      }
      LifecycleWebSocket.prototype = RoomWebSocket.prototype;
      Object.setPrototypeOf(LifecycleWebSocket, RoomWebSocket);
      window.WebSocket = LifecycleWebSocket;
    }
  }

  // Keep /qr.js as the public loader used by existing dashboard/room markup.
  // Disable the user-facing QR control until the unchanged encoder is ready so
  // a slow first fetch cannot turn an early click into a LinguaQR reference error.
  const qrButton = document.getElementById("qrBtn");
  if (qrButton) qrButton.disabled = true;
  const qrCore = document.createElement("script");
  qrCore.src = "/qr-encoder.js";
  qrCore.async = false;
  qrCore.addEventListener("load", () => {
    if (qrButton) qrButton.disabled = false;
  }, {once: true});
  document.head.appendChild(qrCore);
})();
