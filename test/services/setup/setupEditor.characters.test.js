// Several characters per raider (#293) through the setup editor's service
// (src/services/setup/setupEditor.js): the editor gets every signed character of
// a person, a save places any of them (one seat per person), the bench names the
// one waiting there — and everything raiders read afterwards (the approved
// snapshot, the setup message, the DMs, the bot's lookup) shows the PLACED
// character, never the signup's first one.
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => (mockEvents.has(id) ? JSON.parse(JSON.stringify(mockEvents.get(id))) : null),
    listEvents: () => [...mockEvents.values()],
    isOwnEventId: (id) => String(id || "").startsWith("eh-"),
    setEventSetup: (id, setup) => {
        if (!mockEvents.has(id)) return null;
        mockEvents.set(id, { ...mockEvents.get(id), setup: JSON.parse(JSON.stringify(setup)) });
        return JSON.parse(JSON.stringify(mockEvents.get(id)));
    },
}));
let mockSignups = [];
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: () => mockSignups }));
jest.mock("../../../src/stores/roster/raiderProfileStore", () => ({ listProfiles: () => [] }));
jest.mock("../../../src/stores/settings/settingsStore", () => ({ getConfig: () => ({}), getRaidTemplate: () => null }));
jest.mock("../../../src/services/characters/rosterAttendance", () => ({ buildAttendanceContext: () => ({}), attendanceFor: () => ({ pct: null }) }));
jest.mock("../../../src/services/events/eventSources", () => ({
    listStoredEvents: () => [],
    specNameFor: jest.requireActual("../../../src/services/events/eventSources").specNameFor,
}));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn(), sendDirectMessage: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const editor = require("../../../src/services/setup/setupEditor");
const { approvedSetupOf } = require("../../../src/services/setup/setupCore");
const { buildSetupMessage, buildSetupDm, placementsOf } = require("../../../src/services/setup/setupMessage");
const { su } = require("../../utils/setup/fixtures");

const ID = "eh-kara";

/** Zibbo: holy priest first, then the protection warrior Zibbowar (late) and the shadow priest Zibboshadow. */
const zibbo = () => su("zibbo", "Priest-Holy", {
    character: "Zibbo",
    characters: [
        { character: "Zibbo", spec: "Priest-Holy", status: "signed" },
        { character: "Zibbowar", spec: "Warrior-Protection", status: "late" },
        { character: "Zibboshadow", spec: "Priest-Shadow", status: "signed" },
    ],
});

beforeEach(() => {
    mockEvents.clear();
    mockEvents.set(ID, {
        id: ID, source: "eventhelper", guildId: "g1", categoryId: "cat", title: "Kara", startTime: 2000000000,
        versionId: "tbc", size: 10, composition: { tank: 1, healer: 2, melee: 0, ranged: 0 }, fairness: false, wishes: false, setup: null,
    });
    mockSignups = [zibbo(), su("heal", "Paladin-Holy"), su("mage", "Mage-Fire")];
});

const view = () => editor.editorView(mockEvents.get(ID), { canWrite: true, signups: mockSignups, blank: true });
const placedIn = (setup) => setup.groups.flatMap((g) => g.slots);

describe("the editor's payload", () => {
    it("lists every signed character of a person — in their order, each with its spec, role and own status — and nothing for one character", () => {
        const pool = view().setup.pool;
        const z = pool.find((p) => p.userId === "zibbo");
        expect(z.characters.map((c) => [c.character, c.spec, c.role, c.status, c.priority])).toEqual([
            ["Zibbo", "Priest-Holy", "healer", "signed", 0],
            ["Zibbowar", "Warrior-Protection", "tank", "late", 1],
            ["Zibboshadow", "Priest-Shadow", "ranged", "signed", 2],
        ]);
        expect(z.characters[1]).toMatchObject({ classId: "Warrior", classColor: expect.any(String), specIcon: expect.any(String) });
        // a person is one entry, whatever the characters
        expect(pool.filter((p) => p.userId === "zibbo")).toHaveLength(1);
        expect(pool.find((p) => p.userId === "mage").characters).toBeUndefined();
    });
});

