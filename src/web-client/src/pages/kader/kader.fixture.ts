// A small Kaderplaner view model for the tests: three classes, one Kader with
// a player in every state — the signed-in admin ("u1") leads it — three
// questions (weekdays, voice, a free text), one 20er variant, and a second
// Kader with questions to copy from.
import type { KaderCharacter, KaderData, KaderEntry, KaderPlayer, KaderQuestion, KaderSlot, KaderView } from "../../api";

export const U = {
    tank: "111111111111111111", heal: "222222222222222222", sham: "333333333333333333", mage: "444444444444444444",
    hand: "555555555555555555", done: "666666666666666666", tent: "777777777777777777", guest: "888888888888888888", lead2: "999999999999999999",
};
export const ME = "u1";
export const NOW = "2026-09-30T18:00:00.000Z";

function char(over: Partial<KaderCharacter>): KaderCharacter {
    return {
        id: "c", name: "Name Nachname", nameStyle: "forever", className: "Warrior", specs: [], canTank: false, canHeal: false,
        origin: "profile", differs: [], mainSpec: null, role: null, gear: "none", ...over,
    };
}

export function player(over: Partial<KaderPlayer> & { userId: string }): KaderPlayer {
    return {
        displayName: over.userId, avatarUrl: null, onServer: true, roleIds: [], hasProfile: true, manual: false, hasOverride: false,
        characters: [], activeCharacterId: null, differs: [], profile: null, prefill: null, availability: [], attendance: null, attendanceMain: null, ...over,
    };
}

export function entry(over: Partial<KaderEntry> = {}): KaderEntry {
    return {
        name: "", state: "pool", since: NOW, by: ME, addedAt: "2026-09-28T18:00:00.000Z", addedBy: ME,
        history: [{ at: "2026-09-28T18:00:00.000Z", by: ME, type: "added", to: "pool" }],
        wishes: [],
        interview: { lead: "", answers: {}, note: "", startedAt: "", updatedAt: "", updatedBy: "", completedAt: "", completedBy: "" },
        votes: {}, comments: [], decision: null, ...over,
    };
}

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const QUESTIONS: KaderQuestion[] = [
    { id: "q1", text: "Mögliche Raidtage", type: "multi", options: DAYS.map((label, i) => ({ id: `d${i + 1}`, label })), required: true },
    { id: "q2", text: "Im Voice-Chat aktiv?", type: "single", options: [{ id: "o1", label: "Immer" }, { id: "o2", label: "Meistens" }, { id: "o3", label: "Selten" }], required: false },
    { id: "q3", text: "Anmerkung", type: "text", options: [], required: false },
];

const groups = (): KaderSlot[][] => Array.from({ length: 4 }, () => [null, null, null, null, null]);

export function kader(over: Partial<KaderData> = {}): KaderData {
    const setupGroups = groups();
    setupGroups[0][0] = { userId: U.tank, spec: "Warrior-Protection" };
    return {
        id: "k1", name: "Forever-Kader", leads: [ME], createdAt: "2026-09-20T18:00:00.000Z", createdBy: ME,
        questions: QUESTIONS,
        players: {
            [U.hand]: entry({ name: "Neuling" }),
            [U.mage]: entry({
                state: "selected", wishes: [{ className: "Mage", spec: "Mage-Frost" }],
                interview: { lead: ME, answers: { q2: "o1" }, note: "Will Frost spielen", startedAt: "2026-10-01T18:00:00.000Z", updatedAt: "2026-10-01T18:05:00.000Z", updatedBy: ME, completedAt: "", completedBy: "" },
            }),
            [U.done]: entry({
                state: "selected", name: "Brakk", wishes: [{ className: "Warrior", spec: "Warrior-Fury" }, { className: "Warrior", spec: "Warrior-Protection" }],
                interview: { lead: ME, answers: { q1: ["d3", "d4"], q2: "o2" }, note: "", startedAt: "2026-10-01T18:00:00.000Z", updatedAt: "2026-10-02T18:00:00.000Z", updatedBy: ME, completedAt: "2026-10-02T18:00:00.000Z", completedBy: ME },
            }),
            [U.heal]: entry({
                state: "provisional", wishes: [{ className: "Shaman", spec: "Shaman-Restoration" }, { className: "Shaman", spec: "Shaman-Enhancement" }],
                votes: { [ME]: "yes" }, comments: [{ id: "c1", by: ME, at: "2026-10-03T18:00:00.000Z", text: "Zuverlässig." }],
            }),
            [U.tank]: entry({ state: "roster", wishes: [{ className: "Warrior", spec: "Warrior-Protection" }], decision: { className: "Warrior", spec: "Warrior-Protection" } }),
            [U.sham]: entry({ state: "bench", wishes: [{ className: "Shaman", spec: "Shaman-Enhancement" }], decision: { className: "Shaman", spec: "Shaman-Enhancement" } }),
            [U.tent]: entry({ state: "tentative", name: "Kael", wishes: [{ className: "Mage", spec: "Mage-Fire" }] }),
        },
        setups: [{ id: "v1", name: "Variante A", size: 20, groups: setupGroups }],
        ...over,
    };
}

