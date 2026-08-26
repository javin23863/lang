import { Capacitor } from "@capacitor/core";

const ROOM_PAGE = /(?:^|\/)room\.html$/;
let mediaGeneration = 0;

function invalidatePendingMedia(): void {
  mediaGeneration++;
}

function stopCapturedStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* an already-ended track is harmless */ }
  }
}

function guardNativeMediaAcquisition(): void {
  if (!ROOM_PAGE.test(location.pathname)) return;
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") return;

  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  mediaDevices.getUserMedia = (async constraints => {
    const generation = mediaGeneration;
    const stream = await originalGetUserMedia(constraints);
    if (generation !== mediaGeneration || !ROOM_PAGE.test(location.pathname)) {
      // Permission UI and native capture can resolve after the room has already
      // backgrounded or begun leaving. Never hand that late stream back to
      // room.js: doing so would rebuild mediaStream/AudioContext after teardown.
      stopCapturedStream(stream);
      throw new DOMException("Media request superseded by room teardown", "AbortError");
    }
    return stream;
  }) as typeof mediaDevices.getUserMedia;
}

function resetRoomMediaChrome(): void {
  if (!ROOM_PAGE.test(location.pathname)) return;

  // The room owns camera state. Toggle through its existing control before its
  // background handler destroys tracks so camOn and the visible button cannot
  // survive as "on" after the underlying MediaStream has been stopped.
  const camera = document.querySelector<HTMLButtonElement>("#camBtn");
  if (camera && !camera.classList.contains("off")) camera.click();

  // Do not retain a last video frame in the native WebView after foreground
  // media has been torn down. A later peer/camera track will set srcObject again.
  for (const selector of ["#selfVideo", "#remoteVideo"]) {
    const video = document.querySelector<HTMLVideoElement>(selector);
    if (video) video.srcObject = null;
  }
}

function invalidateEndingRoomClick(event: MouseEvent): void {
  if (!ROOM_PAGE.test(location.pathname) || !(event.target instanceof Element)) return;
  // Leave/End Call routes through #leaveBtn. Reporting leaves after its async
  // submission, so invalidate at the initiating tap rather than after the fetch.
  if (event.target.closest("#leaveBtn, #reportBtn")) invalidatePendingMedia();
}

if (Capacitor.isNativePlatform()) {
  guardNativeMediaAcquisition();
  document.addEventListener("click", invalidateEndingRoomClick, {capture: true});
  window.addEventListener("pagehide", invalidatePendingMedia, {capture: true});
  window.addEventListener("lingua-app-state", event => {
    const state = event as CustomEvent<{isActive?: boolean}>;
    if (state.detail?.isActive !== false) return;
    // Invalidate before room.js handles the same background event. Any native
    // getUserMedia promise that resolves later will stop its tracks immediately.
    invalidatePendingMedia();
    resetRoomMediaChrome();
  }, {capture: true});
}