describe("saving a lineup with a further character", () => {
    it("places the second character, keeps one seat per person and refuses a foreign one", () => {
        const saved = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "zibbo", character: "Zibbowar", spec: "Warrior-Protection", role: "tank", locked: true }, { userId: "heal", spec: "Paladin-Holy" }] }], bench: [] });
        expect(saved.error).toBeUndefined();
        const z = placedIn(saved.setup).find((s) => s.userId === "zibbo");
        expect(z).toMatchObject({ character: "Zibbowar", spec: "Warrior-Protection", role: "tank", locked: true });
        expect(z.reasons).toContain("Mit Zibbowar als Tank (von der Orga gewählt)");
        // gone from the pool, with every character
        expect(saved.setup.pool.map((p) => p.userId)).not.toContain("zibbo");
        // the payload shows the character standing and still offers the others
        const slot = placedIn(view().setup).find((s) => s.userId === "zibbo");
        expect(slot).toMatchObject({ character: "Zibbowar", classColor: expect.any(String) });
        expect(slot.characters.map((c) => c.character)).toEqual(["Zibbo", "Zibbowar", "Zibboshadow"]);

        const twice = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "zibbo", character: "Zibbo", spec: "Priest-Holy" }] }], bench: [{ userId: "zibbo", character: "Zibbowar" }] });
        expect(twice).toMatchObject({ code: "invalid", error: "Zibbo steht zweimal im Setup." });
        const foreign = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "zibbo", character: "Fremdling", spec: "Priest-Holy" }] }], bench: [] });
        expect(foreign.code).toBe("invalid");
        expect(foreign.error).toMatch(/Fremdling ist nicht unter den angemeldeten Charakteren/);
    });

    it("switches the character on the bench as a change of the lineup", () => {
        const first = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "heal", spec: "Paladin-Holy" }] }], bench: [{ userId: "zibbo" }] });
        expect(first.setup.bench.find((b) => b.userId === "zibbo").character).toBe("Zibbo");
        const switched = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "heal", spec: "Paladin-Holy" }] }], bench: [{ userId: "zibbo", character: "Zibboshadow" }] });
        expect(switched.setup.bench.find((b) => b.userId === "zibbo")).toMatchObject({ character: "Zibboshadow", spec: "Priest-Shadow" });
        expect(switched.setup.version).toBe(first.setup.version + 1);
    });
});

describe("what raiders read shows the placed character", () => {
    it("the approved snapshot, the setup message, the DM and the bot's lookup name Zibbowar, not Zibbo", () => {
        const saved = editor.saveEventSetup(ID, { groups: [{ index: 1, slots: [{ userId: "zibbo", character: "Zibbowar", spec: "Warrior-Protection", role: "tank" }, { userId: "heal", spec: "Paladin-Holy" }] }], bench: [] });
        editor.approveEventSetup(ID, { version: saved.setup.version, userId: "orga" });
        const event = mockEvents.get(ID);
        const approved = approvedSetupOf(event);
        expect(placedIn(approved).find((s) => s.userId === "zibbo")).toMatchObject({ character: "Zibbowar", spec: "Warrior-Protection", role: "tank" });

        const message = JSON.stringify(buildSetupMessage(event, approved, { lang: "en" }));
        expect(message).toContain("Zibbowar");
        expect(message).not.toMatch(/\*\*Zibbo\*\*/);

        const mine = placementsOf(approved).find((p) => p.userId === "zibbo");
        expect(mine.character).toBe("Zibbowar");
        expect(JSON.stringify(buildSetupDm(event, mine, { lang: "en" }))).toContain("Zibbowar");

        expect(editor.approvedPlacementFor(event, "zibbo")).toMatchObject({ group: 1, character: "Zibbowar", spec: "Warrior-Protection", role: "tank" });
        expect(editor.raidHelperSlots(event).find((s) => s.userId === "zibbo").name).toBe("Zibbowar");
    });
});

describe("one instance per raid ID in the editor's payload", () => {
    const placedElsewhere = (id, guildId, character) => ({
        id, source: "eventhelper", guildId, title: `Kara ${id}`, startTime: 2000000000 + 3600, instanceIds: ["kara"], status: "active",
        setup: { groups: [{ index: 1, slots: [{ userId: "zibbo", character, spec: "Warrior-Protection", role: "tank" }] }], bench: [] },
    });

    it("marks the character saved in another raid of the same instance and ID - details only on the own server", () => {
        mockEvents.set(ID, { ...mockEvents.get(ID), instanceIds: ["kara"] });
        mockEvents.set("eh-kara2", placedElsewhere("eh-kara2", "g1", "Zibbowar"));
        mockEvents.set("eh-foreign", placedElsewhere("eh-foreign", "g2", "Zibboshadow"));
        const z = view().setup.pool.find((p) => p.userId === "zibbo");
        expect(z.characters.find((c) => c.character === "Zibbowar").raidIdTaken).toMatchObject({ local: true, title: "Kara eh-kara2" });
        expect(z.characters.find((c) => c.character === "Zibboshadow").raidIdTaken).toEqual({ other: true });
        expect(z.characters.find((c) => c.character === "Zibbo").raidIdTaken).toBeUndefined();
        expect(JSON.stringify(view())).not.toMatch(/eh-foreign/);
    });

    it("marks nothing for a raid without an instance", () => {
        mockEvents.set("eh-kara2", placedElsewhere("eh-kara2", "g1", "Zibbowar"));
        expect(JSON.stringify(view())).not.toMatch(/raidIdTaken/);
    });
});
