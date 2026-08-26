(() => {
  "use strict";

  const setup = document.getElementById("conversationSetup");
  const details = document.getElementById("setupModeDetails");
  if (!setup || !details || document.getElementById("setupAudioPreview")) return;

  const panel = document.createElement("section");
  panel.id = "setupAudioPreview";
  panel.className = "setupAudioPreview";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="setupAudioHeading"><div><strong>Microphone check</strong><span>Optional · audio stays on this device</span></div><button id="setupAudioToggle" type="button">Test microphone</button></div>
    <div id="setupAudioMeter" class="setupAudioMeter" hidden><span id="setupAudioLevel"></span></div>
    <p id="setupAudioStatus" class="setupAudioStatus">Speak normally and check that the level moves.</p>
  `;
  details.after(panel);

  const button = document.getElementById("setupAudioToggle");
  const meter = document.getElementById("setupAudioMeter");
  const level = document.getElementById("setupAudioLevel");
  const status = document.getElementById("setupAudioStatus");
  let stream = null;
  let context = null;
  let source = null;
  let analyser = null;
  let frame = 0;
  let requestId = 0;

  function draw() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / data.length);
    const percent = Math.min(100, Math.max(4, rms * 260));
    level.style.width = `${percent}%`;
    frame = requestAnimationFrame(draw);
  }

  function stopTest() {
    requestId++;
    cancelAnimationFrame(frame);
    frame = 0;
    try { source?.disconnect?.(); } catch (_) {}
    source = null;
    analyser = null;
    if (stream) stream.getTracks().forEach(track => { try { track.stop(); } catch (_) {} });
    stream = null;
    if (context) context.close?.().catch?.(() => {});
    context = null;
    meter.hidden = true;
    level.style.width = "4%";
    button.disabled = false;
    button.textContent = "Test microphone";
    status.textContent = "Speak normally and check that the level moves.";
    status.dataset.state = "";
  }

  async function startTest() {
    if (stream) {
      stopTest();
      return;
    }
    const id = ++requestId;
    button.disabled = true;
    button.textContent = "Opening…";
    status.textContent = "Requesting microphone access";
    status.dataset.state = "loading";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
      const captured = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      if (id !== requestId || setup.hidden || setup.dataset.mode !== "voice") {
        captured.getTracks().forEach(track => track.stop());
        return;
      }
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error("unsupported");
      context = new AudioContextCtor();
      if (context.state === "suspended") await context.resume();
      stream = captured;
      source = context.createMediaStreamSource(captured);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .72;
      source.connect(analyser);
      meter.hidden = false;
      status.textContent = "Microphone ready";
      status.dataset.state = "ready";
      button.textContent = "Stop test";
      draw();
    } catch (error) {
      if (id !== requestId) return;
      status.dataset.state = "error";
      status.textContent = error?.name === "NotAllowedError" ? "Microphone permission denied"
        : error?.name === "NotFoundError" ? "No microphone found"
        : "Microphone unavailable";
      button.textContent = "Try again";
    } finally {
      if (id === requestId) button.disabled = false;
    }
  }

  function syncMode() {
    const visible = !setup.hidden && setup.dataset.mode === "voice";
    panel.hidden = !visible;
    if (!visible && stream) stopTest();
  }

  button.addEventListener("click", startTest);
  document.getElementById("setupStart")?.addEventListener("click", stopTest, {capture: true});
  for (const closer of setup.querySelectorAll("[data-setup-close]")) closer.addEventListener("click", stopTest, {capture: true});
  if (typeof MutationObserver === "function") {
    new MutationObserver(syncMode).observe(setup, {attributes: true, attributeFilter: ["hidden", "data-mode", "class"]});
  }
  syncMode();
})();
