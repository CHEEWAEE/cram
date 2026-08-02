import { useEffect, useState } from "react";
import { getDeferredPrompt, isInstalled, subscribe, promptInstall } from "./installPromptStore";

function InstallPrompt() {
  const [, forceUpdate] = useState(0);

  useEffect(() => subscribe(() => forceUpdate((n) => n + 1)), []);

  if (isInstalled() || !getDeferredPrompt()) return null;

  return (
    <button className="install-prompt" onClick={promptInstall}>
      Install app
    </button>
  );
}

export default InstallPrompt;
