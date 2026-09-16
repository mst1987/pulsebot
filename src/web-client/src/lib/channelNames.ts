// Discord's naming rules while typing a channel name (issue #259) — the client
// twin of normalizeChannelName() in src/utils/channelNames.js. The regex and the
// limit are held identical by test/utils/channelNames.test.js; the schema itself
// is rendered on the server (the quick-create and rename previews ask for it),
// and so is a name derived from the previous event channel (#285).

export const CHANNEL_NAME_MAX = 100;
/** Only ASCII punctuation (but "-" and "_") and control characters go — emojis and symbols like "・" stay, as in Discord. */
export const NAME_STRIP_RE = /[!-,./:-@[-^`{-~\p{Cc}]+/gu;

/** Lower case, "-" for whitespace, no ASCII punctuation; `final: false` keeps a trailing dash while typing. */
export function normalizeChannelName(value: string, { final = true }: { final?: boolean } = {}): string {
    let name = String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(NAME_STRIP_RE, "")
        .replace(/-{2,}/g, "-")
        .replace(/^-+/, "");
    if (final) name = name.replace(/-+$/, "");
    return name.slice(0, CHANNEL_NAME_MAX);
}

/** Voice and stage channels keep case and spaces; text-like ones follow Discord's rules. */
export function normalizeForType(value: string, type: number, final = true): string {
    if ([0, 5, 15].includes(type)) return normalizeChannelName(value, { final });
    const kept = String(value || "").replace(/\s+/g, " ");
    return (final ? kept.trim() : kept.replace(/^\s+/, "")).slice(0, CHANNEL_NAME_MAX);
}
