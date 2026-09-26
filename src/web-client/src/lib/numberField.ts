// The number fields of the raid plan (size, opacity, angle, counts): what a typed text becomes, and what the arrow keys do.
// Pure, so the rules are tested (src/web-client/src/lib/numberField.test.ts). Written with function declarations only (the tests load it).

/** A value inside min..max, rounded to a whole number (or to `decimals` places). */
export function clampNumber(value: number, min: number, max: number, decimals = 0): number {
    const f = Math.pow(10, decimals);
    const v = Math.round(value * f) / f;
    return Math.max(min, Math.min(max, v));
}

/**
 * What a typed text means: a number inside min..max, or the fallback (the last valid value) for an empty or unreadable
 * text. A comma is a decimal point ("1,5"), a unit the user typed ("80 %", "48px") is ignored, "150" in a field up to 100 is 100.
 */
export function parseNumberText(text: string, min: number, max: number, fallback: number, decimals = 0): number {
    const cleaned = String(text === null || text === undefined ? "" : text).trim().replace(",", ".").replace(/[^0-9.\-+]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === "+" || cleaned === ".") return fallback;
    const n = Number(cleaned);
    return Number.isFinite(n) ? clampNumber(n, min, max, decimals) : fallback;
}

/** The text a value is shown as: whole numbers without a decimal point. */
export function formatNumber(value: number, decimals = 0): string {
    if (!Number.isFinite(value)) return "";
    return decimals > 0 ? String(Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)) : String(Math.round(value));
}

/** Arrow up / down: one step (Shift = ten steps), kept inside the range. */
export function stepNumber(value: number, direction: number, step: number, big: boolean, min: number, max: number, decimals = 0): number {
    const s = (big ? step * 10 : step) * (direction < 0 ? -1 : 1);
    return clampNumber(value + s, min, max, decimals);
}
