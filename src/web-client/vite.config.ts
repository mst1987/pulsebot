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

export default defineConfig(({ command }) => ({
    // Production build is served by the Node backend under /admin2/ (see
    // src/web/staticClient.js); dev keeps the default root base for the Vite server.
    base: command === "build" ? "/admin2/" : "/",
    plugins: [react()],
    server: {
        port: Number(process.env.WEB_CLIENT_PORT) || 4015,
        proxy: {
            "/api": `http://localhost:${backendPort}`,
        },
    },
}));
