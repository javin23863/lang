(() => {
  "use strict";

  const back = document.getElementById("legalBack");
  if (!(back instanceof HTMLAnchorElement)) return;

  const value = new URLSearchParams(location.search).get("return") || "";
  // Return targets are deliberately relative and room-scoped. Preserve only
  // the two non-default call modes; never accept an origin, fragment, arbitrary
  // parameter, or the retired personal-label `n` query parameter.
  const webRoom = /^\/room\/[A-Za-z0-9_-]{24}\.\d{10}\.[A-Za-z0-9_-]{43}(?:\?m=(?:voice|chat))?$/;
  const nativeRoom = /^room\.html\?room=[A-Za-z0-9_-]{24}(?:\.|%2E)\d{10}(?:\.|%2E)[A-Za-z0-9_-]{43}(?:&m=(?:voice|chat))?$/i;
  if (webRoom.test(value) || nativeRoom.test(value)) back.href = value;
})();
