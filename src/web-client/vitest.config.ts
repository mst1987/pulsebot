import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The client's tests (#435): the same Vite pipeline as the app (TSX, JSON,
// import.meta.glob), run in jsdom. Tests sit next to their module as
// src/**/*.test.ts(x); the root Jest never sees them (its testMatch is
// test/**/*.test.js). How to write one: docs/testing.md, "Web-Client".
export default defineConfig((env) => mergeConfig(viteConfig(env), {
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.{ts,tsx}"],
        setupFiles: ["./src/test/setup.ts"],
        clearMocks: true,
        restoreMocks: true,
    },
}));
