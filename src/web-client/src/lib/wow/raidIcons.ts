// The boss icon each raid is shown with — the achievement of its final boss,
// the one thing every raider recognises at a glance. Keyed by the instance ids of
// the rule sets (src/config/gameVersions), which the server hands out per event
// (src/services/events/raidListing.js). Names checked against the zamimg CDN: Archimonde's
// only exists with the trailing "-", Kael'thas' with the apostrophe (WowIcon
// encodes it).
import { t } from "../../i18n";

export const RAID_ICON_FALLBACK = "inv_misc_note_02";

type RaidContent = { icon: string; label: string; short: string };

function content(id: string, icon: string, short: string): RaidContent {
    return { icon, get label() { return t(`wow.instance.${id}`); }, short };
}

// One entry per instance of every game version, keyed by the instance id of the
// rule set (src/config/gameVersions, ids are unique across versions) and
// equal to its `icon` — raidIcons.test.ts holds the two together. There is no
// fallback from a Forever id to its TBC namesake: "forever-hyjal" is not "hyjal".
export const RAID_CONTENTS: Record<string, RaidContent> = {
    // TBC
    kara: content("kara", "achievement_boss_princemalchezaar_02", "Kara"),
    gruul: content("gruul", "achievement_boss_gruulthedragonkiller", "Gruul"),
    mag: content("mag", "achievement_boss_magtheridon", "Magtheridon"),
    ssc: content("ssc", "achievement_boss_ladyvashj", "SSC"),
    tk: content("tk", "achievement_boss_kael'thassunstrider_01", "TK"),
    za: content("za", "achievement_boss_zuljin", "ZA"),
    hyjal: content("hyjal", "achievement_boss_archimonde-", "Hyjal"),
    bt: content("bt", "achievement_boss_illidan", "BT"),
    swp: content("swp", "achievement_boss_kiljaedan", "SWP"),
    // Classic
    ony: content("ony", "achievement_boss_onyxia", "Ony"),
    mc: content("mc", "achievement_boss_ragnaros", "MC"),
    bwl: content("bwl", "achievement_boss_nefarion", "BWL"),
    zg: content("zg", "achievement_boss_hakkar", "ZG"),
    aq20: content("aq20", "achievement_boss_ossiriantheunscarred", "AQ20"),
    aq40: content("aq40", "achievement_boss_cthun", "AQ40"),
    naxx: content("naxx", "achievement_boss_kelthuzad_01", "Naxx"),
    // WoW Forever
    "forever-barrow": content("forever-barrow", "spell_shadow_raisedead", "Barrow"),
    "forever-hyjal": content("forever-hyjal", "achievement_boss_archimonde-", "Hyjal F"),
    "forever-ony": content("forever-ony", "achievement_boss_onyxia", "Ony F"),
};

/** Only the ids this table knows, in the order given. */
export function knownContents(ids: string[] | undefined): string[] {
    return (ids || []).filter((id) => RAID_CONTENTS[id]);
}

/** The icon of a content id, the note for anything unknown. */
export function raidIconName(id: string | undefined): string {
    return (id && RAID_CONTENTS[id]?.icon) || RAID_ICON_FALLBACK;
}

/** "Hyjalgipfel + Schwarzer Tempel", "" when nothing was recognised. */
export function raidLabel(ids: string[] | undefined): string {
    return knownContents(ids).map((id) => RAID_CONTENTS[id].label).join(" + ");
}

const SOURCES = ["event", "title", "category", "channel", "logs", "loot"];

/** "erkannt aus Titel und Loot" — where the server found the content. */
export function raidSourceText(sources: string[] | undefined): string {
    const names = (sources || []).filter((s) => SOURCES.includes(s)).map((s) => t(`raids.source.${s}`));
    if (!names.length) return "";
    const list = names.length > 1 ? t("raids.source.and", { list: names.slice(0, -1).join(", "), last: names[names.length - 1] }) : names[0];
    return t("raids.source.detected", { list });
}
