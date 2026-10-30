// The colour of a game version (#742, design canvas variant B): the whole
// accent of the web admin (buttons, active menu line, links, focus ring,
// selected chips) takes the colour of the version the content switch shows.
//
// The defaults live in styles/tokens.css (--ver-<id>, dark and light, checked
// against WCAG AA by versionColor.test.ts). The colour is a setting per
// version though (Einstellungen → Spielversion): the server sends the colour
// in the session's content (`color`, `custom` = differs from the rule set's),
// and this file turns a custom one into the four values a theme needs:
//
//   dark theme   the colour, lightened until it reads on the dark panels (4.5:1)
//   light theme  the colour, darkened until it reads on the light panels (4.5:1)
//   ink          the text on a filled button: dark or white, whichever is stronger
//
// They are written to the root as --vc-<id>-dark / -light / -ink-dark / -ink-light,
// which tokens.css reads with the default as fallback. The version in use is
// marked by <html data-version="<id>"> (a version-neutral page leaves it off).
import type { ContentVersionRef } from "../../api/system/session";

export const DARK_BG = "#30353f";   // the lightest dark panel (--panel3)
export const LIGHT_BG = "#e2e6ee";  // the darkest light panel (--panel3)
export const INK_DARK = "#0b0f14";
export const INK_LIGHT = "#ffffff";
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string): boolean {
    return HEX.test(value);
}

function channels(hex: string): [number, number, number] {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: number[]): string {
    return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `hex` mixed with `target` by the share `t` (0 = hex, 1 = target). */
function mix(hex: string, target: string, t: number): string {
    const from = channels(hex);
    const to = channels(target);
    return toHex(from.map((v, i) => v + (to[i] - v) * t));
}

/** The colour moved towards `target` in small steps until it reaches AA on `bg`. */
function reach(hex: string, bg: string, target: string): string {
    for (let t = 0; t <= 1; t += 0.02) {
        const candidate = mix(hex, target, t);
        if (contrast(candidate, bg) >= MIN_CONTRAST) return candidate;
    }
    return target;
}

/** The text colour for a fill: the dark ink or white, whichever is stronger. */
export function inkOn(fill: string): string {
    return contrast(fill, INK_DARK) >= contrast(fill, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

export type VersionPalette = { dark: string; light: string; inkDark: string; inkLight: string };

/** The four theme values of a configured colour, each reaching AA where it is used. */
export function derivePalette(hex: string): VersionPalette {
    const base = hex.toLowerCase();
    const dark = reach(base, DARK_BG, "#ffffff");
    const light = reach(base, LIGHT_BG, "#000000");
    return { dark, light, inkDark: inkOn(dark), inkLight: inkOn(light) };
}

/**
 * Writes the custom colours of `versions` to the root as --vc-* variables and
 * removes the ones that went back to the default, so tokens.css' fallback applies.
 */
export function applyVersionColors(root: HTMLElement, versions: Pick<ContentVersionRef, "id" | "color" | "custom">[]): void {
    for (const v of versions) {
        const names = ["dark", "light", "ink-dark", "ink-light"].map((n) => `--vc-${v.id}-${n}`);
        if (!v.custom || !v.color || !isHexColor(v.color)) {
            for (const name of names) root.style.removeProperty(name);
            continue;
        }
        const p = derivePalette(v.color);
        [p.dark, p.light, p.inkDark, p.inkLight].forEach((value, i) => root.style.setProperty(names[i], value));
    }
}

/** Marks the version in use on the root; null (a version-neutral page, no session content) leaves the brand colours. */
export function markVersion(root: HTMLElement, versionId: string | null): void {
    if (versionId) root.setAttribute("data-version", versionId);
    else root.removeAttribute("data-version");
}
