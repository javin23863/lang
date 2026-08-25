import { Capacitor } from "@capacitor/core";

const ROOM_PAGE = /(?:^|\/)room\.html$/;

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

if (Capacitor.isNativePlatform()) {
  window.addEventListener("lingua-app-state", event => {
    const state = event as CustomEvent<{isActive?: boolean}>;
    if (state.detail?.isActive !== false) return;
    resetRoomMediaChrome();
  }, {capture: true});
}
