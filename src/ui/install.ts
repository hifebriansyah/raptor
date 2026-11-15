/**
 * "Install app" support (PWA): registers the service worker, keeps the browser's install prompt
 * for the menu button, and reports what the button should say.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;

export type InstallState = 'ready' | 'installed' | 'ios' | 'unsupported';

function changed(): void {
  window.dispatchEvent(new Event('install-state'));
}

export function setupInstall(): void {
  installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
  // Offline cache (production builds only: the dev server reloads modules itself)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

export function installState(): InstallState {
  if (installed) return 'installed';
  if (deferred) return 'ready';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return ios ? 'ios' : 'unsupported';
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice.catch(() => null);
  if (choice?.outcome === 'accepted') installed = true;
  changed();
}
