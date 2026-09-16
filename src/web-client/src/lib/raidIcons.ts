// The boss icon each TBC raid is shown with — the achievement of its final boss,
// the one thing every raider recognises at a glance. Keyed by the content ids of
// src/config/tbcContent.js, which the server hands out per event
// (src/web/raidListing.js). Names checked against the zamimg CDN: Archimonde's
// only exists with the trailing "-", Kael'thas' with the apostrophe (WowIcon
// encodes it).

export const RAID_ICON_FALLBACK = "inv_misc_note_02";

export const RAID_CONTENTS: Record<string, { icon: string; label: string; short: string }> = {
    kara: { icon: "achievement_boss_princemalchezaar_02", label: "Karazhan", short: "Kara" },
    gruul: { icon: "achievement_boss_gruulthedragonkiller", label: "Gruuls Unterschlupf", short: "Gruul" },
    mag: { icon: "achievement_boss_magtheridon", label: "Magtheridons Kammer", short: "Magtheridon" },
    ssc: { icon: "achievement_boss_ladyvashj", label: "Höhle des Schlangenschreins", short: "SSC" },
    tk: { icon: "achievement_boss_kael'thassunstrider_01", label: "Festung der Stürme", short: "TK" },
    za: { icon: "achievement_boss_zuljin", label: "Zul'Aman", short: "ZA" },
    hyjal: { icon: "achievement_boss_archimonde-", label: "Hyjalgipfel", short: "Hyjal" },
    bt: { icon: "achievement_boss_illidan", label: "Schwarzer Tempel", short: "BT" },
    swp: { icon: "achievement_boss_kiljaedan", label: "Sonnenbrunnenplateau", short: "SWP" },
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

const SOURCE_LABELS: Record<string, string> = {
    event: "Event",
    title: "Titel",
    category: "Kategorie",
    channel: "Kanalname",
    logs: "Log-Zone",
    loot: "Loot",
};

/** "erkannt aus Titel und Loot" — where the server found the content. */
export function raidSourceText(sources: string[] | undefined): string {
    const names = (sources || []).map((s) => SOURCE_LABELS[s]).filter(Boolean);
    if (!names.length) return "";
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}` : names[0];
    return `erkannt aus ${list}`;
}
