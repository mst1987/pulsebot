// The one icon set of the app (#951), three kinds:
//   glyphs  — filled fantasy silhouettes in one of four tones for the app's
//             areas (menu, settings): src/config/uiIcons.json
//   lines   — plain line icons for actions and states (edit, delete, search …),
//             stroked in currentColor like components/ui/icons/icons.tsx:
//             src/config/uiLineIcons.json
//   brands  — the marks of the services the app talks to, never recoloured
// Both JSON files hold the paths of the accepted design canvas (#951, board
// "Runde 6"), shared with the server-rendered chrome (src/config/uiIconSvg.js);
// a new or changed icon is drawn in the canvas first, then copied over. Game content (bosses,
// items, classes, specs, roles, raid markers) stays a zamimg WowIcon; game
// versions show their Battle.net launcher icon from public/versions/ through
// WowIcon's local branch — this set is only for the app itself.
import UI_ICONS_JSON from "../../../../config/uiIcons.json";
import UI_LINE_ICONS_JSON from "../../../../config/uiLineIcons.json";

export type IconTone = "blood" | "bronze" | "arcane" | "fel";

export type UiGlyph = { tone: IconTone; d: string };

export const UI_GLYPHS = UI_ICONS_JSON as Record<keyof typeof UI_ICONS_JSON, UiGlyph>;

/** Line icons: the stroke paths of one icon (no tone — currentColor). */
export const UI_LINE_ICONS = UI_LINE_ICONS_JSON as Record<keyof typeof UI_LINE_ICONS_JSON, string[]>;

/** Brand marks: drawn as the brand ships them, never recoloured. */
export const BRAND_ICONS = {
    discord: "",
    raidHelper: "/brands/raid-helper.png",
    warcraftLogs: "/brands/warcraftlogs.png",
    wowhead: "/brands/wowhead.png",
    softres: "/brands/softres.png",
    googleSheets: "/brands/google-sheets.png",
} as const;

export type UiGlyphName = keyof typeof UI_ICONS_JSON;
export type BrandIconName = keyof typeof BRAND_ICONS;
export type UiLineIconName = keyof typeof UI_LINE_ICONS_JSON;
export type UiIconName = UiGlyphName | UiLineIconName | BrandIconName;

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export function isBrandIcon(name: string): name is BrandIconName {
    return has(BRAND_ICONS, name);
}

export function isUiGlyph(name: string): name is UiGlyphName {
    return has(UI_GLYPHS, name);
}

export function isUiLineIcon(name: string): name is UiLineIconName {
    return has(UI_LINE_ICONS, name);
}

/** true for a key of the set — anything else is a zamimg icon name. */
export function isUiIcon(name: string): name is UiIconName {
    return isUiGlyph(name) || isUiLineIcon(name) || isBrandIcon(name);
}

/**
 * The viewBox of the filled marks (glyphs, Discord): the 24 × 24 grid with a
 * 2-unit margin, so they sit a bit smaller than the box a page gives them and
 * do not outweigh the label next to them. Line icons keep 0 0 24 24.
 * uiIconSvg.js holds the same value (test/config/uiIconSvg.test.js).
 */
export const GLYPH_VIEWBOX = "-2 -2 28 28";

/** Discord's mark, always in its Blurple (brand rule: no recolouring). */
export const DISCORD_PATH = "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z";
