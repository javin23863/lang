(() => {
  "use strict";

  const setup = document.getElementById("conversationSetup");
  const details = document.getElementById("setupModeDetails");
  if (!setup || !details || document.getElementById("setupVideoPreview")) return;

  const preview = document.createElement("section");
  preview.id = "setupVideoPreview";
  preview.className = "setupVideoPreview";
  preview.hidden = true;
  preview.innerHTML = `
    <div class="setupPreviewHeading"><div><strong>Camera preview</strong><span>Optional · nothing is sent to the room yet</span></div><button id="setupPreviewToggle" type="button">Preview camera</button></div>
    <div id="setupPreviewFrame" class="setupPreviewFrame" hidden>
      <video id="setupPreviewVideo" autoplay playsinline muted></video>
      <span id="setupPreviewStatus">Camera preview</span>
    </div>
  `;
  details.after(preview);

  const button = document.getElementById("setupPreviewToggle");
  const frame = document.getElementById("setupPreviewFrame");
  const video = document.getElementById("setupPreviewVideo");
  const status = document.getElementById("setupPreviewStatus");
  let stream = null;
  let requestId = 0;

  function stopPreview() {
    requestId++;
    if (stream) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch (_) {}
      }
    }
    stream = null;
    video.srcObject = null;
    frame.hidden = true;
    button.disabled = false;
    button.textContent = "Preview camera";
    status.textContent = "Camera preview";
    status.dataset.state = "";
  }

  async function startPreview() {
    if (stream) {
      stopPreview();
      return;
    }
    const id = ++requestId;
    button.disabled = true;
    button.textContent = "Opening…";
    status.textContent = "Requesting camera access";
    status.dataset.state = "loading";
    frame.hidden = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: "user", width: {ideal: 720}, height: {ideal: 960}},
      });
      if (id !== requestId || setup.hidden || setup.dataset.mode !== "video") {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      stream = captured;
      video.srcObject = captured;
      try { await video.play(); } catch (_) {}
      status.textContent = "Preview ready";
      status.dataset.state = "ready";
      button.textContent = "Stop preview";
    } catch (error) {
      if (id !== requestId) return;
      status.dataset.state = "error";
      status.textContent = error?.name === "NotAllowedError" ? "Camera permission denied"
        : error?.name === "NotFoundError" ? "No camera found"
        : "Camera unavailable";
      button.textContent = "Try again";
    } finally {
      if (id === requestId) button.disabled = false;
    }
  }

  function syncMode() {
    const visible = !setup.hidden && setup.dataset.mode === "video";
    preview.hidden = !visible;
    if (!visible && stream) stopPreview();
  }

  button.addEventListener("click", startPreview);
  document.getElementById("setupStart")?.addEventListener("click", stopPreview, {capture: true});
  for (const closer of setup.querySelectorAll("[data-setup-close]")) closer.addEventListener("click", stopPreview, {capture: true});
  if (typeof MutationObserver === "function") {
    new MutationObserver(syncMode).observe(setup, {attributes: true, attributeFilter: ["hidden", "data-mode", "class"]});
  }
  syncMode();
})();
