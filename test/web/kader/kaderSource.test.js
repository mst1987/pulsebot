// What the Kaderplaner reads from the bot (docs/kaderplaner.md): shape, members
// with their Discord roles, the prefill sources, the server's raid categories
// with the attendance per category and, above all, that nothing private leaves
// the profile store.
jest.mock("../../../src/services/discord/discord", () => ({
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
}));
jest.mock("../../../src/services/categories/categoryNames", () => ({ listKnownCategories: jest.fn(() => []) }));
jest.mock("../../../src/stores/settings/configStore", () => ({ getConfig: jest.fn(() => ({ categoryIds: [] })) }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));
jest.mock("../../../src/web/characters/profileLogs", () => ({ logIndex: jest.fn(() => new Map()) }));
jest.mock("../../../src/stores/roster/raiderCharactersStore", () => ({ listAllAssignments: jest.fn(() => ({})) }));

const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const discord = require("../../../src/services/discord/discord");
const raiderCharacters = require("../../../src/stores/roster/raiderCharactersStore");
const { listStoredEvents } = require("../../../src/services/events/eventSources");
const { listKnownCategories } = require("../../../src/services/categories/categoryNames");
const { getConfig } = require("../../../src/stores/settings/configStore");
const { logIndex } = require("../../../src/web/characters/profileLogs");
const { loadKaderSource, loadKaderRules, listRaidCategories, groupByVersion, plannerVersion } = require("../../../src/web/kader/kaderSource");

const loadSource = (opts) => loadKaderSource({ guildId: "g1", ...opts });

const NOW = Date.UTC(2026, 11, 20, 12);
const NOW_SEC = NOW / 1000;
const DAY = 86400;
const U1 = "111111111111111111";
const U2 = "222222222222222222";
const U3 = "333333333333333333";
const U4 = "444444444444444444";

// Everything a raider may store, the private parts included.
const STORED = {
    [U1]: {
        name: "Aldric",
        characters: [
            { name: "Devi", versionId: "tbc", className: "Priest", main: true, specs: [{ key: "Priest-Holy", gear: "ready" }] },
            {
                name: "Aldric Sturmwind", versionId: "forever", className: "Warrior", source: "manual",
                specs: [{ key: "Warrior-Protection", gear: "usable" }, { key: "Warrior-Fury", gear: "none" }],
                canOfftank: null, canHeal: null,
            },
            { name: "Mira Sonnlicht", versionId: "forever", className: "Druid", specs: [{ key: "Druid-Restoration", gear: "ready" }], canOfftank: false },
        ],
        availability: ["mi", "do"],
        availabilityFrom: { mi: "19:30" },
        preferredRaids: ["forever-hyjal"],
        wishes: [U2],
        avoidEnabled: true,
        avoid: [U3],
        note: "GEHEIME-NOTIZ nur fuer die Orga",
    },
    [U2]: {
        name: "Only TBC",
        characters: [{ name: "Oldie", versionId: "tbc", className: "Mage", main: true, specs: [{ key: "Mage-Fire", gear: "ready" }] }],
        availability: ["mo"],
    },
};

let file;
beforeAll(() => {
    file = tempStoreFile("eh-kader-profiles.json");
    fs.writeFileSync(file, JSON.stringify({ profiles: STORED }));
    profiles.useFile(file);
});
afterAll(() => profiles.useFile(null));

beforeEach(() => {
    jest.clearAllMocks();
    discord.listHumanMembers.mockResolvedValue({ members: [
        { id: U1, displayName: "Aldric", avatarUrl: "https://cdn.example/a.png", roleIds: ["r-raider"] },
        { id: U2, displayName: "Oldie", avatarUrl: null, roleIds: ["r-raider", "r-trial"] },
    ], error: null });
    discord.listRoles.mockReturnValue([
        { id: "r-raider", name: "Raider", color: "#8a7cff" },
        { id: "r-trial", name: "Trial", color: "" },
        { id: "r-empty", name: "Niemand", color: "" },
    ]);
    listStoredEvents.mockReturnValue([]);
    listKnownCategories.mockReturnValue([]);
    getConfig.mockReturnValue({ categoryIds: [] });
    logIndex.mockReturnValue(new Map());
    raiderCharacters.listAllAssignments.mockReturnValue({});
});

