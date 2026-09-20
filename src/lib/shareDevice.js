// Wallet Court — Share device detection. Extracted from courtReceipt.js so
// it can be unit-tested without @/ alias resolution. Determines whether to
// use Web Share with files (mobile) or the desktop download + X Web Intent
// fallback. Never assumes navigator.share means the browser is mobile.

// Detect a genuinely mobile/touch-oriented device. Desktop macOS Chrome/Safari
// have navigator.share but open a generic share sheet without X — so we
// require both touch support AND a mobile UA string.
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const hasTouch = navigator.maxTouchPoints > 0 || (typeof window !== "undefined" && "ontouchstart" in window);
  const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(navigator.userAgent || "");
  return hasTouch && mobileUA;
}

// Check if Web Share with files is available. Only returns true on genuinely
// mobile devices with both navigator.share and navigator.canShare. Returns
// false on desktop, in cross-origin iframes, or when file sharing is not
// supported.
export function canShareFiles() {
  if (!isMobileDevice()) return false;
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.canShare !== "function") return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof window !== "undefined" && window.self !== window.top) return false;
  return true;
}