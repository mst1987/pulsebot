// The reload after a deploy (#530): a chunk of the previous build is gone, the
// page reloads ONCE, and a second failure inside the window ends in the notice
// of ChunkErrorBoundary instead of a reload loop.
import { Component, Suspense, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    RELOAD_MARKER, RELOAD_WINDOW_MS, claimReload, installPreloadErrorReload, isChunkLoadError, lazyWithReload,
    reloadForNewVersion, resetReloadState,
} from "./chunkReload";
import ChunkErrorBoundary from "../components/shell/ChunkErrorBoundary";

/** A sessionStorage stand-in. */
function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
        setItem: (k: string, v: string) => { data.set(k, v); },
        data,
    };
}

const CHUNK_ERR = new TypeError("Failed to fetch dynamically imported module: https://x/assets/RaidplanTab-CZfoAiL2.js");

// React and jsdom report every error a boundary catches on console.error.
const consoleError = vi.spyOn(console, "error");
beforeEach(() => {
    resetReloadState();
    consoleError.mockImplementation(() => undefined);
});
afterEach(() => consoleError.mockReset());

describe("isChunkLoadError", () => {
    it("knows the wording of every browser and of Vite's preload helper", () => {
        expect(isChunkLoadError(CHUNK_ERR)).toBe(true);
        expect(isChunkLoadError(new TypeError("error loading dynamically imported module: /assets/a.js"))).toBe(true);
        expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
        expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    });

    it("leaves every other error alone", () => {
        expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError({ message: "Failed to fetch dynamically imported module" })).toBe(false);
    });
});

describe("claimReload", () => {
    it("allows the first reload and sets the marker", () => {
        const s = memoryStorage();
        expect(claimReload(s, 1_000_000)).toBe(true);
        expect(s.data.get(RELOAD_MARKER)).toBe("1000000");
    });

    it("refuses a second reload inside the window", () => {
        const s = memoryStorage();
        expect(claimReload(s, 1_000_000)).toBe(true);
        expect(claimReload(s, 1_000_000 + RELOAD_WINDOW_MS - 1)).toBe(false);
    });

    it("allows a reload again once the window is over (the next deploy)", () => {
        const s = memoryStorage({ [RELOAD_MARKER]: "1000000" });
        expect(claimReload(s, 1_000_000 + RELOAD_WINDOW_MS)).toBe(true);
        expect(s.data.get(RELOAD_MARKER)).toBe(String(1_000_000 + RELOAD_WINDOW_MS));
    });

    it("ignores a broken marker and one from the future (clock changed)", () => {
        expect(claimReload(memoryStorage({ [RELOAD_MARKER]: "kaputt" }), 5_000)).toBe(true);
        expect(claimReload(memoryStorage({ [RELOAD_MARKER]: "99999999" }), 5_000)).toBe(true);
    });

    it("never reloads without a storage to guard the loop", () => {
        expect(claimReload(null, 5_000)).toBe(false);
        const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined };
        expect(claimReload(throwing, 5_000)).toBe(false);
    });
});

describe("reloadForNewVersion", () => {
    it("reloads once, and a second chunk error of the same page does not reload again", () => {
        const s = memoryStorage();
        const reload = vi.fn();
        expect(reloadForNewVersion(s, 1_000, reload)).toBe(true);
        // the preload event and the import of the same chunk both land here
        expect(reloadForNewVersion(s, 1_001, reload)).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("does not reload after a reload inside the window (the page came back broken)", () => {
        const s = memoryStorage({ [RELOAD_MARKER]: "1000" });
        const reload = vi.fn();
        expect(reloadForNewVersion(s, 2_000, reload)).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});

describe("installPreloadErrorReload", () => {
    it("swallows vite:preloadError when it reloads, and lets it through when it does not", () => {
        const target = new EventTarget();
        const decide = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
        installPreloadErrorReload(target as unknown as Window, decide);
        const first = new Event("vite:preloadError", { cancelable: true });
        target.dispatchEvent(first);
        expect(first.defaultPrevented).toBe(true);
        const second = new Event("vite:preloadError", { cancelable: true });
        target.dispatchEvent(second);
        expect(second.defaultPrevented).toBe(false);
    });
});

describe("lazyWithReload", () => {

    it("renders the component when its chunk loads", async () => {
        const Page = lazyWithReload(async () => ({ default: () => <p>Seite da</p> }));
        render(<ChunkErrorBoundary><Suspense fallback={<p>lädt</p>}><Page /></Suspense></ChunkErrorBoundary>);
        expect(await screen.findByText("Seite da")).toBeInTheDocument();
    });

    it("keeps the loader up while the page reloads for a missing chunk", async () => {
        const reload = vi.fn(() => true);
        const Page = lazyWithReload(() => Promise.reject(CHUNK_ERR), reload);
        render(<ChunkErrorBoundary><Suspense fallback={<p>lädt</p>}><Page /></Suspense></ChunkErrorBoundary>);
        await vi.waitFor(() => expect(reload).toHaveBeenCalledWith(CHUNK_ERR));
        expect(screen.getByText("lädt")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("shows the new-version notice with a reload button when it may not reload again", async () => {
        const Page = lazyWithReload(() => Promise.reject(CHUNK_ERR), () => false);
        render(<ChunkErrorBoundary><Suspense fallback={<p>lädt</p>}><Page /></Suspense></ChunkErrorBoundary>);
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Neue Version verfügbar");
        expect(screen.getByRole("button", { name: "Seite neu laden" })).toBeInTheDocument();
    });

    it("hands any other error on past the boundary", async () => {
        const Page = lazyWithReload(() => Promise.reject(new Error("kaputt")), () => false);
        render(
            <Outer>
                <ChunkErrorBoundary><Suspense fallback={<p>lädt</p>}><Page /></Suspense></ChunkErrorBoundary>
            </Outer>,
        );
        expect(await screen.findByText("outer: kaputt")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();
    });
});

/** An outer boundary that shows what reached it. */
class Outer extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        return this.state.error ? <p>outer: {this.state.error.message}</p> : this.props.children;
    }
}

describe("ChunkErrorBoundary", () => {
    it("tries again on a new resetKey (another page)", async () => {
        const Page = lazyWithReload(() => Promise.reject(CHUNK_ERR), () => false);
        const { rerender } = render(<ChunkErrorBoundary resetKey="/a"><Suspense fallback={<p>lädt</p>}><Page /></Suspense></ChunkErrorBoundary>);
        await screen.findByRole("alert");
        rerender(<ChunkErrorBoundary resetKey="/b"><p>andere Seite</p></ChunkErrorBoundary>);
        expect(await screen.findByText("andere Seite")).toBeInTheDocument();
    });
});
