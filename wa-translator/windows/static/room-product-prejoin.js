(() => {
  "use strict";

  const gate = document.getElementById("roleGate");
  const card = gate?.querySelector(".roleCard");
  const join = document.getElementById("joinBtn");
  if (!gate || !card || !join || document.getElementById("productPrejoin")) return;

  const mode = document.body.dataset.mode || "video";
  const panel = document.createElement("section");
  panel.id = "productPrejoin";
  panel.className = "productPrejoin";

  if (mode === "chat") {
    panel.innerHTML = `
      <div class="productPrejoinHeader"><strong>Ready to chat</strong><span>No camera or microphone needed</span></div>
      <div class="productPrejoinNoMedia"><span aria-hidden="true">✓</span><p>Choose your language and join. Media permissions are not requested for translated chat.</p></div>
    `;
  } else {
    panel.innerHTML = `
      <div class="productPrejoinHeader"><strong>Check your device</strong><span>Optional before you join</span></div>
      <div class="productPrejoinActions">
        <button id="prejoinMic" type="button"><span aria-hidden="true">◉</span><strong>Microphone</strong><small id="prejoinMicStatus">Not checked</small></button>
        ${mode === "video" ? '<button id="prejoinCamera" type="button"><span aria-hidden="true">▣</span><strong>Camera</strong><small id="prejoinCameraStatus">Not checked</small></button>' : ""}
      </div>
      <div id="prejoinMicMeter" class="prejoinMicMeter" hidden><span></span></div>
      ${mode === "video" ? '<div id="prejoinCameraFrame" class="prejoinCameraFrame" hidden><video id="prejoinCameraVideo" autoplay playsinline muted></video><span>Preview only</span></div>' : ""}
      <p class="productPrejoinPrivacy">Tests stay on this device and stop before you join the room.</p>
    `;
  }

  const terms = card.querySelector(".termsAgree");
  if (terms) terms.before(panel);
  else join.before(panel);

  let micStream = null;
  let micContext = null;
  let micSource = null;
  let analyser = null;
  let micFrame = 0;
  let cameraStream = null;
  let micRequest = 0;
  let cameraRequest = 0;

  function stopMic() {
    micRequest++;
    cancelAnimationFrame(micFrame);
    micFrame = 0;
    try { micSource?.disconnect?.(); } catch (_) {}
    micSource = null;
    analyser = null;
    if (micStream) micStream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    micStream = null;
    if (micContext) micContext.close?.().catch?.(() => {});
    micContext = null;
    const meter = document.getElementById("prejoinMicMeter");
    if (meter) meter.hidden = true;
    const button = document.getElementById("prejoinMic");
    if (button) button.dataset.active = "false";
  }

  function stopCamera() {
    cameraRequest++;
    if (cameraStream) cameraStream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    cameraStream = null;
    const video = document.getElementById("prejoinCameraVideo");
    if (video) video.srcObject = null;
    const frame = document.getElementById("prejoinCameraFrame");
    if (frame) frame.hidden = true;
    const button = document.getElementById("prejoinCamera");
    if (button) button.dataset.active = "false";
  }

  function drawMic() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    const percent = Math.min(100, Math.max(4, Math.sqrt(sum / data.length) * 260));
    const bar = document.querySelector("#prejoinMicMeter span");
    if (bar) bar.style.width = `${percent}%`;
    micFrame = requestAnimationFrame(drawMic);
  }

  async function toggleMic() {
    if (micStream) {
      stopMic();
      document.getElementById("prejoinMicStatus").textContent = "Ready";
      return;
    }
    const button = document.getElementById("prejoinMic");
    const status = document.getElementById("prejoinMicStatus");
    const meter = document.getElementById("prejoinMicMeter");
    const id = ++micRequest;
    button.disabled = true;
    status.textContent = "Checking…";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const captured = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if (id !== micRequest || gate.hidden) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("unsupported");
      micContext = new Ctx();
      if (micContext.state === "suspended") await micContext.resume();
      micStream = captured;
      micSource = micContext.createMediaStreamSource(captured);
      analyser = micContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .72;
      micSource.connect(analyser);
      meter.hidden = false;
      status.textContent = "Level moving = ready";
      status.dataset.state = "ready";
      button.dataset.active = "true";
      drawMic();
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error?.name === "NotAllowedError" ? "Permission denied"
        : error?.name === "NotFoundError" ? "No microphone" : "Unavailable";
    } finally {
      if (id === micRequest) button.disabled = false;
    }
  }

  async function toggleCamera() {
    if (cameraStream) {
      stopCamera();
      document.getElementById("prejoinCameraStatus").textContent = "Ready";
      return;
    }
    const button = document.getElementById("prejoinCamera");
    const status = document.getElementById("prejoinCameraStatus");
    const frame = document.getElementById("prejoinCameraFrame");
    const video = document.getElementById("prejoinCameraVideo");
    const id = ++cameraRequest;
    button.disabled = true;
    status.textContent = "Opening…";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const captured = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: "user"}});
      if (id !== cameraRequest || gate.hidden) {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = captured;
      video.srcObject = captured;
      try { await video.play(); } catch (_) {}
      frame.hidden = false;
      status.textContent = "Preview ready";
      status.dataset.state = "ready";
      button.dataset.active = "true";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent = error?.name === "NotAllowedError" ? "Permission denied"
        : error?.name === "NotFoundError" ? "No camera" : "Unavailable";
    } finally {
      if (id === cameraRequest) button.disabled = false;
    }
  }

  document.getElementById("prejoinMic")?.addEventListener("click", toggleMic);
  document.getElementById("prejoinCamera")?.addEventListener("click", toggleCamera);
  join.addEventListener("click", () => { stopMic(); stopCamera(); }, {capture: true});
  document.getElementById("declineBtn")?.addEventListener("click", () => { stopMic(); stopCamera(); }, {capture: true});
  window.addEventListener("pagehide", () => { stopMic(); stopCamera(); });
  if (typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (gate.hidden) { stopMic(); stopCamera(); }
    }).observe(gate, {attributes: true, attributeFilter: ["hidden"]});
  }
})();
