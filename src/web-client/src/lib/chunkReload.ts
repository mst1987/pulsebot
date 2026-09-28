import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// After a deploy (#530) the chunks of the previous build are gone: every file
// under /assets/ carries its content hash in the name, and a new build brings
// new names. A tab that was opened before the deploy still knows only the old
// names, so the next lazy page (or the raid plan tab) asks for a file the server
// now answers with a 404. The fix is the new index.html — so the page reloads
// itself, ONCE: a marker in sessionStorage with a time window keeps a chunk that
// is really broken from turning into a reload loop. When the marker is still
// fresh, the error goes on to <ChunkErrorBoundary>, which offers the reload as a
// button ("Neue Version verfügbar").

/** The sessionStorage key of the last automatic reload (a timestamp in ms). */
export const RELOAD_MARKER = "eh-chunk-reload-at";

/** How long after an automatic reload a second chunk error is not reloaded again. */
export const RELOAD_WINDOW_MS = 30_000;

// Chrome/Edge, Firefox, Safari and Vite's own preload helper word it differently.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i;

/** True for the error a missing or unloadable chunk throws. */
export function isChunkLoadError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    return CHUNK_ERROR.test(message);
}

type MarkerStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Decides whether a chunk error may reload the page now, and if so sets the
 * marker. False while the last automatic reload is less than `windowMs` ago,
 * and false when there is no storage to remember it in (no marker, no loop guard,
 * so no automatic reload either).
 */
export function claimReload(storage: MarkerStore | null, now: number, windowMs = RELOAD_WINDOW_MS): boolean {
    if (!storage) return false;
    try {
        const last = Number(storage.getItem(RELOAD_MARKER));
        if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < windowMs) return false;
        storage.setItem(RELOAD_MARKER, String(now));
        return true;
    } catch {
        return false;
    }
}

function sessionStore(): MarkerStore | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

// A reload asked for in this page already: the preload event and the failing
// import of the same chunk both land here, and the second must not end up in the
// error boundary (flashing "new version") while the page is going away anyway.
let reloading = false;

/** Only for the tests: forget a reload asked for earlier. */
export function resetReloadState(): void {
    reloading = false;
}

/** Reloads the page for a new build when the loop guard allows it; true when it did (or already does). */
export function reloadForNewVersion(
    storage: MarkerStore | null = sessionStore(),
    now = Date.now(),
    reload: () => void = () => window.location.reload(),
): boolean {
    if (reloading) return true;
    if (!claimReload(storage, now)) return false;
    reloading = true;
    reload();
    return true;
}

/**
 * `lazy()` for a page chunk: a chunk that cannot be loaded reloads the page
 * (once); the promise then never settles, so the loader stays up until the new
 * page is there. Any other error, and a second chunk error inside the window,
 * is thrown on to the error boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the same bound as React.lazy itself
export function lazyWithReload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
    reload: (err: unknown) => boolean = (err) => isChunkLoadError(err) && reloadForNewVersion(),
): LazyExoticComponent<T> {
    return lazy(() => factory().catch((err: unknown) => {
        if (reload(err)) return new Promise<{ default: T }>(() => { /* the page is reloading */ });
        throw err;
    }));
}

/**
 * Vite fires `vite:preloadError` when a chunk's preloaded dependency (a CSS
 * file, a shared chunk) fails. Reloading there — and suppressing the error —
 * catches the deploy case before the import itself rejects.
 */
export function installPreloadErrorReload(target: Pick<Window, "addEventListener"> = window, reload: () => boolean = () => reloadForNewVersion()): void {
    target.addEventListener("vite:preloadError", (event: Event) => {
        if (reload()) event.preventDefault();
    });
}