describe("web/kader/kaderSource", () => {
    it("works in Forever", () => {
        expect(plannerVersion()).toBe("forever");
        expect(loadKaderRules().classes.map((c) => c.key)).toContain("Warrior");
    });

    it("builds the documented top-level shape", async () => {
        const out = await loadSource({ now: NOW });
        expect(Object.keys(out)).toEqual([
            "guildId", "versionId", "mainVersion", "classes", "buffs", "members", "discordRoles", "profiles", "logChars", "raidCategories", "attendance", "warnings",
        ]);
        expect(out).toMatchObject({ guildId: "g1", versionId: "forever", mainVersion: { id: "tbc", label: expect.any(String) }, warnings: [] });
    });

    it("hands out the raid buffs worth a line and the party buffs a group is checked for", async () => {
        const out = await loadSource({ now: NOW });
        expect(out.buffs.raid.map((b) => b.key)).toEqual(["fortitude", "intellect", "motw", "kings", "might"]);
        const windfury = out.buffs.party.find((b) => b.key === "windfury");
        expect(windfury).toMatchObject({ important: true, providers: expect.arrayContaining(["Shaman-Enhancement"]) });
        expect(windfury.beneficiaries).toContain("Warrior-Fury");
        expect(out.buffs.party.find((b) => b.key === "trueshot").important).toBe(false);
    });

    it("names every buff in English too, as the rule set spells it", async () => {
        const out = await loadSource({ now: NOW });
        const party = new Map(out.buffs.party.map((b) => [b.key, b]));
        expect(party.get("manaSpring")).toMatchObject({ label: "Totem der Manaquelle", labelEn: "Mana Spring Totem" });
        expect(party.get("battleShout").labelEn).toBe("Battle Shout");
        expect(out.buffs.raid.find((b) => b.key === "kings").labelEn).toBe("Blessing of Kings");
        for (const b of [...out.buffs.party, ...out.buffs.raid]) expect(b.labelEn).toMatch(/^[A-Za-z' :-]+$/);
    });

    it("lists the rule set's classes with spec roles and icons", async () => {
        const out = await loadSource({ now: NOW });
        const warrior = out.classes.find((c) => c.key === "Warrior");
        expect(warrior).toMatchObject({ name: "Krieger", nameEn: "Warrior", color: expect.stringMatching(/^#/), icon: expect.any(String) });
        expect(warrior.specs.find((s) => s.key === "Warrior-Protection")).toMatchObject({ name: "Schutz", role: "tank", canTank: true });
        const roles = new Set(out.classes.flatMap((c) => c.specs.map((s) => s.role)));
        expect([...roles].sort()).toEqual(["healer", "melee", "ranged", "tank"]);
    });

    it("hands out the members with their roles, and the roles somebody holds with a count", async () => {
        const out = await loadSource({ now: NOW });
        expect(discord.listHumanMembers).toHaveBeenCalledWith("g1");
        expect(out.members).toEqual([
            { userId: U1, displayName: "Aldric", avatarUrl: "https://cdn.example/a.png", roleIds: ["r-raider"] },
            { userId: U2, displayName: "Oldie", avatarUrl: null, roleIds: ["r-raider", "r-trial"] },
        ]);
        expect(out.discordRoles).toEqual([
            { id: "r-raider", name: "Raider", color: "#8a7cff", count: 2 },
            { id: "r-trial", name: "Trial", color: "", count: 1 },
        ]);
    });

    it("answers with an empty member list and a warning when Discord cannot list them", async () => {
        discord.listHumanMembers.mockResolvedValue({ members: [], error: "Used disallowed intents" });
        const out = await loadSource({ now: NOW });
        expect(out.members).toEqual([]);
        expect(out.discordRoles).toEqual([]);
        expect(out.warnings).toEqual([expect.stringMatching(/GuildMembers.*Used disallowed intents/)]);
    });

    it("warns instead of asking Discord when no server is active", async () => {
        const out = await loadSource({ guildId: "", now: NOW });
        expect(discord.listHumanMembers).not.toHaveBeenCalled();
        expect(out.guildId).toBe("");
        expect(out.warnings).toHaveLength(1);
    });

    describe("profiles", () => {
        it("carries the characters of the version, and another version's main as `other`", async () => {
            const out = await loadSource({ now: NOW });
            expect(out.profiles.map((p) => p.userId)).toEqual([U1, U2]);
            const [aldric, oldie] = out.profiles;
            expect(aldric.characters.map((c) => c.name)).toEqual(["Aldric Sturmwind", "Mira Sonnlicht"]);
            expect(aldric.availability).toEqual(["mi", "do"]);
            // the hour per day from the profile (Mi ab 19:30) - Do has none, the whole evening
            expect(aldric.availabilityFrom).toEqual({ mi: "19:30" });
            expect(aldric.other).toEqual({ name: "Devi", className: "Priest", spec: "Priest-Holy", versionId: "tbc" });
            expect(oldie).toMatchObject({ characters: [], other: { name: "Oldie", className: "Mage", spec: "Mage-Fire", versionId: "tbc" } });
        });

        it("lists every character of the account in `allCharacters`, whatever its game version", async () => {
            const out = await loadSource({ now: NOW });
            const [aldric, oldie] = out.profiles;
            expect(aldric.allCharacters.map((c) => c.name)).toEqual(expect.arrayContaining(["Aldric Sturmwind", "Mira Sonnlicht", "Devi"]));
            expect(aldric.allCharacters.find((c) => c.name === "Devi")).toMatchObject({ className: "Priest", versionId: "tbc" });
            expect(oldie.allCharacters).toEqual([expect.objectContaining({ name: "Oldie", versionId: "tbc", className: "Mage" })]);
            for (const c of aldric.allCharacters) expect(Object.keys(c).sort()).toEqual(["canHeal", "canTank", "className", "key", "name", "specs", "versionId"]);
        });

        it("hands a character out in the documented shape with effective tank/heal switches", async () => {
            const out = await loadSource({ now: NOW });
            const [warrior, druid] = out.profiles[0].characters;
            expect(warrior).toEqual({
                key: "forever~aldric sturmwind",
                name: "Aldric Sturmwind",
                className: "Warrior",
                specs: [{ spec: "Warrior-Protection", gear: "usable" }, { spec: "Warrior-Fury", gear: "none" }],
                // the account's main is the TBC priest: inside Forever the first character stands in
                main: true,
                canTank: true,
                canHeal: false,
                logSpecs: [],
            });
            // the druid's own "no" to tanking wins; healing follows from the resto spec
            expect(druid).toMatchObject({ main: false, canTank: false, canHeal: true });
        });

        it("names the spec the logs saw when the class matches", async () => {
            logIndex.mockReturnValue(new Map([
                ["aldric sturmwind", { className: "Warrior", specKey: "Warrior-Protection" }],
                ["mira sonnlicht", { className: "Mage", specKey: "Mage-Frost" }],
            ]));
            const out = await loadSource({ now: NOW });
            const [warrior, druid] = out.profiles[0].characters;
            expect(warrior.logSpecs).toEqual(["Warrior-Protection"]);
            expect(druid.logSpecs).toEqual([]);
        });

        // The privacy rule of docs/kaderplaner.md: none of this may ever leave.
        it("never hands out avoid lists, wishes, notes, preferred raids or claims", async () => {
            const out = await loadSource({ now: NOW });
            const text = JSON.stringify(out);
            for (const field of ["avoid", "avoidEnabled", "wishes", "note", "preferredRaids", "claimedBy", "calendar", "token"]) {
                expect(text).not.toContain(`"${field}"`);
            }
            expect(text).not.toContain("GEHEIME-NOTIZ");
            expect(text).not.toContain(U3);
            expect(Object.keys(out.profiles[0]).sort()).toEqual(["allCharacters", "availability", "availabilityFrom", "characters", "displayName", "other", "userId"]);
        });
    });

    it("links an account without a profile to a character through the raider assignments and the logs", async () => {
        raiderCharacters.listAllAssignments.mockReturnValue({ c1: { [U4]: "Kael", [U3]: "Unbekannt" } });
        logIndex.mockReturnValue(new Map([["kael", { character: "Kael", className: "Rogue", specKey: "Rogue-Combat" }]]));
        const out = await loadSource({ now: NOW });
        expect(out.logChars).toEqual({ [U4]: { name: "Kael", className: "Rogue", spec: "Rogue-Combat" } });
    });

    describe("raid categories and attendance", () => {
        const EVENTS = [
            { id: "e1", categoryId: "c1", versionId: "forever", title: "Hyjal", startTime: NOW_SEC - 2 * DAY, signUps: [{ userId: U1, status: "signed" }] },
            { id: "e2", categoryId: "c2", versionId: "forever", title: "Ony", startTime: NOW_SEC - 5 * DAY, signUps: [{ userId: U1, status: "absence" }] },
            { id: "e3", categoryId: "c1", versionId: "tbc", title: "Kara", startTime: NOW_SEC - 3 * DAY, signUps: [{ userId: U1, status: "signed" }, { userId: U2, status: "absence" }] },
            { id: "future", categoryId: "c1", versionId: "forever", title: "Next", startTime: NOW_SEC + 2 * DAY, signUps: [{ userId: U1, status: "signed" }] },
        ];

        beforeEach(() => {
            listKnownCategories.mockReturnValue([
                { id: "c1", name: "Mo Raid" }, { id: "c-info", name: "Info" }, { id: "c2", name: "Do Raid" }, { id: "c3", name: "" },
            ]);
        });

        it("lists the configured event categories, named, in Discord's order", async () => {
            getConfig.mockReturnValue({ categoryIds: ["c1", "c2", "c-unnamed"], categoryVersion: { c2: "forever" } });
            listStoredEvents.mockReturnValue([{ id: "e0", categoryId: "c1", title: "Kara", startTime: NOW_SEC - DAY, signUps: [] }]);
            // a category without a raid or the admin's mark (Info), or without any name, is no raid category
            expect(listRaidCategories("g1")).toEqual([
                { id: "c1", name: "Mo Raid", versionId: "tbc", versionLabel: "TBC", hidden: false },
                { id: "c2", name: "Do Raid", versionId: "forever", versionLabel: "Forever", hidden: false },
            ]);
            expect(listKnownCategories).toHaveBeenCalledWith("g1");
            // a night without a signup or a log is not counted yet; a Forever Kader sees its own version's
            // categories first, those of another version after them - uncounted (null) until a Kader picks one
            const out = await loadSource({ now: NOW });
            expect(out.raidCategories.map((c) => [c.id, c.versionId, c.nights])).toEqual([["c2", "forever", 0], ["c1", "tbc", null]]);
            expect(listRaidCategories("g1", { versionId: "tbc" }).map((c) => c.id)).toEqual(["c1"]);
        });

        it("leaves out a deactivated category, even with raids (#744)", () => {
            getConfig.mockReturnValue({ categoryIds: ["c2"], categoryVersion: { c2: "forever" } });
            listStoredEvents.mockReturnValue([{ id: "e0", categoryId: "c1", title: "Kara", startTime: NOW_SEC - DAY, signUps: [] }]);
            expect(listRaidCategories("g1").map((c) => c.id)).toEqual(["c2"]);
        });

        it("without any active category (an install that never picked one) counts every category a raid ran in", () => {
            getConfig.mockReturnValue({ categoryIds: [] });
            listStoredEvents.mockReturnValue([{ id: "e0", categoryId: "c1", title: "Kara", startTime: NOW_SEC - DAY, signUps: [] }]);
            expect(listRaidCategories("g1").map((c) => c.id)).toEqual(["c1"]);
        });

        it("offers only the categories of the asked version, never one of a hidden version (#741, #563)", () => {
            getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], categoryVersion: { c2: "forever" } });
            listStoredEvents.mockReturnValue([]);
            expect(listRaidCategories("g1", { versionId: "forever" }).map((c) => c.id)).toEqual(["c2"]);
            expect(listRaidCategories("g1", { versionId: "tbc" }).map((c) => c.id)).toEqual(["c1"]);
            getConfig.mockReturnValue({ categoryIds: ["c1", "c2"], categoryVersion: { c2: "forever" }, hideOtherVersions: true });
            expect(listRaidCategories("g1").map((c) => c.id)).toEqual(["c1"]);
            expect(listRaidCategories("g1", { versionId: "forever" })).toEqual([]);
            // the Kaderplaner's attendance pick asks for the hidden ones too, marked
            expect(listRaidCategories("g1", { includeHidden: true }).map((c) => [c.id, c.hidden])).toEqual([["c1", false], ["c2", true]]);
        });

        it("groups the categories by version: the Kader's own first, then the shown ones, then the hidden ones", () => {
            const cats = [
                { id: "a", versionId: "tbc", hidden: false }, { id: "b", versionId: "classic", hidden: true },
                { id: "c", versionId: "forever", hidden: false }, { id: "d", versionId: "tbc", hidden: false },
            ];
            expect(groupByVersion(cats, "forever").map((c) => c.id)).toEqual(["c", "a", "d", "b"]);
            expect(groupByVersion(cats, "tbc").map((c) => c.id)).toEqual(["a", "d", "c", "b"]);
            expect(groupByVersion(cats, "classic").map((c) => c.id)).toEqual(["b", "a", "d", "c"]);
            expect(groupByVersion([], "forever")).toEqual([]);
        });

        it("counts every account per category over the nights of the version the category plays, newest first (#740)", async () => {
            // both categories play Forever now; c1 played TBC before (its night e3)
            getConfig.mockReturnValue({ categoryIds: [], categoryVersion: { c1: "forever", c2: "forever" } });
            listStoredEvents.mockReturnValue(EVENTS);
            const out = await loadSource({ now: NOW });
            // Forever: the TBC night e3 of c1 counts nowhere
            expect(out.raidCategories.map((c) => [c.id, c.nights])).toEqual([["c1", 1], ["c2", 1]]);
            const byUser = new Map(out.attendance.map((a) => [a.userId, a.byCategory]));
            expect(byUser.get(U1)).toEqual({
                c1: {
                    attended: 1, counted: 1, versionId: "forever", nights: [
                        { date: "2026-12-18", eventId: "e1", title: "Hyjal", attended: true, status: "present", reason: null },
                    ],
                },
                c2: { attended: 0, counted: 1, versionId: "forever", nights: [{ date: "2026-12-15", eventId: "e2", title: "Ony", attended: false, status: "absence", reason: "abgemeldet" }] },
            });
            // an account with a TBC character only is counted on the category's Forever nights
            expect(byUser.get(U2).c1).toMatchObject({ attended: 0, counted: 1 });
            expect(byUser.get(U2).c1.nights.map((n) => n.reason)).toEqual(["keine Anmeldung"]);
        });

        it("counts a TBC Kader over the TBC nights only", async () => {
            listStoredEvents.mockReturnValue(EVENTS);
            const out = await loadSource({ versionId: "tbc", now: NOW });
            expect(out.raidCategories.map((c) => [c.id, c.nights])).toEqual([["c1", 1], ["c2", 0]]);
            const byUser = new Map(out.attendance.map((a) => [a.userId, a.byCategory]));
            expect(byUser.get(U1).c1.nights.map((n) => n.eventId)).toEqual(["e3"]);
            expect(byUser.get(U1).c2).toBeUndefined();
        });

        it("counts an account the orga assigned a character to, without a profile", async () => {
            raiderCharacters.listAllAssignments.mockReturnValue({ c1: { [U4]: "Kael" } });
            logIndex.mockReturnValue(new Map([["kael", { character: "Kael", className: "Rogue", specKey: "Rogue-Combat" }]]));
            getConfig.mockReturnValue({ categoryIds: [], categoryVersion: { c1: "forever" } });
            listStoredEvents.mockReturnValue([{ id: "e1", categoryId: "c1", versionId: "forever", title: "Kara", startTime: NOW_SEC - DAY, signUps: [{ userId: U4, status: "signed" }] }]);
            const out = await loadSource({ now: NOW });
            expect(out.attendance.find((a) => a.userId === U4).byCategory).toEqual({
                c1: { attended: 1, counted: 1, versionId: "forever", nights: [expect.objectContaining({ eventId: "e1", attended: true })] },
            });
        });

        describe("a Kader counting the categories of another version (the attendance exception)", () => {
            // c1 plays TBC (the main version), c2 Forever
            beforeEach(() => {
                getConfig.mockReturnValue({ categoryIds: [], categoryVersion: { c2: "forever" } });
                listStoredEvents.mockReturnValue(EVENTS);
            });

            it("counts a picked TBC category's TBC nights for a Forever Kader, against the TBC characters", async () => {
                const out = await loadSource({ versionId: "forever", attendanceCategoryIds: ["c1"], now: NOW });
                expect(out.versionId).toBe("forever");
                expect(out.raidCategories.map((c) => [c.id, c.versionId, c.versionLabel, c.hidden, c.nights])).toEqual([
                    ["c2", "forever", "Forever", false, 1],
                    ["c1", "tbc", "TBC", false, 1],
                ]);
                const byUser = new Map(out.attendance.map((a) => [a.userId, a.byCategory]));
                // the TBC night e3 counts in c1, the Forever night e1 that ran in c1 does not
                expect(byUser.get(U1).c1).toEqual({
                    attended: 1, counted: 1, versionId: "tbc",
                    nights: [{ date: "2026-12-17", eventId: "e3", title: "Kara", attended: true, status: "present", reason: null }],
                });
                expect(byUser.get(U1).c2).toMatchObject({ versionId: "forever", counted: 1 });
                // the TBC-only raider is counted on the TBC night too
                expect(byUser.get(U2).c1).toMatchObject({ attended: 0, counted: 1, versionId: "tbc" });
                // the characters the planner offers stay those of the Kader's version
                expect(out.profiles.find((p) => p.userId === U1).characters.map((c) => c.name)).toEqual(["Aldric Sturmwind", "Mira Sonnlicht"]);
            });

            it("counts no version nobody picked: its categories stay listed without nights", async () => {
                const out = await loadSource({ versionId: "forever", now: NOW });
                expect(out.raidCategories.map((c) => [c.id, c.nights])).toEqual([["c2", 1], ["c1", null]]);
                const byUser = new Map(out.attendance.map((a) => [a.userId, a.byCategory]));
                expect(byUser.get(U1).c1).toBeUndefined();
                // an unknown picked id changes nothing
                const again = await loadSource({ versionId: "forever", attendanceCategoryIds: ["c-gone"], now: NOW });
                expect(again.raidCategories.map((c) => [c.id, c.nights])).toEqual([["c2", 1], ["c1", null]]);
            });

            it("offers and counts the categories of a hidden version, marked hidden", async () => {
                // Forever hidden: only the main version (TBC) is shown
                getConfig.mockReturnValue({ categoryIds: [], categoryVersion: { c2: "forever" }, hideOtherVersions: true });
                const out = await loadSource({ versionId: "tbc", attendanceCategoryIds: ["c2"], now: NOW });
                expect(out.raidCategories.map((c) => [c.id, c.hidden, c.nights])).toEqual([["c1", false, 1], ["c2", true, 1]]);
                const byUser = new Map(out.attendance.map((a) => [a.userId, a.byCategory]));
                expect(byUser.get(U1).c2).toMatchObject({ attended: 0, counted: 1, versionId: "forever" });
            });
        });

        it("counts nothing without raid nights", async () => {
            const out = await loadSource({ now: NOW });
            expect(out.raidCategories).toEqual([]);
            expect(out.attendance).toEqual([]);
        });

        it("keeps answering with a warning when attendance cannot be read", async () => {
            listStoredEvents.mockImplementation(() => { throw new Error("disk"); });
            const out = await loadSource({ now: NOW });
            expect(out.raidCategories).toEqual([]);
            expect(out.attendance).toEqual([]);
            expect(out.warnings).toEqual([expect.stringMatching(/Anwesenheit.*disk/)]);
        });
    });

    it("refuses an unknown version", async () => {
        await expect(loadSource({ versionId: "wotlk", now: NOW })).rejects.toThrow(/unknown version/);
        expect(() => loadKaderRules("wotlk")).toThrow(/unknown version/);
    });
});
