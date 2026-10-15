// Installing the web app on a phone (foyers fork). On iPhone the app has to be
// added to the home screen from Safari's Share menu before it can run full
// screen and receive notifications; nothing in the browser offers it.

/** The name under the home-screen icon, set when the image is built (APP_NAME). */
export const APP_NAME = (import.meta.env.VITE_APP_NAME ?? '').trim() || 'OpenFamily';

/** The logo, with a version so a redrawn logo is not taken from an old cache. */
export const LOGO_URL = `${import.meta.env.BASE_URL}OpenFamily.png${import.meta.env.VITE_ICON_VERSION ? `?v=${import.meta.env.VITE_ICON_VERSION}` : ''}`;

export const isIos = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    // iPadOS presents itself as a Mac with a touch screen.
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const isStandalone = (): boolean => {
    if (typeof window === 'undefined') return false;
    const nav = navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
};

/** On an iPhone, in the browser rather than the installed app. */
export const needsHomeScreenInstall = (): boolean => isIos() && !isStandalone();

/**
 * Forget the data kept for offline use (the service worker's copy of API
 * answers). Done when signing in, out, or opening another household, so a
 * phone never shows offline what another account or household loaded.
 */
export const clearApiCache = async (): Promise<void> => {
    try {
        if (typeof caches === 'undefined') return;
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.includes('-api-')).map((name) => caches.delete(name)));
    } catch {
        // Nothing cached, or storage unavailable (private browsing).
    }
};

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
    Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);

/**
 * Signing out on a phone: it stops receiving the notifications of every
 * household this account can open, and its push subscription is dropped, so
 * the next person who signs in on it starts clean. `forget` asks the server
 * (still signed in) to delete the subscription.
 */
export const releaseDevice = async (forget: ((endpoint: string) => Promise<unknown>) | null): Promise<void> => {
    try {
        if ('serviceWorker' in navigator && 'PushManager' in window) {
            const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 2000);
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
                if (forget) await withTimeout(forget(sub.endpoint).catch(() => undefined), 3000);
                await sub.unsubscribe().catch(() => false);
            }
        }
    } catch {
        // Offline or no service worker: the subscription is cleaned up the
        // next time someone enables notifications on this phone.
    }
    await clearApiCache();
};
