import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The client's tests (#435): the same Vite pipeline as the app (TSX, JSON,
// import.meta.glob), run in jsdom. Tests sit next to their module as
// src/**/*.test.ts(x); the root Jest never sees them (its testMatch is
// test/**/*.test.js). How to write one: docs/testing.md, "Web-Client".

// The raiders and the orga are in Central Europe, and the pages show local
// times: every run (a laptop, the CI's UTC runner) uses the same zone, so a
// "20:00 + 2h15 = Ende 22:15" reads the same everywhere. Set before the test
// workers start, which inherit it.
process.env.TZ = "Europe/Berlin";

export default defineConfig((env) => mergeConfig(viteConfig(env), {
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.{ts,tsx}"],
        setupFiles: ["./src/test/setup.ts"],
        clearMocks: true,
        restoreMocks: true,
    },
}));
