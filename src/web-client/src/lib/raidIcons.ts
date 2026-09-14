// The icon a raid is recognised by in the Log-Auswertung: its final boss (Tempest
// Keep, whose Kael'thas icon is unreadable at 14 px, by the burnout that ends it).
// Keys are the content ids of src/config/tbcContent.js. Names checked against
// zamimg — Archimonde's only exists with the trailing "-".

import type { ClaRaid } from "../api";

export const RAID_ICONS: Record<string, string> = {
    kara: "achievement_boss_princemalchezaar_02",
    gruul: "achievement_boss_gruul",
    mag: "achievement_boss_magtheridon",
    ssc: "achievement_boss_ladyvashj",
    tk: "spell_fire_burnout",
    za: "achievement_boss_zuljin",
    hyjal: "achievement_boss_archimonde-",
    bt: "achievement_boss_illidan",
    swp: "achievement_boss_kiljaedan",
};

/** The page's own icon, for a log whose raid is not known (yet). */
export const LOG_FALLBACK_ICON = "inv_misc_pocketwatch_01";

export function raidIcon(contentId: string | undefined): string {
    return RAID_ICONS[String(contentId || "")] || LOG_FALLBACK_ICON;
}

/** "Hyjal 3/5", or just "Hyjal" when the raid's encounter count is unknown. */
export function raidCount(r: ClaRaid): string {
    return r.total ? `${r.label} ${r.killed}/${r.total}` : r.label;
}

/** Head and explanation of a raid badge's tooltip. */
export function raidTip(r: ClaRaid): { head: string; sub: string } {
    if (r.finalKilled) {
        return {
            head: `${r.label} abgeschlossen`,
            sub: r.total ? `${r.killed} von ${r.total} Bossen im Log, der Endboss liegt.` : "Der Endboss liegt im Log.",
        };
    }
    const standing = r.missing.length ? r.missing.join(", ") : r.finalBoss;
    return {
        head: "Raid nicht abgeschlossen",
        sub: `${r.total ? `Im Log liegen ${r.killed} von ${r.total} ${r.label}-Bossen` : `${r.label} ist nicht beendet`}, ${standing} ${r.missing.length > 1 ? "stehen" : "steht"} noch. „Auswerten“ fragt vorher nach – ein abgebrochener Raid lässt sich trotzdem auswerten.`,
    };
}
