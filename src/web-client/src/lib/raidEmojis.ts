// Emojis that suit a raid, for the picker's first row ("Passt zu Zul'Aman").
// Suggestions only — the orga picks, nothing is set on its own. Keyed by the
// instance id of src/config/gameVersions; a Forever instance without its own
// row borrows the one of its namesake ("forever-hyjal" → "hyjal"). Every emoji
// here is Emoji 12.1 or older (lib/emoji.ts MAX_EMOJI_VERSION), so the menu can
// draw it on Windows 10 too.

export const RAID_EMOJIS: Record<string, string[]> = {
    // TBC
    kara: ["👻", "♟️", "🍷", "🐺", "🎭"],
    gruul: ["👹", "⛰️", "💪"],
    mag: ["😈", "⛓️", "🔥"],
    ssc: ["🐍", "🌊", "🐙", "🐟"],
    tk: ["🔥", "🦅", "☄️", "🌌"],
    za: ["🐻", "🦅", "🐆", "🐉", "🌴", "🗿"],
    hyjal: ["🌳", "🌲", "💀", "⚔️"],
    bt: ["😈", "👁️", "🗡️", "🦇"],
    swp: ["☀️", "🌞", "👿", "🐉"],
    // Classic
    ony: ["🐉", "🔥", "🥚"],
    mc: ["🌋", "🔥", "💎"],
    bwl: ["🐉", "🖤", "🦇"],
    zg: ["🐍", "🐯", "🦇", "🌴", "🗿"],
    aq20: ["🦂", "🐞", "🏜️"],
    aq40: ["👁️", "🐛", "🦂", "🏜️"],
    naxx: ["💀", "☠️", "❄️", "🕷️"],
    // WoW Forever
    "forever-barrow": ["⚰️", "💀", "🕯️"],
};

/** The instance ids a raid tag or channel name names: "ssc-tk" → ["ssc", "tk"], "mi-16-09-za" → ["za"]. */
export function instanceIdsOfTag(tag: string): string[] {
    return String(tag || "").toLowerCase().split(/[^a-z0-9]+/).filter((id) => !!RAID_EMOJIS[id]);
}

/** The suggested emojis for the chosen raids, without repeats, at most `max`. */
export function raidEmojiSuggestions(instanceIds: string[], max = 10): string[] {
    const out: string[] = [];
    for (const id of instanceIds || []) {
        const list = RAID_EMOJIS[id] || RAID_EMOJIS[id.replace(/^forever-/, "")] || [];
        for (const e of list) if (!out.includes(e)) out.push(e);
    }
    return out.slice(0, max);
}
