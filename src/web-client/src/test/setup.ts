// Runs before every client test file (vitest.config.ts): the jest-dom
// matchers (toBeInTheDocument, toHaveTextContent, ...) and an unmount of
// whatever a test rendered, so the next test starts with an empty document.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
    cleanup();
    try {
        window.localStorage.clear();
    } catch {
        // no storage - nothing to clear
    }
});
