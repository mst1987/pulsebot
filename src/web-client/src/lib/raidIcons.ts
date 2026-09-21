// The boss icon each TBC raid is shown with — the achievement of its final boss,
// the one thing every raider recognises at a glance. Keyed by the content ids of
// src/config/tbcContent.js, which the server hands out per event
// (src/web/raidListing.js). Names checked against the zamimg CDN: Archimonde's
// only exists with the trailing "-", Kael'thas' with the apostrophe (WowIcon
// encodes it).
import { t } from "../i18n";

export const RAID_ICON_FALLBACK = "inv_misc_note_02";

export const RAID_CONTENTS: Record<string, { icon: string; label: string; short: string }> = {
    kara: { icon: "achievement_boss_princemalchezaar_02", get label() { return t("wow.instance.kara"); }, short: "Kara" },
    gruul: { icon: "achievement_boss_gruulthedragonkiller", get label() { return t("wow.instance.gruul"); }, short: "Gruul" },
    mag: { icon: "achievement_boss_magtheridon", get label() { return t("wow.instance.mag"); }, short: "Magtheridon" },
    ssc: { icon: "achievement_boss_ladyvashj", get label() { return t("wow.instance.ssc"); }, short: "SSC" },
    tk: { icon: "achievement_boss_kael'thassunstrider_01", get label() { return t("wow.instance.tk"); }, short: "TK" },
    za: { icon: "achievement_boss_zuljin", get label() { return t("wow.instance.za"); }, short: "ZA" },
    hyjal: { icon: "achievement_boss_archimonde-", get label() { return t("wow.instance.hyjal"); }, short: "Hyjal" },
    bt: { icon: "achievement_boss_illidan", get label() { return t("wow.instance.bt"); }, short: "BT" },
    swp: { icon: "achievement_boss_kiljaedan", get label() { return t("wow.instance.swp"); }, short: "SWP" },
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
