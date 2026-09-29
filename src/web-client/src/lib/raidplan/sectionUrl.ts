// The open section of a raid plan in the address (#555): the read view /p/<token> and the editor write the chosen boss as
// `#boss=<key>`, so a reload or a shared link lands on the same boss. The query `?section=<key>` stays the explicit deep
// link (it pauses following the log, #534); the hash only restores and never pauses. Changing the hash goes through
// history.replaceState - no new history entry, no navigation, the router's own state is kept.

const HASH_KEY = "boss";

/** The section a hash names (`#boss=bt/supremus`), "" when it names none. Other hash parts are ignored. */
export function sectionFromHash(hash: string): string {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    return (params.get(HASH_KEY) || "").trim();
}

/** The hash with the section set (or removed for ""), other hash parts kept; "" when nothing is left. The slash of a key stays readable. */
export function hashWithSection(hash: string, key: string): string {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (key) params.set(HASH_KEY, key); else params.delete(HASH_KEY);
    const text = params.toString().replace(/%2F/gi, "/");
    return text ? `#${text}` : "";
}

/**
 * The section the address asks for: the hash `#boss=` first (the section last shown in this address), else the deep link
 * `?section=` (a fresh deep link carries no hash yet).
 */
export function sectionFromUrl(loc: { search: string; hash: string } = window.location): string {
    return sectionFromHash(loc.hash) || (new URLSearchParams(loc.search).get("section") || "").trim();
}

/** Whether the address carries the explicit deep link `?section=` (which pauses following the log). */
export function hasSectionDeepLink(loc: { search: string } = window.location): boolean {
    return !!new URLSearchParams(loc.search).get("section");
}

/**
 * Writes the chosen section into the address as `#boss=<key>` without a new history entry; path and query stay as they
 * are (the editor's router keeps its own view of them). Does nothing when the address already says so.
 */
export function showSectionInUrl(key: string): void {
    try {
        const loc = window.location;
        const hash = hashWithSection(loc.hash, key);
        if (hash === loc.hash) return;
        window.history.replaceState(window.history.state, "", `${loc.pathname}${loc.search}${hash}`);
    } catch { /* a sandboxed frame without history access: the section just is not kept */ }
}
