// Room map images (docs/raidplan.md), pure: when an upload is too big or too large
// it is shrunk in the browser before it is sent, so the orga is not turned away by
// the server's 3 MB limit. Only the numbers live here (sizes, steps, the text shown);
// the canvas work is in pages/raid-detail/raidplan/mapUpload.ts. The server still
// checks the type by its first bytes and the size (the safety net stays).
//
// Written to be strippable (test/web-client/mapImage.test.js runs it): one-line
// signatures, no typed locals.

/** What the server accepts (raidplanStore.LIMITS.mapBytes = 3 MB). */
export const MAP_LIMIT_BYTES = 3 * 1024 * 1024;
/** What a shrunk map is aimed below: 2.8 MB, a little under the limit. */
export const MAP_TARGET_BYTES = Math.floor(2.8 * 1024 * 1024);
/** The longest edge a map keeps. */
export const MAP_MAX_EDGE = 2560;
/** Encoder qualities tried one after the other, best first. */
export const MAP_QUALITIES = [0.92, 0.85, 0.78, 0.7, 0.6];
/** When even the lowest quality is too big the picture is made smaller by these factors, one after the other. */
export const MAP_SHRINK_FACTORS = [1, 0.85, 0.7, 0.55, 0.4];
export const MAP_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Whether the file is one of the accepted image types (an animated GIF, an SVG or any other file is not). */
export function isMapType(type: string): boolean {
    return MAP_TYPES.indexOf(type) >= 0;
}

/** A small file of a sensible size is sent as it is (no needless loss of quality). */
export function needsCompression(bytes: number, width: number, height: number): boolean {
    return bytes > MAP_TARGET_BYTES || Math.max(width, height) > MAP_MAX_EDGE;
}

/** The size in px of a picture whose longest edge is at most `maxEdge`, proportions kept (never enlarged). */
export function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
    const longest = Math.max(width, height);
    if (!longest || longest <= maxEdge) return { width, height };
    const k = maxEdge / longest;
    return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Every (size factor, quality) the encoder is tried with, in order: lots of quality first, smaller picture only when needed. */
export function attempts(): { factor: number; quality: number }[] {
    const out = [];
    for (const factor of MAP_SHRINK_FACTORS) for (const quality of MAP_QUALITIES) out.push({ factor, quality });
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
