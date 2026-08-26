(() => {
  "use strict";

  const native = window.LinguaNative?.isNative === true;
  const roomRoute = /^\/room\/[^/]+$/.test(location.pathname);
  const ROOM_CONTROL_FETCH_TIMEOUT_MS = 12000;
  const CAPABILITY_RETRY_WINDOW_MS = 60 * 1000;
  const CAPABILITY_RETRY_MAX_PER_WINDOW = 3;
  const ROOM_CONTROL_PATHS = new Set([
    "/api/capabilities",
    "/api/turn",
    "/api/room",
    "/api/reports",
  ]);
  const ROOM_CONTROL_JSON_PATHS = new Set(["/api/capabilities", "/api/turn"]);
  const PEER_NETWORK_NOTE_KEYS = new Set(["note.videoSlow", "note.videoFailed"]);
  const browserRoomSupported = native || !roomRoute || (
    typeof window.fetch === "function"
    && typeof window.WebSocket === "function"
    && typeof window.RTCPeerConnection === "function"
  );
  let browserMediaGeneration = 0;
  let browserMediaLifecycleEnded = false;
  let browserRoomGeneration = 0;

  function invalidatePendingBrowserMedia() {
    browserMediaGeneration++;
  }

  function invalidateBrowserRoomGeneration() {
    browserRoomGeneration++;
  }

  function stopCapturedBrowserStream(stream) {
    if (!stream || typeof stream.getTracks !== "function") return;
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch (_) {}
    }
  }

  function browserMediaRequestActive() {
    if (browserMediaLifecycleEnded || !/^\/room\/[^/]+$/.test(location.pathname)) return false;
    if (typeof leaving !== "undefined" && leaving) return false;
    if (typeof explicitLeave !== "undefined" && explicitLeave) return false;
    if (typeof terminalRoom !== "undefined" && terminalRoom) return false;
    return true;
  }

  if (!native && roomRoute && typeof navigator !== "undefined") {
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices && typeof mediaDevices.getUserMedia === "function") {
      const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = async constraints => {
        if (!browserMediaRequestActive()) {
          throw new DOMException("Media request superseded by room teardown", "AbortError");
        }
        const generation = browserMediaGeneration;
        const stream = await originalGetUserMedia(constraints);
        if (generation !== browserMediaGeneration || !browserMediaRequestActive()) {
          // A browser permission prompt can resolve after pagehide, Leave, a
          // host close, or report-and-leave has already torn the room down.
          // Never hand that late stream back to room.html: doing so would let
          // its continuation recreate mediaStream/AudioContext after teardown.
          stopCapturedBrowserStream(stream);
          throw new DOMException("Media request superseded by room teardown", "AbortError");
        }
        return stream;
      };
    }
    if (typeof disconnectRoom === "function") {
      const roomDisconnectRoom = disconnectRoom;
      disconnectRoom = function mediaAwareDisconnectRoom(...args) {
        invalidateBrowserRoomGeneration();
        invalidatePendingBrowserMedia();
        if ((typeof explicitLeave !== "undefined" && explicitLeave)
            || (typeof terminalRoom !== "undefined" && terminalRoom)) {
          browserMediaLifecycleEnded = true;
        }
        return roomDisconnectRoom(...args);
      };
    }
  }

  function renderUnsupportedRoomGate() {
    if (browserRoomSupported || native || !roomRoute
        || typeof gateFailureKey === "undefined") return false;
    gateFailureKey = "gate.updateRequired";
    const roleSelect = document.getElementById("roleLocaleSel");
    const joinButton = document.getElementById("joinBtn");
    const roleCapability = document.getElementById("roleCapability");
    if (roleSelect) roleSelect.disabled = true;
    if (joinButton) joinButton.disabled = true;
    if (roleCapability && typeof t === "function") {
      roleCapability.textContent = t(gateFailureKey);
      roleCapability.classList?.add("warning");
    }
    if (typeof setStatus === "function") setStatus(gateFailureKey, null, true);
    return true;
  }

  if (!browserRoomSupported && !native && roomRoute) {
    // loadCapabilities() can already be in flight before this deferred script
    // executes. Its success path calls updateRoleGate(), so wrap that shared
    // classic-script binding and re-apply transport support after every gate
    // repaint. The capture listener is the hard safety boundary if any other
    // code ever flips the button between paints.
    if (typeof updateRoleGate === "function") {
      const roomUpdateRoleGate = updateRoleGate;
      updateRoleGate = function transportAwareRoleGate(...args) {
        const result = roomUpdateRoleGate(...args);
        renderUnsupportedRoomGate();
        return result;
      };
    }
    const joinButton = document.getElementById("joinBtn");
    joinButton?.addEventListener("click", event => {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      renderUnsupportedRoomGate();
    }, {capture: true});
    renderUnsupportedRoomGate();
    window.addEventListener("online", renderUnsupportedRoomGate);
    window.addEventListener("pageshow", renderUnsupportedRoomGate);
    window.addEventListener("lingua-app-state", event => {
      if (event.detail?.isActive) renderUnsupportedRoomGate();
    });
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible") renderUnsupportedRoomGate();
    });
  }

  // app-runtime.js installs browser ICE/TURN recovery before this deferred
  // bootstrap runs. The shared room document has no connect-generation token,
  // so this browser-only seam also prevents stale async join work from opening
  // signalling again after page suspension or an explicit Leave/End action.
  if (!native && roomRoute && typeof window.fetch === "function") {
    const boundedFetch = window.fetch.bind(window);
    const RoomWebSocket = window.WebSocket;
    const RoomPeerConnection = window.RTCPeerConnection;
    const activeControlControllers = new Set();
    const peerGenerations = new WeakMap();
    let roomSuspended = false;
    let roomLifecycleEnded = false;
    let activeRoomSocket = null;
    let capabilityRetryPromise = null;
    let capabilityRetryTimer = null;
    let capabilityRetryAttempts = [];
    let browserAudioStartPromise = null;
    let browserAudioStartGeneration = -1;
    let browserTurnRefreshPromise = null;
    let browserTurnRefreshGeneration = -1;

    function lifecycleAbortError() {
      return new DOMException("Room lifecycle ended", "AbortError");
    }

    function peerLifecycleAbortError() {
      const error = new Error("Peer work superseded by room lifecycle");
      error.name = "AbortError";
      error.linguaPeerLifecycle = true;
      return error;
    }

    function audioLifecycleAbortError() {
      const error = new Error("Audio work superseded by room lifecycle");
      error.name = "AbortError";
      error.linguaAudioLifecycle = true;
      return error;
    }

    function connectLifecycleAbortError() {
      const error = new Error("Connect work superseded by room lifecycle");
      error.name = "AbortError";
      error.linguaConnectLifecycle = true;
      return error;
    }

    function browserRoomGenerationActive(generation) {
      if (generation !== browserRoomGeneration || roomSuspended || roomLifecycleEnded) return false;
      if (typeof leaving !== "undefined" && leaving) return false;
      if (typeof explicitLeave !== "undefined" && explicitLeave) return false;
      return true;
    }

    function browserRoomWorkActive() {
      if (!browserRoomGenerationActive(browserRoomGeneration)) return false;
      if (typeof terminalRoom !== "undefined" && terminalRoom) return false;
      return true;
    }

    function peerConnectionActive(pc, generation = peerGenerations.get(pc)) {
      if (generation !== browserRoomGeneration || !browserRoomWorkActive()) return false;
      if (typeof peers === "undefined" || !peers || typeof peers.values !== "function") return true;
      for (const state of peers.values()) {
        if (state?.pc === pc) return true;
      }
      return false;
    }

    function currentPeerNeedsNetworkNote() {
      if (typeof peers === "undefined" || !peers || typeof peers.values !== "function") return true;
      const states = [...peers.values()];
      if (!states.length) return false;
      return !states.some(state => {
        const pc = state?.pc;
        return pc && (pc.iceConnectionState === "connected"
          || pc.iceConnectionState === "completed"
          || pc.connectionState === "connected");
      });
    }

    if (typeof preflightRoom === "function") {
      const roomPreflightRoom = preflightRoom;
      preflightRoom = async function lifecycleAwarePreflightRoom(...args) {
        const generation = browserRoomGeneration;
        if (!browserRoomGenerationActive(generation)) return false;
        const result = await roomPreflightRoom(...args);
        if (!browserRoomGenerationActive(generation)) return false;
        return result;
      };
    }

    if (typeof refreshIceServers === "function") {
      const roomRefreshIceServers = refreshIceServers;
      refreshIceServers = function lifecycleAwareRefreshIceServers(...args) {
        const generation = browserRoomGeneration;
        if (!browserRoomGenerationActive(generation)) {
          return Promise.reject(connectLifecycleAbortError());
        }
        if (browserTurnRefreshPromise && browserTurnRefreshGeneration === generation) {
          return browserTurnRefreshPromise;
        }
        const previousTask = browserTurnRefreshPromise;
        const previousGeneration = browserTurnRefreshGeneration;
        const task = (async () => {
          if (previousTask && previousGeneration !== generation) {
            try {
              await previousTask;
            } catch (error) {
              if (error?.linguaConnectLifecycle !== true) throw error;
            }
            if (!browserRoomGenerationActive(generation)) throw connectLifecycleAbortError();
          }
          await roomRefreshIceServers(...args);
          if (!browserRoomGenerationActive(generation)) throw connectLifecycleAbortError();
        })();
        browserTurnRefreshPromise = task;
        browserTurnRefreshGeneration = generation;
        task.finally(() => {
          if (browserTurnRefreshPromise === task) browserTurnRefreshPromise = null;
        }).catch(() => {});
        return task;
      };
    }

    if (typeof connect === "function") {
      const roomConnect = connect;
      connect = async function lifecycleAwareConnect(...args) {
        const generation = browserRoomGeneration;
        if (!browserRoomGenerationActive(generation)) return;
        try {
          return await roomConnect(...args);
        } catch (error) {
          if (error?.linguaConnectLifecycle === true || generation !== browserRoomGeneration) return;
          throw error;
        }
      };
    }

    if (typeof handle === "function") {
      const roomHandle = handle;
      handle = async function lifecycleAwareRoomHandle(message) {
        if (!browserRoomWorkActive()) return;
        const generation = browserRoomGeneration;
        try {
          return await roomHandle(message);
        } catch (error) {
          if (error?.linguaPeerLifecycle === true || generation !== browserRoomGeneration) return;
          throw error;
        }
      };
    }

    if (typeof send === "function") {
      const roomSend = send;
      send = function lifecycleAwareRoomSend(message) {
        if (message?.type === "signal") {
          if (!browserRoomWorkActive()
              || typeof peers === "undefined" || !peers || typeof peers.get !== "function") return;
          const state = peers.get(message.to);
          if (!state || !peerConnectionActive(state.pc)) return;
        }
        return roomSend(message);
      };
    }

    if (typeof showVideoNote === "function") {
      const roomShowVideoNote = showVideoNote;
      showVideoNote = function lifecycleAwareVideoNote(key, ...args) {
        if (PEER_NETWORK_NOTE_KEYS.has(key)
            && (!browserRoomWorkActive() || !currentPeerNeedsNetworkNote())) return;
        return roomShowVideoNote(key, ...args);
      };
    }

    if (typeof RoomPeerConnection === "function") {
      const guardedPeerEvents = [
        "track",
        "icecandidate",
        "negotiationneeded",
        "iceconnectionstatechange",
        "connectionstatechange",
      ];
      const guardedPeerMethods = ["setLocalDescription", "setRemoteDescription", "addIceCandidate"];

      function LifecycleRTCPeerConnection(...args) {
        const pc = new RoomPeerConnection(...args);
        const generation = browserRoomGeneration;
        peerGenerations.set(pc, generation);

        for (const type of guardedPeerEvents) {
          pc.addEventListener(type, event => {
            if (!peerConnectionActive(pc, generation)) event.stopImmediatePropagation?.();
          });
        }
        for (const methodName of guardedPeerMethods) {
          const original = typeof pc[methodName] === "function" ? pc[methodName].bind(pc) : null;
          if (!original) continue;
          pc[methodName] = async (...methodArgs) => {
            if (!peerConnectionActive(pc, generation)) throw peerLifecycleAbortError();
            const result = await original(...methodArgs);
            if (!peerConnectionActive(pc, generation)) throw peerLifecycleAbortError();
            return result;
          };
        }
        return pc;
      }
      LifecycleRTCPeerConnection.prototype = RoomPeerConnection.prototype;
      Object.setPrototypeOf(LifecycleRTCPeerConnection, RoomPeerConnection);
      window.RTCPeerConnection = LifecycleRTCPeerConnection;

      window.addEventListener("unhandledrejection", event => {
        if (event.reason?.linguaPeerLifecycle === true) event.preventDefault?.();
      });
    }

    const micButton = document.getElementById("micBtn");
    const RoomAudioContext = window.AudioContext || window.webkitAudioContext;
    const RoomAudioWorkletNode = window.AudioWorkletNode;
    if (micButton && typeof startCapture === "function"
        && typeof RoomAudioContext === "function" && typeof RoomAudioWorkletNode === "function") {
      startCapture = function lifecycleAwareStartCapture() {
        if (browserAudioStartPromise && browserAudioStartGeneration === browserRoomGeneration) {
          return browserAudioStartPromise;
        }
        const generation = browserRoomGeneration;
        browserAudioStartGeneration = generation;
        const task = (async () => {
          const stream = await getAudioMedia();
          if (generation !== browserRoomGeneration || !browserRoomWorkActive()) {
            throw audioLifecycleAbortError();
          }

          let context = audioCtx;
          if (!context) {
            context = new RoomAudioContext();
            audioCtx = context;
          }
          if (!workletNode) {
            await context.audioWorklet.addModule("/static/pcm-worklet.js");
            if (generation !== browserRoomGeneration
                || !browserRoomWorkActive() || audioCtx !== context) {
              throw audioLifecycleAbortError();
            }
            const node = new RoomAudioWorkletNode(context, "pcm-worklet");
            node.port.onmessage = event => {
              if (generation !== browserRoomGeneration || !browserRoomWorkActive()
                  || workletNode !== node) return;
              if (ws && ws.readyState === WebSocket.OPEN) ws.send(event.data);
            };
            workletNode = node;
          }
          if (generation !== browserRoomGeneration
              || !browserRoomWorkActive() || audioCtx !== context) {
            throw audioLifecycleAbortError();
          }
          if (audioInputNode) audioInputNode.disconnect();
          const input = context.createMediaStreamSource(stream);
          audioInputNode = input;
          input.connect(workletNode);
          if (context.state === "suspended") {
            await context.resume();
            if (generation !== browserRoomGeneration
                || !browserRoomWorkActive() || audioCtx !== context) {
              throw audioLifecycleAbortError();
            }
          }
        })();
        browserAudioStartPromise = task;
        task.finally(() => {
          if (browserAudioStartPromise === task) browserAudioStartPromise = null;
        }).catch(() => {});
        return task;
      };

      micButton.onclick = async () => {
        const generation = browserRoomGeneration;
        unlockFallbackAudio();
        try {
          if (micOn) {
            setMicEnabled(false);
            setStatus("status.muted");
            return;
          }
          micButton.setAttribute("aria-label", t("bar.starting"));
          await startCapture();
          if (generation !== browserRoomGeneration || !browserRoomWorkActive()) return;
          for (const peer of peers.values()) addTracks(peer.pc);
          setMicEnabled(true);
          setStatus("status.micOn", {language: spokenLocaleName(myLocale)});
        } catch (error) {
          if (error?.linguaAudioLifecycle === true
              || generation !== browserRoomGeneration || !browserRoomWorkActive()) return;
          setMicEnabled(false);
          setStatus("status.micUnavailable", null, true);
        }
      };
    }

    if (typeof fallbackAudio !== "undefined" && fallbackAudio
        && typeof fallbackAudio.play === "function") {
      const roomFallbackPlay = fallbackAudio.play.bind(fallbackAudio);
      fallbackAudio.play = (...args) => {
        const generation = browserRoomGeneration;
        return Promise.resolve(roomFallbackPlay(...args)).then(
          result => {
            if (generation !== browserRoomGeneration || !browserRoomWorkActive()) {
              throw audioLifecycleAbortError();
            }
            return result;
          },
          error => {
            if (generation !== browserRoomGeneration || !browserRoomWorkActive()) {
              throw audioLifecycleAbortError();
            }
            throw error;
          },
        );
      };
    }

    function abortControlRequests() {
      for (const controller of activeControlControllers) controller.abort();
      activeControlControllers.clear();
    }

    function clearCapabilityRetryTimer() {
      if (capabilityRetryTimer === null) return;
      if (typeof window.clearTimeout === "function") window.clearTimeout(capabilityRetryTimer);
      capabilityRetryTimer = null;
    }

    function endRoomLifecycle() {
      invalidateBrowserRoomGeneration();
      browserMediaLifecycleEnded = true;
      invalidatePendingBrowserMedia();
      roomLifecycleEnded = true;
      clearCapabilityRetryTimer();
      abortControlRequests();
    }

    function canRetryCapabilities() {
      // These bindings are declared by the room's classic inline script before
      // this deferred classic script executes. Guard every access anyway so the
      // shared QR loader remains safe on the dashboard and in isolated tests.
      if (!browserRoomSupported
          || typeof loadCapabilities !== "function"
          || typeof gateFailureKey === "undefined"
          || typeof catalog === "undefined"
          || typeof locales === "undefined"
          || typeof voices === "undefined"
          || typeof roleChosen === "undefined"
          || typeof explicitLeave === "undefined"
          || typeof terminalRoom === "undefined") return false;
      return gateFailureKey === "gate.languagesUnavailable"
        && catalog === null && locales.size === 0 && voices.size === 0
        && !roleChosen && !explicitLeave && !terminalRoom
        && !roomSuspended && !roomLifecycleEnded;
    }

    function scheduleCapabilityRetry(delay) {
      if (!canRetryCapabilities() || capabilityRetryTimer !== null
          || typeof window.setTimeout !== "function") return;
      capabilityRetryTimer = window.setTimeout(() => {
        capabilityRetryTimer = null;
        retryCapabilities();
      }, Math.max(0, Number(delay) || 0));
    }

    async function retryCapabilities() {
      if (!canRetryCapabilities()) return;
      if (capabilityRetryPromise) return capabilityRetryPromise;

      const now = Date.now();
      capabilityRetryAttempts = capabilityRetryAttempts
        .filter(attemptedAt => now - attemptedAt < CAPABILITY_RETRY_WINDOW_MS);
      if (capabilityRetryAttempts.length >= CAPABILITY_RETRY_MAX_PER_WINDOW) return;
      capabilityRetryAttempts.push(now);
      clearCapabilityRetryTimer();

      // loadCapabilities() owns the catalog validation and the failure state.
      // Clearing the old key before retry lets a successful call restore the
      // normal gate, while any failed retry writes the warning back itself.
      gateFailureKey = "";
      const roleSelect = document.getElementById("roleLocaleSel");
      const joinButton = document.getElementById("joinBtn");
      const roleCapability = document.getElementById("roleCapability");
      if (roleSelect) roleSelect.disabled = true;
      if (joinButton) joinButton.disabled = true;
      if (roleCapability && typeof t === "function") {
        roleCapability.textContent = t("gate.loading");
        roleCapability.classList.remove("warning");
      }
      if (typeof setStatus === "function") setStatus("gate.loading", null, true);

      capabilityRetryPromise = Promise.resolve(loadCapabilities()).then(() => {
        if (!gateFailureKey && catalog !== null) {
          capabilityRetryAttempts = [];
          if (typeof setStatus === "function") setStatus("gate.title", null, true);
          if (typeof updateRoleGate === "function") updateRoleGate();
          return;
        }
        // A top-level/network/server failure leaves all live catalog containers
        // empty and is safe to retry. A partially validated catalog does not:
        // stop there rather than replaying against half-mutated locale state.
        if (canRetryCapabilities()
            && capabilityRetryAttempts.length < CAPABILITY_RETRY_MAX_PER_WINDOW) {
          const backoff = Math.min(8000, 1000 * 2 ** capabilityRetryAttempts.length);
          scheduleCapabilityRetry(backoff);
        }
      }).finally(() => {
        capabilityRetryPromise = null;
      });
      return capabilityRetryPromise;
    }

    window.addEventListener("pagehide", () => {
      roomSuspended = true;
      clearCapabilityRetryTimer();
      abortControlRequests();
    }, {capture: true});
    window.addEventListener("pageshow", event => {
      if (event.persisted && !roomLifecycleEnded) {
        roomSuspended = false;
        queueMicrotask(retryCapabilities);
      }
    }, {capture: true});
    window.addEventListener("online", retryCapabilities);
    window.addEventListener("lingua-app-state", event => {
      if (event.detail?.isActive) retryCapabilities();
    });
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible") retryCapabilities();
    });

    const leaveButton = document.getElementById("leaveBtn");
    leaveButton?.addEventListener("click", endRoomLifecycle, {capture: true});
    const reportButton = document.getElementById("reportBtn");
    reportButton?.addEventListener("click", () => {
      // reportAndBlockRoom() disables the button synchronously only after its
      // confirmation succeeds, before its first await. Read that result after
      // the click dispatch so cancelling the confirmation does not end a room
      // or invalidate a permission request the user still intends to finish.
      queueMicrotask(() => {
        if (reportButton.disabled) endRoomLifecycle();
      });
    }, {capture: true});

    // disconnectRoom() clears the current TURN timer, but a fetch that rejects
    // after teardown can otherwise re-arm one from refreshIceServers()' catch.
    // Keep the room's existing scheduler semantics while the page is live and
    // make stale retries a no-op during suspension or after explicit teardown.
    const scheduleTurnRefresh = window.scheduleTurnRefresh;
    if (typeof scheduleTurnRefresh === "function") {
      window.scheduleTurnRefresh = function lifecycleTurnRefresh(delay) {
        if (roomSuspended || roomLifecycleEnded) return;
        return scheduleTurnRefresh(delay);
      };
    }

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

      const requestGeneration = browserRoomGeneration;
      const callerSignal = init.signal
        || (typeof Request !== "undefined" && input instanceof Request ? input.signal : null);
      const controller = new AbortController();
      activeControlControllers.add(controller);
      const abortFromCaller = () => controller.abort();
      if (callerSignal?.aborted) abortFromCaller();
      else callerSignal?.addEventListener("abort", abortFromCaller, {once: true});
      let timer = null;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (timer !== null) clearTimeout(timer);
        activeControlControllers.delete(controller);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      };
      timer = setTimeout(() => {
        controller.abort();
        release();
      }, ROOM_CONTROL_FETCH_TIMEOUT_MS);

      try {
        const response = await boundedFetch(input, {...init, signal: controller.signal});
        if (!response?.ok || !ROOM_CONTROL_JSON_PATHS.has(url.pathname)
            || typeof response.json !== "function") {
          release();
          return response;
        }
        const readJson = response.json.bind(response);
        return new Proxy(response, {
          get(target, property) {
            if (property === "json") {
              return async (...args) => {
                try {
                  const value = await readJson(...args);
                  if (!browserRoomGenerationActive(requestGeneration)) throw lifecycleAbortError();
                  return value;
                } finally {
                  release();
                }
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      } catch (error) {
        release();
        throw error;
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
        const socketGeneration = browserRoomGeneration;
        activeRoomSocket = socket;
        socket.addEventListener("message", event => {
          if (socketGeneration !== browserRoomGeneration
              || activeRoomSocket !== socket || !browserRoomWorkActive()) {
            event.stopImmediatePropagation?.();
          }
        });
        socket.addEventListener("close", event => {
          const stale = socketGeneration !== browserRoomGeneration
            || activeRoomSocket !== socket || !browserRoomWorkActive();
          if (activeRoomSocket === socket) activeRoomSocket = null;
          if (stale) event.stopImmediatePropagation?.();
        });
        return socket;
      }
      LifecycleWebSocket.prototype = RoomWebSocket.prototype;
      Object.setPrototypeOf(LifecycleWebSocket, RoomWebSocket);
      window.WebSocket = LifecycleWebSocket;
    }

    // The synchronous bootstrap has a 12-second deadline. If it failed before
    // this deferred script could observe the request, the room's own failure
    // state is visible by the time this slightly later fallback fires. The
    // guard above prevents a concurrent second load while the first is healthy.
    if (typeof window.setTimeout === "function") {
      window.setTimeout(() => {
        if (browserRoomSupported) retryCapabilities();
        else renderUnsupportedRoomGate();
      }, ROOM_CONTROL_FETCH_TIMEOUT_MS + 1000);
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