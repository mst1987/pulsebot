import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";

// Mirrors src/bot.js: prefer the worktree's .env.dev over .env, so `npm run dev`
// here picks up the same WEB_PORT the backend was started with (see CLAUDE.md
// "Local test instances") without having to export it manually.
const rootDir = path.resolve(__dirname, "..", "..");
const envDev = path.join(rootDir, ".env.dev");
dotenv.config({ path: existsSync(envDev) ? envDev : path.join(rootDir, ".env") });

const backendPort = process.env.WEB_PORT || "3005";

export default defineConfig(() => ({
    // The Node backend (src/web/staticClient.js) and the Vite dev server both
    // serve the app from the site root, so the base is the same either way.
    base: "/",
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                // The libraries change far less often than our own code: in
                // chunks of their own they stay cached across deploys (#436).
                // The pages are split by the lazy imports in App.tsx.
                manualChunks(id: string) {
                    // A language other than German is loaded only when chosen
                    // (i18n/index.ts) — as one chunk, not one per namespace.
                    const lang = id.match(/[\\/]i18n[\\/]locales[\\/](\w+)[\\/]/);
                    if (lang && lang[1] !== "de") return `i18n-${lang[1]}`;
                    if (!id.includes("node_modules")) return undefined;
                    if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons";
                    if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return "vendor-react";
                    return undefined;
                },
            },
        },
    },
    server: {
        port: Number(process.env.WEB_CLIENT_PORT) || 4015,
        // src/config/menu.json lives outside the client's own folder — the menu
        // list is shared with the server-rendered report chrome.
        fs: { allow: [__dirname, path.join(rootDir, "src", "config")] },
        proxy: {
            "/api": `http://localhost:${backendPort}`,
        },
    },
}));
