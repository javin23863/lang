(() => {
  "use strict";

  const POLL_INTERVAL_MS = 15_000;

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
    let statusTimer = null;
    let statusRefreshRoom = null;

    function current() {
      return room;
    }

    function isBusy() {
      return busy;
    }

    function setBusy(value) {
      busy = value;
      onBusy(value);
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
      await model.forget();
      room = null;
      stopPolling();
      onClear(state, key);
    }

    async function refresh() {
      const targetRoom = room;
      if (!targetRoom || busy || statusRefreshRoom === targetRoom) return;
      statusRefreshRoom = targetRoom;
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/room-control"), {
          headers: {Authorization: "Bearer " + targetRoom.host_control, Accept: "application/json"},
        });
        // A close/replace can complete while this request is in flight. Never
        // let an old room's delayed status mutate or clear the new room.
        if (room !== targetRoom) return;
        if (response.status === 403) {
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
      if (!room || busy) return false;
      if (withConfirmation && !confirmAction("home.confirmClose")) return false;
      setBusy(true);
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/room-control/close"), {
          method: "POST",
          headers: {Authorization: "Bearer " + room.host_control, Accept: "application/json"},
        });
        if (!response.ok) throw new Error("close failed");
        events()?.emit("room.close.result", {result: "success"});
        await clear("closed", "home.roomClosedLink");
        onNotice("");
        return true;
      } catch (_) {
        events()?.emit("room.close.result", {result: "failure"});
        onClear("error", "home.closeFailed", {preserveRoom: true});
        return false;
      } finally {
        setBusy(false);
      }
    }

    async function createRoom(mode) {
      if (busy) return false;
      const requestedMode = model.normalizeMode(mode);
      if (room) {
        if (!confirmAction("home.confirmReplace")) return false;
        await close(false);
        if (room) return false;
      }
      setBusy(true);
      onNotice("");
      try {
        const response = await dashboardFetch(runtime.apiUrl("/api/rooms"), {
          method: "POST", headers: {Accept: "application/json"},
        });
        if (!response.ok) throw new Error("creation failed");
        const created = await response.json();
        if (!model.valid(created)) throw new Error("storage unavailable");
        created.mode = requestedMode;
        if (!await model.save(created)) throw new Error("storage unavailable");
        room = created;
        onRender(room, "ready", 0);
        startPolling();
        events()?.emit("room.create.result", {mode: requestedMode, result: "success"});
        onNotice("home.linkReady");
        return true;
      } catch (_) {
        events()?.emit("room.create.result", {mode: requestedMode, result: "failure"});
        onClear("error", "home.createFailed", {preserveRoom: true});
        return false;
      } finally {
        setBusy(false);
      }
    }

    function open() {
      if (!room || busy) return false;
      if (!runtime.openRoom(room.path, model.mode(room))) {
        onNotice("home.openBlocked");
        return false;
      }
      return true;
    }

    async function restore() {
      room = await model.load();
      if (room && room.expires_at * 1000 > Date.now()) {
        onRender(room, "ready", 0);
        startPolling();
        refresh();
        return room;
      }
      if (room) {
        await model.forget();
        room = null;
        onClear("expired", "home.roomExpired");
      }
      return null;
    }

    async function discard() {
      stopPolling();
      room = null;
      await model.forget();
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
