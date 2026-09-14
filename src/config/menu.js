// The admin menu, once for both front ends.
//
// The React shell (src/web-client/src/components/Shell.tsx) and the server-
// rendered chrome of the report pages (src/web/adminChrome.js) used to keep a
// copy of the list each, and the SSR copy had quietly lost "Roster" and
// "Loot-Council". The entries live in menu.json so the client can import them
// as plain data (Vite does not load CommonJS from outside node_modules); this
// module is the CommonJS face of the same file.
//
//   id       — the nav item's class suffix (`area-<id>`, see the --area-* tokens)
//   label    — what the menu says
//   href     — the route at the site root
//   group    — the heading the entry sits under
//   areas    — permission areas (config/permissions.js); one of them opens it
//   wowIcon  — the zamimg icon name drawn in front of the label
const MENU = require("./menu.json");

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons";

/** The icon every missing or unknown name falls back to. */
const FALLBACK_ICON = "inv_misc_questionmark";

/**
 * zamimg url for a WoW icon name. The name is lowercased and url-encoded —
 * including the apostrophe, which encodeURIComponent leaves alone but which a
 * few icon names carry ("kael'thas"). Some names only exist with a trailing
 * suffix ("achievement_boss_archimonde-"), so nothing is trimmed off the end.
 * Up to 18 px the medium (36 px) image is plenty, above it the large one.
 *
 * src/web-client/src/lib/wowIcon.ts is the client's twin of this function;
 * test/web-client/uiFoundation.test.js keeps the two in step.
 */
function wowIconUrl(name, size = 56) {
    const clean = String(name || "").trim().toLowerCase().replace(/\.jpg$/, "") || FALLBACK_ICON;
    const variant = size <= 18 ? "medium" : "large";
    return `${ICON_BASE}/${variant}/${encodeURIComponent(clean).replace(/'/g, "%27")}.jpg`;
}

module.exports = { MENU, wowIconUrl, FALLBACK_ICON };
