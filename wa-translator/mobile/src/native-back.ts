import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

const ROOM_PAGE = /(?:^|\/)room\.html$/;

function clickIfVisible(buttonId: string, panelId: string): boolean {
  const panel = document.querySelector<HTMLElement>(`${panelId}:not([hidden])`);
  const button = document.querySelector<HTMLButtonElement>(buttonId);
  if (!panel || !button) return false;
  button.click();
  return true;
}

function handleRoomBack(): boolean {
  if (!ROOM_PAGE.test(location.pathname)) return false;

  // Back first unwinds temporary room UI before it can end the conversation.
  if (clickIfVisible("#qrBtn", "#qrBox")) return true;
  if (clickIfVisible("#menuBtn", "#roomMenu")) return true;

  // Room entry uses location.replace(), so hardware Back cannot rely on WebView
  // history to return home. Route through the existing Leave control so its
  // signalling/media/translation cleanup runs before the bridge returns home.
  const leave = document.querySelector<HTMLButtonElement>("#leaveBtn");
  if (leave) leave.click();
  else window.location.replace("index.html");
  return true;
}

if (Capacitor.getPlatform() === "android") {
  void App.addListener("backButton", ({canGoBack}) => {
    if (handleRoomBack()) return;
    if (canGoBack) {
      window.history.back();
      return;
    }
    void App.exitApp();
  }).catch(() => {});
}
