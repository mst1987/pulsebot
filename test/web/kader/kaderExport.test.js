// The Kaderbau snapshot (docs/kaderbau.md): shape, version filter, attendance
// and — above all — that nothing private leaves the profile store.
jest.mock("../../../src/services/discord/discord", () => ({
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
}));
jest.mock("../../../src/services/discord/guildRoles", () => ({ eventGuildId: jest.fn(() => "g1") }));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));
jest.mock("../../../src/web/characters/profileLogs", () => ({ logIndex: jest.fn(() => new Map()) }));

const fs = require("fs");
const { tempStoreFile } = require("../../helpers/tempStore");
const profiles = require("../../../src/stores/raiderProfileStore");
const discord = require("../../../src/services/discord/discord");
const { listStoredEvents } = require("../../../src/services/events/eventSources");
const { logIndex } = require("../../../src/web/characters/profileLogs");
const { buildKaderExport, exportVersion } = require("../../../src/web/kader/kaderExport");

const NOW = Date.UTC(2026, 11, 20, 12);
const NOW_SEC = NOW / 1000;
const DAY = 86400;
const U1 = "111111111111111111";
const U2 = "222222222222222222";
const U3 = "333333333333333333";

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
        preferredRaids: ["forever-hyjal"],
        wishes: [U2],
        avoidEnabled: true,
        avoid: [U3],
        note: "GEHEIME-NOTIZ nur fuer die Orga",
    },
    [U2]: {
        name: "Only TBC",
        characters: [{ name: "Oldie", versionId: "tbc", className: "Mage", main: true, specs: [] }],
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
        { id: U1, displayName: "Aldric", avatarUrl: "https://cdn.example/a.png" },
        { id: U2, displayName: "Oldie", avatarUrl: null },
    ], error: null });
    listStoredEvents.mockReturnValue([]);
    logIndex.mockReturnValue(new Map());
});

