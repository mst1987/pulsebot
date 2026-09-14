// Pieces the Raid-Detail page's tabs and dialogs share: the page context, the
// spec tile, and the role/status vocabularies with their WoW icons and tones.
import type {
    AttendancePerson, LogSection, RaidDetailData, RaidDetailModal, SetupPlayer, SetupRole, SignupStatus,
} from "../../api";
import type { Tone } from "../../components/ui/Badge";

/** Everything a tab or dialog of the page needs from the page itself. */
export type RaidCtx = {
    data: RaidDetailData;
    eventId: string;
    csrfToken: string | null;
    /** Toast the message (if any) and reload the page's data. */
    onChanged: (msg: string) => void;
    openModal: (modal: RaidDetailModal) => void;
    openPlayer: (player: PlayerRef) => void;
};

/** A person the player dialog can show — a raidplan slot, a reaction, or both. */
export type PlayerRef = {
    name: string;
    discordName?: string;
    classColor?: string;
    className?: string;
    specName?: string;
    iconUrl?: string;
    role?: SetupRole;
    group?: string;
    status?: SignupStatus | "missing";
};

/** Roles in the order a raid lead reads a comp. */
export const ROLE_ORDER: SetupRole[] = ["tank", "healer", "melee", "ranged", "dps"];
export const ROLE_META: Record<SetupRole, { label: string; icon: string }> = {
    tank: { label: "Tanks", icon: "ability_warrior_defensivestance" },
    healer: { label: "Heiler", icon: "spell_holy_flashheal" },
    melee: { label: "Nahkampf", icon: "ability_dualwield" },
    ranged: { label: "Fernkampf", icon: "inv_weapon_bow_07" },
    dps: { label: "DPS", icon: "inv_misc_questionmark" },
};

// The reactions, from coming to out. `signed` is the fallback for a signup whose
// status the backend could not resolve, so an unknown Raid-Helper wording lands
// in "Angemeldet" and never disappears.
export const SIGNUP_ORDER: SignupStatus[] = ["signed", "tentative", "late", "bench", "absence"];
export const SIGNUP_META: Record<SignupStatus, { label: string; tone?: Tone }> = {
    signed: { label: "Angemeldet", tone: "ok" },
    tentative: { label: "Unsicher", tone: "mid" },
    late: { label: "Kommt später", tone: "mid" },
    bench: { label: "Bank" },
    absence: { label: "Abgemeldet", tone: "bad" },
};

/** Rough runtimes for the job toasts' progress bar — same numbers as ClaPage. */
export const EVAL_SECONDS: Record<LogSection, number> = { cla: 25, rpb: 55 };

/** The two analyses a log can be run through; both write into the same report page. */
export const LOG_ANALYSES: { key: LogSection; label: string; tip: string }[] = [
    { key: "cla", label: "CLA", tip: "Gear, Verzauberungen, Sockel, Consumables, Drums, Potions und Shadow-Resi. Dauer etwa 25 Sekunden." },
    { key: "rpb", label: "RPB", tip: "Vermeidbarer Schaden, Tode, Aktivität, Cooldowns, Interrupts und Log-Prüfung. Dauer etwa eine Minute." },
];

/** WoW icons for the softres.it instance codes (config/softresInstances.js). */
export const INSTANCE_ICONS: Record<string, string> = {
    kara: "achievement_boss_princemalchezaar_02",
    gruul: "achievement_boss_gruulthedragonkiller",
    magtheridon: "achievement_boss_magtheridon",
    za: "inv_misc_rune_01",
    ssc: "achievement_boss_ladyvashj",
    tempestkeep: "achievement_boss_kael'thassunstrider_01",
    blacktemple: "achievement_boss_illidan",
    hyjal: "inv_misc_head_dragon_01",
    sunwellplateau: "inv_weapon_shortblade_71",
    doomlordkazzak: "warlock_summon_doomguard",
    doomwalker: "spell_shadow_summonfelguard",
};

export const LOOT_TOOL_LABELS: Record<string, string> = { gargul: "Gargul", rclc: "RCLootcouncil", manual: "Manuell" };

/** A raid lead thinks in character names; the Discord name is only the fallback. */
export function personLabel(p: AttendancePerson): string {
    return p.character || p.displayName || p.id;
}

/** Alphabetical by the name actually shown, so a list reads like a roster. */
export function byLabel(a: AttendancePerson, b: AttendancePerson): number {
    return personLabel(a).localeCompare(personLabel(b), "de");
}

/** The player-dialog reference for a raidplan slot. */
export function slotRef(p: SetupPlayer, group: string, status?: SignupStatus | "missing"): PlayerRef {
    return {
        name: p.name, classColor: p.classColor, className: p.className, specName: p.specName,
        iconUrl: p.iconUrl, role: p.role, group, status,
    };
}

/** The player-dialog reference for a reaction (or a missing raider). */
export function personRef(p: AttendancePerson, status?: SignupStatus | "missing"): PlayerRef {
    const prof = p.profile;
    return {
        name: personLabel(p), discordName: p.character ? (p.displayName || p.id) : undefined,
        classColor: prof?.classColor, className: prof?.className, specName: prof?.specName, iconUrl: prof?.iconUrl,
        status: status ?? p.status,
    };
}
