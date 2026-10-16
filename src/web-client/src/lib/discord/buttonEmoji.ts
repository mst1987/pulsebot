// The emoji of a Discord link button (Raid-Zentrale / Orga-Zentrale links).
// Same two forms as the server's utils/discord/buttonEmoji.js: one unicode
// emoji, or a custom Discord emoji "<:name:id>" / "<a:name:id>". The server
// does the real check; here only what the preview needs.

const CUSTOM = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>$/;

/** A handful of everyday emojis for the quick pick (the field takes any other). */
export const EMOJI_CHOICES = [
    "📊", "📋", "📝", "📎", "📌", "📅", "🔗", "🌐",
    "🧙", "⚔️", "🛡️", "💚", "🎯", "🏆", "💎", "🪙",
    "📢", "❓", "ℹ️", "✅", "⭐", "🔥", "🎲", "🗺️",
];

export type ParsedEmoji = { kind: "unicode"; text: string } | { kind: "custom"; id: string; name: string; animated: boolean; url: string };

/** Read the field's text for the preview; null when it is empty. Anything else counts as unicode text. */
export function previewEmoji(text: string): ParsedEmoji | null {
    const s = text.trim();
    if (!s) return null;
    const m = CUSTOM.exec(s);
    if (m) {
        const animated = m[1] === "a";
        return { kind: "custom", id: m[3], name: m[2], animated, url: `https://cdn.discordapp.com/emojis/${m[3]}.${animated ? "gif" : "png"}?size=32` };
    }
    return { kind: "unicode", text: s };
}

export type LinkValue = { label: string; url: string; emoji?: string };

/** Keep inputs from being sent with stray blanks and drop rows nobody filled in; no emoji key without an emoji. */
export function cleanLinks<T extends LinkValue>(rows: T[]): LinkValue[] {
    return rows
        .map((r) => ({ label: r.label.trim(), url: r.url.trim(), emoji: (r.emoji || "").trim() }))
        .filter((r) => r.label || r.url)
        .map((r) => (r.emoji ? r : { label: r.label, url: r.url }));
}