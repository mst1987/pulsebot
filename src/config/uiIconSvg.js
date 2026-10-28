// The app's own icon set (#951) for server-rendered HTML — the CommonJS twin of
// src/web-client/src/lib/ui/iconSet.ts + components/ui/Icon.tsx. The glyphs are
// uiIcons.json (the paths of the accepted canvas of #951, changed only there first): one even-odd path on a
// 24 × 24 grid and one of four tones, drawn in `var(--icon-<tone>)`. The line
// icons are uiLineIcons.json (same source): stroke paths in currentColor for
// actions and states. The brand marks are drawn as the brands ship them;
// Discord always in its Blurple.
const UI_ICONS = require("./uiIcons.json");
const UI_LINE_ICONS = require("./uiLineIcons.json");

/** Discord's mark; iconSet.ts holds the same path (test/config/uiIconSvg.test.js). */
const DISCORD_PATH = "M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.1.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z";

/** Brand marks as images under the client's public/brands/ (Discord is the path above). */
const BRAND_FILES = {
    raidHelper: "/brands/raid-helper.png",
    warcraftLogs: "/brands/warcraftlogs.png",
    wowhead: "/brands/wowhead.png",
    softres: "/brands/softres.png",
    googleSheets: "/brands/google-sheets.png",
};

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** true for a key of the set (glyph or brand). */
function isUiIcon(name) {
    return has(UI_ICONS, name) || has(UI_LINE_ICONS, name) || name === "discord" || has(BRAND_FILES, name);
}

/**
 * The icon as an HTML string: inline SVG for a glyph or Discord, <img> for the
 * other brands. Classes "wi uic" like the client's <Icon/>; decorative
 * (aria-hidden, empty alt) — the label next to it carries the meaning.
 * An unknown name gives "".
 */
function uiIconSvg(name, size = 24) {
    const s = Number(size) || 24;
    if (name === "discord") {
        return `<svg class="wi uic uic-brand uic-discord" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" d="${DISCORD_PATH}"/></svg>`;
    }
    if (has(BRAND_FILES, name)) {
        return `<img class="wi uic uic-brand uic-${name}" src="${BRAND_FILES[name]}" width="${s}" height="${s}" alt="">`;
    }
    if (has(UI_LINE_ICONS, name)) {
        const paths = UI_LINE_ICONS[name].map(d => `<path d="${d}"/>`).join("");
        return `<svg class="wi uic uic-line" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    }
    if (!has(UI_ICONS, name)) return "";
    const glyph = UI_ICONS[name];
    return `<svg class="wi uic uic-${glyph.tone}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${glyph.d}"/></svg>`;
}

module.exports = { uiIconSvg, isUiIcon, UI_ICONS, UI_LINE_ICONS, BRAND_FILES, DISCORD_PATH };
