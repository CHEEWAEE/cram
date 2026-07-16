import { useEffect, useState } from "react";
import { getDeferredPrompt, isInstalled, subscribe, promptInstall } from "./installPromptStore";

function InstallPrompt() {
  const [, forceUpdate] = useState(0);
  const [extra, setExtra] = useState("checking...");

  useEffect(() => subscribe(() => forceUpdate((n) => n + 1)), []);

  useEffect(() => {
    (async () => {
      const parts = [];
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        parts.push(
          "regs=" + regs.length,
          "state=" + (regs[0]?.active?.state || regs[0]?.installing?.state || regs[0]?.waiting?.state || "none")
        );
        parts.push("controller=" + !!navigator.serviceWorker.controller);
      } catch (e) {
        parts.push("swErr=" + e.message);
      }
      try {
        const res = await fetch("/manifest.webmanifest");
        const json = await res.json();
        parts.push("manifestOk=" + res.ok, "icons=" + json.icons?.length);
      } catch (e) {
        parts.push("manifestErr=" + e.message);
      }
      setExtra(parts.join(" "));
    })();
  }, []);

  if (isInstalled() || !getDeferredPrompt()) {
    // TEMPORARY diagnostic — remove once we know why the prompt isn't firing.
    return (
      <div className="install-prompt install-debug">
        debug: installed={String(isInstalled())} hasPrompt={String(!!getDeferredPrompt())}{" "}
        swSupported={String("serviceWorker" in navigator)} {extra}
      </div>
    );
  }

  return (
    <button className="install-prompt" onClick={promptInstall}>
      Install app
    </button>
  );
}

export default InstallPrompt;