describe("web/kader/kaderExport", () => {
    describe("exportVersion", () => {
        it("defaults to forever and refuses an unknown version", () => {
            expect(exportVersion("")).toBe("forever");
            expect(exportVersion(null)).toBe("forever");
            expect(exportVersion("tbc")).toBe("tbc");
            expect(exportVersion("wotlk")).toBeNull();
        });
    });

    it("builds the documented top-level shape", async () => {
        const out = await buildKaderExport({ versionId: "forever", now: NOW });
        expect(Object.keys(out)).toEqual([
            "format", "v", "generatedAt", "guildId", "versionId",
            "classes", "instances", "members", "profiles", "attendance", "warnings",
        ]);
        expect(out).toMatchObject({ format: "eventhelper-kader", v: 1, guildId: "g1", versionId: "forever", warnings: [] });
        expect(out.generatedAt).toBe(new Date(NOW).toISOString());
    });

    it("lists the rule set's classes with spec roles and the version's instances", async () => {
        const out = await buildKaderExport({ versionId: "forever", now: NOW });
        const warrior = out.classes.find((c) => c.key === "Warrior");
        expect(warrior).toMatchObject({ name: "Krieger", nameEn: "Warrior", color: expect.stringMatching(/^#/) });
        expect(warrior.specs.find((s) => s.key === "Warrior-Protection")).toMatchObject({ name: "Schutz", role: "tank", canTank: true });
        const roles = new Set(out.classes.flatMap((c) => c.specs.map((s) => s.role)));
        expect([...roles].sort()).toEqual(["healer", "melee", "ranged", "tank"]);
        expect(out.instances.find((i) => i.id === "forever-hyjal")).toMatchObject({ sizes: [20], defaultSize: 20 });
        expect(out.instances.every((i) => i.id.startsWith("forever-"))).toBe(true);
    });

    it("hands out the event server's human members", async () => {
        const out = await buildKaderExport({ versionId: "forever", now: NOW });
        expect(discord.listHumanMembers).toHaveBeenCalledWith("g1");
        expect(out.members).toEqual([
            { userId: U1, displayName: "Aldric", avatarUrl: "https://cdn.example/a.png" },
            { userId: U2, displayName: "Oldie", avatarUrl: null },
        ]);
    });

    it("answers with an empty member list and a warning when Discord cannot list them", async () => {
        discord.listHumanMembers.mockResolvedValue({ members: [], error: "Used disallowed intents" });
        const out = await buildKaderExport({ versionId: "forever", now: NOW });
        expect(out.members).toEqual([]);
        expect(out.warnings).toEqual([expect.stringMatching(/GuildMembers.*Used disallowed intents/)]);
    });

    it("warns instead of asking Discord when no event server is configured", async () => {
        const out = await buildKaderExport({ versionId: "forever", guildId: "", now: NOW });
        expect(discord.listHumanMembers).not.toHaveBeenCalled();
        expect(out.guildId).toBe("");
        expect(out.warnings).toHaveLength(1);
    });

    describe("profiles", () => {
        it("carries only the characters of the version, and only raiders who have one", async () => {
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            expect(out.profiles.map((p) => p.userId)).toEqual([U1]);
            const [p] = out.profiles;
            expect(p.characters.map((c) => c.name)).toEqual(["Aldric Sturmwind", "Mira Sonnlicht"]);
            expect(p.availability).toEqual(["mi", "do"]);
        });

        it("exports a character in the documented shape with effective tank/heal switches", async () => {
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            const [warrior, druid] = out.profiles[0].characters;
            expect(warrior).toEqual({
                key: "forever~aldric sturmwind",
                name: "Aldric Sturmwind",
                className: "Warrior",
                realm: "",
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
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            const [warrior, druid] = out.profiles[0].characters;
            expect(warrior.logSpecs).toEqual(["Warrior-Protection"]);
            expect(druid.logSpecs).toEqual([]);
        });

        // The privacy rule of docs/kaderbau.md: none of this may ever leave.
        it("never exports avoid lists, wishes, notes, preferred raids or claims", async () => {
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            const text = JSON.stringify(out);
            for (const field of ["avoid", "avoidEnabled", "wishes", "note", "preferredRaids", "claimedBy", "calendar", "token"]) {
                expect(text).not.toContain(`"${field}"`);
            }
            expect(text).not.toContain("GEHEIME-NOTIZ");
            expect(text).not.toContain(U3);
            expect(Object.keys(out.profiles[0]).sort()).toEqual(["availability", "characters", "userId"]);
        });
    });

    describe("attendance", () => {
        it("sums up every raid category's nights of the version per account, newest first", async () => {
            listStoredEvents.mockReturnValue([
                { id: "e1", categoryId: "c1", versionId: "forever", title: "Hyjal", startTime: NOW_SEC - 2 * DAY, signUps: [{ userId: U1, status: "signed" }] },
                { id: "e2", categoryId: "c2", versionId: "forever", title: "Ony", startTime: NOW_SEC - 5 * DAY, signUps: [{ userId: U1, status: "absence" }] },
                { id: "e3", categoryId: "c1", versionId: "tbc", title: "Kara", startTime: NOW_SEC - 3 * DAY, signUps: [{ userId: U1, status: "signed" }] },
                { id: "future", categoryId: "c1", versionId: "forever", title: "Next", startTime: NOW_SEC + 2 * DAY, signUps: [{ userId: U1, status: "signed" }] },
            ]);
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            expect(out.attendance).toHaveLength(1);
            const [a] = out.attendance;
            expect(a).toMatchObject({ userId: U1, attended: 1, counted: 2, rate: 0.5 });
            expect(a.nights).toEqual([
                { date: "2026-12-18", eventId: "e1", title: "Hyjal", attended: true, reason: null },
                { date: "2026-12-15", eventId: "e2", title: "Ony", attended: false, reason: "abgemeldet" },
            ]);
        });

        it("counts nothing yet for a version without raid nights", async () => {
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            expect(out.attendance).toEqual([{ userId: U1, attended: 0, counted: 0, rate: null, nights: [] }]);
        });

        it("keeps answering with a warning when attendance cannot be read", async () => {
            listStoredEvents.mockImplementation(() => { throw new Error("disk"); });
            const out = await buildKaderExport({ versionId: "forever", now: NOW });
            expect(out.attendance).toEqual([]);
            expect(out.warnings).toEqual([expect.stringMatching(/Anwesenheit.*disk/)]);
        });
    });

    it("refuses an unknown version", async () => {
        await expect(buildKaderExport({ versionId: "wotlk", now: NOW })).rejects.toThrow(/unknown version/);
    });
});
