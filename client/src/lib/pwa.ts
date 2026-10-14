// Installing the web app on a phone (foyers fork). On iPhone the app has to be
// added to the home screen from Safari's Share menu before it can run full
// screen and receive notifications; nothing in the browser offers it.

/** The name under the home-screen icon, set when the image is built (APP_NAME). */
export const APP_NAME = (import.meta.env.VITE_APP_NAME ?? '').trim() || 'OpenFamily';

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
