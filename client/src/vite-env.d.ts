/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_WS_URL: string;
    readonly VITE_DEMO?: string;
    readonly VITE_REGISTRATION_ENABLED?: string;
    /** Name of the installed app (home screen, title); OpenFamily when empty. */
    readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
