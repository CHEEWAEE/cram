import { useEffect, useState } from "react";
import { getDeferredPrompt, isInstalled, subscribe, promptInstall } from "./installPromptStore";

function InstallPrompt() {
  const [, forceUpdate] = useState(0);

  useEffect(() => subscribe(() => forceUpdate((n) => n + 1)), []);

  if (isInstalled() || !getDeferredPrompt()) {
    // TEMPORARY diagnostic — remove once we know why the prompt isn't firing.
    return (
      <div className="install-prompt install-debug">
        debug: installed={String(isInstalled())} hasPrompt={String(!!getDeferredPrompt())}{" "}
        swSupported={String("serviceWorker" in navigator)}
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
