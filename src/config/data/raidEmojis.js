// Emojis that suit a raid: the suggestions of the channel icon pickers ("Passt zu
// Zul'Aman"). Suggestions only — the orga picks, nothing is set on its own.
//
// Backend twin of src/web-client/src/lib/raids/raidEmojis.ts (RAID_EMOJIS,
// raidEmojiSuggestions); test/config/data/raidEmojis.test.js keeps both lists identical.
// Keyed by the instance id of src/config/gameVersions; every emoji is Emoji 12.1
// or older, so every system the orga uses can draw it.

const RAID_EMOJIS = {
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
    "forever-hyjal": ["🌳", "🌲", "💀", "⚔️"],
    "forever-ony": ["🐉", "🔥", "🥚"],
};

/** The suggested emojis for the chosen raids, without repeats, at most `max`. */
function raidEmojiSuggestions(instanceIds, max = 10) {
    const out = [];
    for (const id of instanceIds || []) {
        for (const e of RAID_EMOJIS[id] || []) if (!out.includes(e)) out.push(e);
    }
    return out.slice(0, max);
}

module.exports = { RAID_EMOJIS, raidEmojiSuggestions };
