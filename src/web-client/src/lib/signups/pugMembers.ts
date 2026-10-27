// PuG raids on the web only for members of the PuG server (#907): what the
// signup dialog shows a non-member, and the small guards around it.

/** Only an https link becomes a link target ("" otherwise) — the server checks it too. */
export function safeInviteUrl(url: unknown): string {
    const s = typeof url === "string" ? url.trim() : "";
    return /^https:\/\/\S+$/i.test(s) ? s : "";
}

/**
 * The text of a refused save: the error's message when it has one, else the
 * general fallback — an unknown error shape (a bare string, nothing) never
 * ends in an empty toast.
 */
export function errorText(err: unknown, fallback: string): string {
    if (typeof err === "string" && err.trim()) return err.trim();
    const message = err && typeof err === "object" ? (err as { message?: unknown }).message : undefined;
    return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

/**
 * Roving focus in a group of radio chips (#907): the arrow keys move to the
 * neighbour (wrapping), Home/End to the ends; any other key: null.
 */
export function rovingIndex(current: number, count: number, key: string): number | null {
    if (count <= 0) return null;
    if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
    if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    return null;
}