export function kaderView(over: Partial<KaderView> = {}): KaderView {
    const players: KaderPlayer[] = [
        player({
            userId: U.tank, displayName: "Aldric", roleIds: ["r1"],
            characters: [char({ id: "t", name: "Aldric Sturmwind", className: "Warrior", mainSpec: "Warrior-Protection", role: "tank", gear: "ready", specs: [{ spec: "Warrior-Protection", main: true, gear: "ready" }] })],
            activeCharacterId: "t",
            prefill: { name: "Aldric Sturmwind", className: "Warrior", spec: "Warrior-Protection", source: "profile", versionId: "" },
            attendance: { attended: 9, counted: 10, pct: 90, nights: [] },
        }),
        player({
            userId: U.heal, displayName: "Mira", roleIds: ["r1"],
            prefill: { name: "Mira Sonnlicht", className: "Shaman", spec: "Shaman-Restoration", source: "logs", versionId: "" },
        }),
        player({ userId: U.sham, displayName: "Tomas", prefill: { name: "Tomas Erdherz", className: "Shaman", spec: "Shaman-Enhancement", source: "profile", versionId: "" } }),
        player({
            userId: U.mage, displayName: "Liss", roleIds: ["r2"],
            prefill: { name: "Liss Funkenhand", className: "Mage", spec: "Mage-Frost", source: "profile", versionId: "" },
            attendanceMain: { attended: 4, counted: 5, pct: 80, nights: [] },
        }),
        player({ userId: U.hand, displayName: "Neuling", hasProfile: false, manual: true }),
        player({ userId: U.done, displayName: U.done, prefill: { name: "Brakk Eisenfaust", className: "Warrior", spec: "Warrior-Fury", source: "profile", versionId: "" } }),
        player({ userId: U.tent, displayName: "Kael", prefill: null }),
    ];
    return {
        versionId: "forever",
        mainVersion: { id: "tbc", label: "TBC" },
        guildId: "g1",
        roles: ["tank", "healer", "melee", "ranged"],
        classes: [
            { key: "Warrior", name: "Krieger", nameEn: "Warrior", color: "#C79C6E", icon: "", canTank: true, canHeal: false, specs: [
                { key: "Warrior-Protection", name: "Schutz", nameEn: "Protection", role: "tank", canTank: true, canHeal: false, icon: "" },
                { key: "Warrior-Fury", name: "Furor", nameEn: "Fury", role: "melee", canTank: false, canHeal: false, icon: "" },
            ] },
            { key: "Shaman", name: "Schamane", nameEn: "Shaman", color: "#0070DE", icon: "", canTank: false, canHeal: true, specs: [
                { key: "Shaman-Enhancement", name: "Verstärkung", nameEn: "Enhancement", role: "melee", canTank: false, canHeal: false, icon: "" },
                { key: "Shaman-Restoration", name: "Wiederherstellung", nameEn: "Restoration", role: "healer", canTank: false, canHeal: true, icon: "" },
            ] },
            { key: "Mage", name: "Magier", nameEn: "Mage", color: "#69CCF0", icon: "", canTank: false, canHeal: false, specs: [
                { key: "Mage-Frost", name: "Frost", nameEn: "Frost", role: "ranged", canTank: false, canHeal: false, icon: "" },
                { key: "Mage-Fire", name: "Feuer", nameEn: "Fire", role: "ranged", canTank: false, canHeal: false, icon: "" },
            ] },
        ],
        buffs: {
            raid: [],
            party: [{ key: "windfury", label: "Totem des Windzorns", icon: "", providers: ["Shaman-Enhancement", "Shaman-Restoration"], beneficiaries: ["Warrior-Protection", "Warrior-Fury", "Shaman-Enhancement"], important: true }],
        },
        players,
        members: [
            { userId: U.tank, displayName: "Aldric", roleIds: ["r1"], prefill: players[0].prefill },
            { userId: U.guest, displayName: "Gast", roleIds: ["r1"], prefill: { name: "Gast Gastlich", className: "Mage", spec: "Mage-Frost", source: "profile", versionId: "" } },
            { userId: U.lead2, displayName: "Ohne", roleIds: ["r2"], prefill: null },
        ],
        discordRoles: [{ id: "r1", name: "Raider", color: "#3498db", count: 3 }, { id: "r2", name: "Trial", color: "", count: 2 }],
        names: { [ME]: "Admin", [U.lead2]: "Ohne", [U.done]: "Brakk" },
        kaders: [
            { id: "k1", name: "Forever-Kader", leads: [ME], createdAt: "", createdBy: ME, counts: { pool: 1, selected: 2, provisional: 1, roster: 1, bench: 1, tentative: 1 }, questions: 3 },
            { id: "k2", name: "Zweiter Kader", leads: [], createdAt: "", createdBy: "", counts: { pool: 0, selected: 0, provisional: 0, roster: 0, bench: 0, tentative: 0 }, questions: 2 },
        ],
        kader: kader(),
        warnings: [],
        ...over,
    };
}
