(() => {
  "use strict";

  const POLL_INTERVAL_MS = 15_000;
  const TERMINAL_CONTROL_STATUSES = new Set([401, 403, 410]);

  function create({
    runtime,
    fetch: dashboardFetch,
    model,
    events,
    confirmAction,
    onBusy,
    onNotice,
    onRender,
    onClear,
  }) {
    if (!runtime || typeof dashboardFetch !== "function" || !model
        || typeof events !== "function" || typeof confirmAction !== "function"
        || typeof onBusy !== "function" || typeof onNotice !== "function"
        || typeof onRender !== "function" || typeof onClear !== "function") {
      throw new TypeError("dashboard room controller dependencies are required");
    }

    let room = null;
    let busy = false;
    let custodyUnavailable = false;
    let statusTimer = null;
    let statusRefreshRoom = null;
    let invalidationGeneration = 0;

    function current() {
      return room;
    }

    function isBusy() {
      return busy || custodyUnavailable;
    }

    function syncBusy() {
      onBusy(isBusy());
    }

    function setBusy(value) {
      busy = Boolean(value);
      syncBusy();
    }

    function setCustodyUnavailable(value) {
      custodyUnavailable = Boolean(value);
      syncBusy();
    }

    function stopPolling() {
      clearInterval(statusTimer);
      statusTimer = null;
    }

    function startPolling() {
      stopPolling();
      if (!room) return;
      statusTimer = setInterval(() => {
        if (document.visibilityState === "visible") refresh();
      }, POLL_INTERVAL_MS);
    }

    async function clear(state, key) {
      const targetRoom = room;
      const targetGeneration = invalidationGeneration;
      const acquiredBusy = !busy;
      if (acquiredBusy) setBusy(true);
      try {
        if (!await model.forget()) {
          if (invalidationGeneration === targetGeneration && room === targetRoom) {
            setCustodyUnavailable(true);
            onClear("error", "home.needsUpdate", {preserveRoom: true});
          }
          return false;
        }
        if (invalidationGeneration !== targetGeneration || room !== targetRoom) return false;
        setCustodyUnavailable(false);
        room = null;
        stopPolling();
        onClear(state, key);
        return true;
      } finally {
        if (acquiredBusy) setBusy(false);
      }
    }

    async function retireCreatedRoom(created) {
      const hostControl = typeof created?.host_control === "string" ? created.host_control : "";
      if (!hostControl) return false;
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/room-control/close"), {
          method: "POST",
          headers: {Authorization: "Bearer " + hostControl, Accept: "application/json"},
        });
        return response.ok || TERMINAL_CONTROL_STATUSES.has(response.status);
      } catch (_) {
        return false;
      }
    }

    async function refresh() {
      const targetRoom = room;
      // A custody-retirement failure leaves the known room in memory but locks
      // user actions. Recovery still needs to poll that room so it can retry the
      // checked tombstone write when storage becomes usable again.
      if (!targetRoom || busy || statusRefreshRoom === targetRoom) return;
      statusRefreshRoom = targetRoom;
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/room-control"), {
          headers: {Authorization: "Bearer " + targetRoom.host_control, Accept: "application/json"},
        });
        // A close/replace can complete while this request is in flight. Never
        // let an old room's delayed status mutate or clear the new room.
        if (room !== targetRoom) return;
        if (TERMINAL_CONTROL_STATUSES.has(response.status)) {
          await clear("expired", "home.controlLost");
          return;
        }
        if (!response.ok) throw new Error("status unavailable");
        const value = await response.json();
        if (room !== targetRoom) return;
        if (value.participant_limit !== 2) throw new Error("participant contract mismatch");
        if (value.state === "closed") {
          await clear("closed", "home.roomClosed");
          return;
        }
        if (value.state !== "ready" && value.state !== "open") {
          throw new Error("invalid room state");
        }
        onRender(targetRoom, value.state, value.participant_count);
        onNotice("");
      } catch (_) {
        if (room === targetRoom) {
          onClear("error", "home.statusUnavailable", {preserveRoom: true});
        }
      } finally {
        if (statusRefreshRoom === targetRoom) statusRefreshRoom = null;
      }
    }

    async function close(withConfirmation = true) {
      const targetRoom = room;
      const targetGeneration = invalidationGeneration;
      if (!targetRoom || busy || (custodyUnavailable && withConfirmation)) return false;
      if (withConfirmation && !confirmAction("home.confirmClose")) return false;
      setBusy(true);
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/room-control/close"), {
          method: "POST",
          headers: {Authorization: "Bearer " + targetRoom.host_control, Accept: "application/json"},
        });
        if (invalidationGeneration !== targetGeneration || room !== targetRoom) return false;
        if (TERMINAL_CONTROL_STATUSES.has(response.status)) {
          if (!await clear("expired", "home.controlLost")) {
            events()?.emit("room.close.result", {result: "failure"});
            return false;
          }
          events()?.emit("room.close.result", {result: "success"});
          onNotice("");
          return true;
        }
        if (!response.ok) throw new Error("close failed");
        if (!await clear("closed", "home.roomClosedLink")) {
          events()?.emit("room.close.result", {result: "failure"});
          return false;
        }
        events()?.emit("room.close.result", {result: "success"});
        onNotice("");
        return true;
      } catch (_) {
        if (invalidationGeneration !== targetGeneration || room !== targetRoom) return false;
        events()?.emit("room.close.result", {result: "failure"});
        onClear("error", "home.closeFailed", {preserveRoom: true});
        return false;
      } finally {
        setBusy(false);
      }
    }

    async function createRoom(mode) {
      if (isBusy()) return false;
      const targetGeneration = invalidationGeneration;
      const requestedMode = model.normalizeMode(mode);
      if (room) {
        if (!confirmAction("home.confirmReplace")) return false;
        await close(false);
        if (invalidationGeneration !== targetGeneration || room) return false;
      }
      setBusy(true);
      onNotice("");
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/rooms"), {
          method: "POST", headers: {Accept: "application/json"},
        });
        if (!response.ok) {
          if (invalidationGeneration !== targetGeneration) return false;
          throw new Error("creation failed");
        }
        const created = await response.json();
        if (invalidationGeneration !== targetGeneration) {
          await retireCreatedRoom(created);
          return false;
        }
        if (!model.valid(created)) {
          await retireCreatedRoom(created);
          throw new Error("storage unavailable");
        }
        created.mode = requestedMode;
        if (!await model.save(created)) {
          await retireCreatedRoom(created);
          throw new Error("storage unavailable");
        }
        if (invalidationGeneration !== targetGeneration) {
          const retired = await model.forget();
          if (!retired) setCustodyUnavailable(true);
          await retireCreatedRoom(created);
          return false;
        }
        setCustodyUnavailable(false);
        room = created;
        onRender(room, "ready", 0);
        startPolling();
        events()?.emit("room.create.result", {mode: requestedMode, result: "success"});
        onNotice("home.linkReady");
        return true;
      } catch (_) {
        if (invalidationGeneration !== targetGeneration) return false;
        events()?.emit("room.create.result", {mode: requestedMode, result: "failure"});
        onClear("error", "home.createFailed", {preserveRoom: true});
        return false;
      } finally {
        setBusy(false);
      }
    }

    function open() {
      if (!room || isBusy()) return false;
      if (!runtime.openRoom(room.path, model.mode(room))) {
        onNotice("home.openBlocked");
        return false;
      }
      return true;
    }

    async function restore() {
      // A live in-memory capability is authoritative for this process. Foreground
      // recovery must not replace it with an empty or externally-cleared storage
      // slot and accidentally orphan a still-live backend room.
      if (busy) return null;
      if (room) return room;
      // `custodyUnavailable` deliberately does not block restore: foreground or
      // online recovery must be able to retry the storage read that created it.
      const targetGeneration = invalidationGeneration;
      let refreshAfterRestore = false;
      setBusy(true);
      try {
        const restored = await model.load();
        if (invalidationGeneration !== targetGeneration) return null;
        setCustodyUnavailable(false);
        room = restored;
        if (room && room.expires_at * 1000 > Date.now()) {
          onRender(room, "ready", 0);
          startPolling();
          refreshAfterRestore = true;
          return room;
        }
        if (room) {
          if (!await clear("expired", "home.roomExpired")) return null;
        }
        return null;
      } catch (_) {
        if (invalidationGeneration !== targetGeneration) return null;
        setCustodyUnavailable(true);
        onClear("error", "home.needsUpdate", {preserveRoom: true});
        return null;
      } finally {
        setBusy(false);
        if (refreshAfterRestore && room) refresh();
      }
    }

    async function discard() {
      const acquiredBusy = !busy;
      if (acquiredBusy) setBusy(true);
      invalidationGeneration++;
      stopPolling();
      room = null;
      try {
        const retired = await model.forget();
        setCustodyUnavailable(!retired);
        return retired;
      } catch (_) {
        setCustodyUnavailable(true);
        return false;
      } finally {
        if (acquiredBusy) setBusy(false);
      }
    }

    return Object.freeze({
      current,
      isBusy,
      refresh,
      create: createRoom,
      close,
      open,
      restore,
      discard,
    });
  }

  Object.defineProperty(window, "LinguaDashboardRoomController", {
    value: Object.freeze({create}),
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
