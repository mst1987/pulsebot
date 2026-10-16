// Pure helpers of the page "Addons" (#818): where a zip goes for the game
// version shown, and the release notes as plain text.

/** The game client folder of each version, under the WoW install folder. */
const CLIENT_FOLDER: Record<string, string> = {
    forever: "_classic_beta_",
    tbc: "_anniversary_",
    classic: "_classic_era_",
};

/** `<WoW>\_classic_beta_\Interface\AddOns\` for a version (WoW Forever's folder when unknown). */
export function addonFolder(versionId: string): string {
    const folder = CLIENT_FOLDER[versionId] || CLIENT_FOLDER.forever;
    return `<WoW>\\${folder}\\Interface\\AddOns\\`;
}

/**
 * GitHub's Markdown release notes as plain lines: heading marks, bold/italic
 * marks, inline code ticks and link targets go, list bullets become "•". The
 * page shows them as text (never as HTML), so nothing in a release can inject
 * markup.
 */
export function plainNotes(markdown: string): string {
    return String(markdown || "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line
            .replace(/^\s{0,3}#{1,6}\s+/, "")
            .replace(/^(\s*)[-*+]\s+/, "$1• ")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/(\*\*|__)(.+?)\1/g, "$2")
            .replace(/`([^`]+)`/g, "$1")
            .trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
