import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Build variants:
//  - default  → the web app / Windows-served SPA (PWA enabled, base '/').
//  - demo     → static demo (VITE_DEMO=true, sub-path base, no SW). The base
//               defaults to the GitHub Pages path; set VITE_DEMO_BASE to build
//               the demo for another host (e.g. '/demo/' for openfamily.fr).
//  - native   → Capacitor Android shell (`vite build --mode native`): base '/'
//               and NO service worker (the app shell is bundled in the APK).
export default defineConfig(({ mode }) => {
    const isDemo = process.env.VITE_DEMO === 'true';
    const isNativeBuild = mode === 'native';
    const usePwa = !isDemo && !isNativeBuild;
    // Name under the home-screen icon and in the tab (APP_NAME in the deploy .env).
    const appName = (process.env.VITE_APP_NAME || '').trim() || 'OpenFamily';
    const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // The icons can be redrawn with the app name (Dockerfile) under the same
    // file names: a version taken from their content makes phones fetch them
    // again instead of keeping the old ones.
    let iconVersion = '';
    try {
        iconVersion = crypto.createHash('md5').update(fs.readFileSync(path.resolve(__dirname, 'public/icon-512.png'))).digest('hex').slice(0, 8);
    } catch {
        iconVersion = '';
    }
    process.env.VITE_ICON_VERSION = iconVersion;
    const v = iconVersion ? `?v=${iconVersion}` : '';

    return {
        base: isDemo ? (process.env.VITE_DEMO_BASE || '/OpenFamily/demo/') : '/',
        plugins: [
            react(),
            {
                name: 'app-name',
                transformIndexHtml: (html: string) => html
                    .replace(/href="\/(favicon-[0-9x]+|apple-touch-icon)\.png"/g, `href="/$1.png${v}"`)
                    .replace(/__APP_NAME__/g, escapeHtml(appName))
                    .replace(/__APP_TITLE__/g, escapeHtml(appName === 'OpenFamily' ? 'OpenFamily - Gestion familiale' : appName)),
            },
            ...(usePwa ? [VitePWA({
                registerType: 'autoUpdate',
                strategies: 'injectManifest',
                srcDir: 'src',
                filename: 'sw.js',
                includeAssets: ['favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png', 'OpenFamily.png'],
                manifest: {
                    name: appName,
                    short_name: appName,
                    description: 'Application de gestion familiale',
                    theme_color: '#DC4A60',
                    background_color: '#F7F2E9',
                    display: 'standalone',
                    icons: [
                        { src: `/icon-192.png${v}`, sizes: '192x192', type: 'image/png' },
                        { src: `/icon-512.png${v}`, sizes: '512x512', type: 'image/png' },
                    ],
                },
                devOptions: { enabled: false },
            })] : []),
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        server: {
            port: 5173,
            proxy: {
                '/api': {
                    target: process.env.VITE_API_URL || 'http://localhost:3001',
                    changeOrigin: true,
                },
            },
        },
    };
});
