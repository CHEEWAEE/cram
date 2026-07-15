// Imported at the top of main.jsx so this listener attaches before React
// mounts — `beforeinstallprompt` can fire very early, and a React component's
// useEffect (which only runs post-mount) can miss it entirely.
let deferredPrompt = null;
let installed = false;
const listeners = new Set();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installed = true;
  listeners.forEach((fn) => fn());
});

export function getDeferredPrompt() {
  return deferredPrompt;
}

export function isInstalled() {
  return installed || window.matchMedia("(display-mode: standalone)").matches;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
}
