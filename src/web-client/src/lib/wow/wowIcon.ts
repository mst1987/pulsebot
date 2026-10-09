// Client twin of wowIconUrl() in src/config/menu.js — same rules, kept in step by
// src/web-client/src/components/ui/uiFoundation.test.ts (the client is TypeScript and the tests
// run plain Node, so the function cannot simply be shared).

const ICON_BASE = "https://wow.zamimg.com/images/wow/icons";

/** The icon every missing or unknown name falls back to. */
export const FALLBACK_ICON = "inv_misc_questionmark";

/**
 * zamimg url for a WoW icon name: lowercased, url-encoded including the
 * apostrophe ("kael'thas" → "kael%27thas"), trailing suffixes such as the "-" of
 * "achievement_boss_archimonde-" left intact. Medium image up to 18 px, large above.
 */
export function wowIconUrl(name: string | null | undefined, size = 56): string {
    const clean = String(name || "").trim().toLowerCase().replace(/\.jpg$/, "") || FALLBACK_ICON;
    const variant = size <= 18 ? "medium" : "large";
    return `${ICON_BASE}/${variant}/${encodeURIComponent(clean).replace(/'/g, "%27")}.jpg`;
}
