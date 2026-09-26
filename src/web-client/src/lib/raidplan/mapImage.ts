// Room map images (docs/raidplan.md), pure: when an upload is too big or too large
// it is shrunk in the browser before it is sent, so the orga is not turned away by
// the server's 3 MB limit - or, in front of it, by a reverse proxy: nginx refuses a body
// over its default client_max_body_size of 1 MB with an HTML "413 Request Entity Too Large". Only the numbers live here (sizes, steps, the text shown);
// the canvas work is in pages/raid-detail/raidplan/mapUpload.ts. The server still
// checks the type by its first bytes and the size (the safety net stays).
//
// Written to be strippable (src/web-client/src/lib/mapImage.test.ts runs it): one-line
// signatures, no typed locals.

/** What the server accepts (raidplanStore.LIMITS.mapBytes = 3 MB). */
export const MAP_LIMIT_BYTES = 3 * 1024 * 1024;
/** What a map is sent as at most: 900 KB, under the 1 MB default limit of a reverse proxy (nginx) with room for the multipart overhead. */
export const MAP_TARGET_BYTES = 900 * 1024;
/** The longest edges tried, biggest first (a smaller picture only when the quality alone does not get it under the target). */
export const MAP_EDGES = [2560, 2048, 1600, 1280, 1024];
/** The longest edge a map keeps. */
export const MAP_MAX_EDGE = 2560;
/** Encoder qualities tried one after the other, best first. */
export const MAP_QUALITIES = [0.92, 0.85, 0.78, 0.7, 0.6];
export const MAP_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Whether the file is one of the accepted image types (an animated GIF, an SVG or any other file is not). */
export function isMapType(type: string): boolean {
    return MAP_TYPES.indexOf(type) >= 0;
}

/** A file that is already small enough is sent as it is (no needless loss of quality), whatever its pixels. */
export function needsCompression(bytes: number): boolean {
    return bytes > MAP_TARGET_BYTES;
}

/** The size in px of a picture whose longest edge is at most `maxEdge`, proportions kept (never enlarged). */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!longest || longest <= maxEdge) return { width, height };
    const k = maxEdge / longest;
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Every (longest edge, quality) the encoder is tried with, in order: the biggest picture with the best quality first, smaller only when needed. */
export function attempts(): { edge: number; quality: number }[] {
    const out: { edge: number; quality: number }[] = [];
    for (const edge of MAP_EDGES) for (const quality of MAP_QUALITIES) out.push({ edge, quality });
    return out;
}

/** The type to encode to: WebP (keeps transparency), JPEG when the browser cannot write WebP. */
export function outputType(webpSupported: boolean): string {
    return webpSupported ? "image/webp" : "image/jpeg";
}

/** The file name with the extension of its new type. */
export function renamedFor(name: string, type: string): string {
    const base = String(name || "map").replace(/\.[A-Za-z0-9]+$/, "") || "map";
    return `${base}.${type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg"}`;
}

/** "4,8 MB" / "4.8 MB" (locale: "de-DE"), or "640 KB" below one megabyte. */
export function formatBytes(bytes: number, loc: string): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}
