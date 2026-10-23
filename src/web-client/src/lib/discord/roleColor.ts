// A Discord role colour as text on the page (System › Discord › Mitglieder and
// Rollen): Discord lets any colour through, so a pale yellow vanishes on the light
// panel and a dark blue on the dark one. Each colour gets a variant for each theme,
// moved towards black or white just far enough to be readable; the dot keeps the
// real colour. The CSS picks the variant by theme (styles/discord-members.css,
// styles/server-roles.css).

/** The panels the names stand on (styles/tokens.css: --panel light, --bg dark). */
const LIGHT_BG = "#ffffff";
const DARK_BG = "#17181a";
/** WCAG AA for normal text. */
const MIN_RATIO = 4.5;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
    return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
    const lin = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast of two colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return 1;
    const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/** The colour moved towards `target` in small steps until it reads on `bg`; unchanged when it already does. */
export function readableOn(hex: string, bg: string, target: "black" | "white"): string {
    const c = parseHex(hex);
    if (!c) return "";
    const to: Rgb = target === "black" ? [0, 0, 0] : [255, 255, 255];
    for (let step = 0; step <= 20; step++) {
        const k = step / 20;
        const mixed: Rgb = [0, 1, 2].map((i) => c[i] + (to[i] - c[i]) * k) as Rgb;
        const out = toHex(mixed);
        if (contrastRatio(out, bg) >= MIN_RATIO) return out;
    }
    return target === "black" ? "#000000" : "#ffffff";
}

/** A role colour's text variants for the light and the dark theme; null for no colour. */
export function roleTextColors(hex: string): { light: string; dark: string } | null {
    if (!hex || !parseHex(hex)) return null;
    return { light: readableOn(hex, LIGHT_BG, "black"), dark: readableOn(hex, DARK_BG, "white") };
}

/**
 * The CSS variables a coloured role name gets: `--<prefix>-color` (the real colour,
 * for the dot) and `--<prefix>-color-light` / `-dark` (the text per theme); undefined
 * for no colour.
 */
export function roleColorVars(prefix: "dmb" | "drl", hex: string): Record<string, string> | undefined {
    const c = roleTextColors(hex);
    if (!c) return undefined;
    return { [`--${prefix}-color`]: hex, [`--${prefix}-color-light`]: c.light, [`--${prefix}-color-dark`]: c.dark };
}
