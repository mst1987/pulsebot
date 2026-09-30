// A small Kaderplaner view model for the tests: three classes, a Hyjal roster
// with a tank and a healer, a benched shaman, a free mage and a hand-added
// account without a character.
import type { KaderCharacter, KaderPlayer, KaderView } from "../../api";

export const U = { tank: "111111111111111111", heal: "222222222222222222", sham: "333333333333333333", mage: "444444444444444444", hand: "555555555555555555" };

function char(over: Partial<KaderCharacter>): KaderCharacter {
    return {
        id: "c", name: "Name Nachname", className: "Warrior", specs: [], canTank: false, canHeal: false,
        origin: "profile", differs: [], mainSpec: null, role: null, gear: "none", ...over,
    };
}

export function player(over: Partial<KaderPlayer> & { userId: string }): KaderPlayer {
    return {
        displayName: over.userId, avatarUrl: null, hasProfile: true, manual: false, hasOverride: false,
        characters: [], activeCharacterId: null, differs: [], profile: null, availability: [], attendance: null, ...over,
    };
}

export function kaderView(over: Partial<KaderView> = {}): KaderView {
    const players: KaderPlayer[] = [
        player({
            userId: U.tank, displayName: "Aldric", availability: ["mi", "do"],
            characters: [char({ id: "t", name: "Aldric Sturmwind", className: "Warrior", mainSpec: "Warrior-Protection", role: "tank", gear: "ready", specs: [{ spec: "Warrior-Protection", main: true, gear: "ready" }] })],
            activeCharacterId: "t",
            attendance: { attended: 9, counted: 10, pct: 90, nights: [{ date: "2026-12-17", title: "Hyjal", attended: true, reason: null }] },
        }),
        player({
            userId: U.heal, displayName: "Mira", availability: ["mi"], hasOverride: true, differs: ["mainSpec"],
            characters: [char({ id: "h", name: "Mira Sonnlicht", className: "Shaman", origin: "planner", differs: ["mainSpec"], mainSpec: "Shaman-Restoration", role: "healer", gear: "usable", specs: [{ spec: "Shaman-Restoration", main: true, gear: "usable" }] })],
            activeCharacterId: "h",
            attendance: { attended: 6, counted: 10, pct: 60, nights: [] },
        }),
        player({
            userId: U.sham, displayName: "Tomas",
            characters: [char({ id: "s", name: "Tomas Erdherz", className: "Shaman", mainSpec: "Shaman-Enhancement", role: "melee", specs: [{ spec: "Shaman-Enhancement", main: true, gear: "none" }] })],
            activeCharacterId: "s",
        }),
        player({
            userId: U.mage, displayName: "Liss", availability: ["do"],
            characters: [char({ id: "m", name: "Liss Funkenhand", className: "Mage", mainSpec: "Mage-Frost", role: "ranged", gear: "ready", specs: [{ spec: "Mage-Frost", main: true, gear: "ready" }] })],
            activeCharacterId: "m",
            attendance: { attended: 8, counted: 10, pct: 80, nights: [] },
        }),
        player({ userId: U.hand, displayName: "Neuling", hasProfile: false, manual: true }),
    ];
    return {
        versionId: "forever",
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
            ] },
        ],
        instances: [{ id: "forever-hyjal", name: "Hyjal Summit (Forever)", short: "Hyjal F", sizes: [20], defaultSize: 20, icon: "" }],
        buffs: {
            raid: [{ key: "intellect", label: "Arkane Brillanz", icon: "", providers: ["Mage-Frost"] }],
            party: [{ key: "windfury", label: "Totem des Windzorns", icon: "", providers: ["Shaman-Enhancement", "Shaman-Restoration"], beneficiaries: ["Warrior-Protection", "Warrior-Fury", "Shaman-Enhancement"], important: true }],
        },
        players,
        members: [
            { userId: U.tank, displayName: "Aldric", inPool: true, hasProfile: true, profile: { className: "Warrior", mainSpec: "Warrior-Protection" }, pct: 90 },
            { userId: "666666666666666666", displayName: "Gast", inPool: false, hasProfile: false, profile: null, pct: null },
        ],
        rosters: [{
            id: "r1", name: "Hyjal Mittwoch", instanceId: "forever-hyjal", size: 20,
            targets: { tank: 2, healer: 5, melee: 7, ranged: 6 },
            members: [{ userId: U.tank, role: "tank" }, { userId: U.heal, role: "healer" }],
            bench: [U.sham],
        }],
        setups: { r1: { variants: [{ id: "v1", name: "Variante A", groups: Array.from({ length: 4 }, () => [null, null, null, null, null]) }] } },
        warnings: [],
        ...over,
    };
}
