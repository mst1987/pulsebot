// Small, readable fixtures for the "Anmeldungen" tests (#256/#293/#306/#320):
// SignupsPage, SignupDialog and the bulk dialog. Two characters — the main a
// priest (Shadow without gear, Holy ready), the alt a warrior who may off-tank.
import type {
    OwnSignup, OwnSignupRow, RaidHelperSignupRow, SignupClass, SignupCounts, SignupProfile, SignupsData,
} from "../api";

export const PROFILE: SignupProfile = {
    canOfftank: false,
    canHeal: false,
    characters: [
        {
            key: "zibbo", name: "Zibbo", className: "Priest", main: true, canOfftank: false, canHeal: false,
            specs: [
                { key: "Priest-Shadow", label: "Shadow", icon: "spell_shadow_shadowwordpain", role: "ranged", gear: "none" },
                { key: "Priest-Holy", label: "Holy", icon: "spell_holy_guardianspirit", role: "healer", gear: "ready" },
            ],
        },
        {
            key: "zibbowar", name: "Zibbowar", className: "Warrior", main: false, canOfftank: true, canHeal: false,
            specs: [
                { key: "Warrior-Protection", label: "Protection", icon: "ability_warrior_defensivestance", role: "tank", gear: "ready" },
                { key: "Warrior-Fury", label: "Fury", icon: "ability_warrior_innerrage", role: "melee", gear: "usable" },
            ],
        },
    ],
};

export const CLASSES: SignupClass[] = [
    { id: "Priest", label: "Priester", color: "#ffffff", icon: "classicon_priest" },
    { id: "Warrior", label: "Krieger", color: "#c79c6e", icon: "classicon_warrior" },
];

export function counts(over: Partial<SignupCounts> = {}): SignupCounts {
    return {
        tank: { n: 1, target: 2 }, healer: { n: 1, target: 3 }, dps: { n: 1, target: 5 },
        attending: 3, tentative: 0, bench: 0, absence: 0, size: 10, ...over,
    };
}

/** Seconds, like the API sends them. */
export const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function ownRow(over: Partial<OwnSignupRow> = {}): OwnSignupRow {
    return {
        id: "eh-kara", source: "eventhelper", title: "Kara Freitag", startTime: at("2026-09-18T17:45:00Z"),
        categoryId: "c1", categoryName: "T4", contentIds: ["kara"], contentSources: [], instanceIcon: "achievement_raid_karazhan",
        size: 10, attending: 3, discordUrl: "https://discord.com/channels/1/2/3", versionId: "tbc",
        deadline: at("2026-09-18T15:00:00Z"), deadlinePassed: false, started: false,
        allowedStatuses: ["signed", "tentative", "late", "bench", "absence"],
        counts: counts(), wishes: true, wishPartners: [], mine: null, ...over,
    };
}

export function raidHelperRow(over: Partial<RaidHelperSignupRow> = {}): RaidHelperSignupRow {
    return {
        id: "rh-1", source: "raidhelper", title: "Gruul Samstag", startTime: at("2026-09-19T18:00:00Z"),
        categoryId: "c1", categoryName: "T4", contentIds: ["gruul"], contentSources: [], instanceIcon: "",
        size: 25, attending: 12, discordUrl: "https://discord.com/channels/1/9/9", mine: null, ...over,
    };
}

export function signup(over: Partial<OwnSignup> = {}): OwnSignup {
    const first = { character: "Zibbo", className: "Priest", classColor: "#ffffff", spec: "Priest-Holy", specLabel: "Holy", specIcon: "", role: "healer" as const };
    return {
        characters: [{ ...first, status: "signed" }], status: "signed", ...first, canAlso: [], comment: "", ...over,
    };
}

export function signupsData(over: Partial<SignupsData> = {}): SignupsData {
    return { events: [ownRow()], profile: PROFILE, classes: CLASSES, error: null, ...over };
}
