// The roster picture's model (src/web/roster/rosterImageView.js): the roster page's detail
// view turned into what services/roster/rosterImage.js draws.
jest.mock("../../../src/services/discord/discord", () => ({
    listHumanMembers: jest.fn(async () => ({ members: [], error: null })),
    listRoles: jest.fn(() => []),
    memberRoleIds: jest.fn(async () => []),
}));
jest.mock("../../../src/services/categories/categoryNames", () => ({
    listKnownCategories: jest.fn(() => [{ id: "cat1", name: "Raid Mo / Do" }]),
}));
jest.mock("../../../src/services/events/eventSources", () => ({ listStoredEvents: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/logStore", () => ({ listLogs: jest.fn(() => []) }));
jest.mock("../../../src/stores/loot/reportStore", () => ({ listReports: jest.fn(() => []), getReport: jest.fn(() => null) }));

const rosterStore = require("../../../src/stores/roster/rosterStore");
const profiles = require("../../../src/stores/roster/raiderProfileStore");
const characterStore = require("../../../src/stores/roster/characterStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { modelFromDetail, rosterImageModel, rosterPicture } = require("../../../src/web/roster/rosterImageView");

const G = "g1";
const ANNA = "200000000000000001";
const BERT = "200000000000000002";
const ADMIN = { id: "1", name: "Admin", isAdmin: true };
const READER = { id: "9", name: "Leser", isAdmin: false };
const MANAGER = { id: "200000000000000077", name: "Orga", isAdmin: false, access: { roster: { read: true, write: true } } };
const CONFIG = { categoryIds: ["cat1"] };
const NOW = Date.UTC(2026, 9, 30, 12);

describe("web/roster/rosterImageView modelFromDetail", () => {
    const view = {
        roster: { name: "Kern", versionId: "tbc", versionLabel: "TBC", slots: { total: 10, tank: 2, healer: 3 } },
        members: [
            {
                userId: "u1", displayName: "Anna", status: "trial", trialUntil: "2026-11-14", role: "tank",
                chars: [
                    { name: "Thorgrim", className: "Warrior", classColor: "#C79C6E", spec: "Warrior-Protection" },
                    { name: "Alt", className: "Mage", classColor: "#69CCF0", spec: "Mage-Fire" },
                    { name: "Old", className: "Rogue", classColor: "#FFF569", spec: "Combat" },
                ],
            },
            { userId: "u2", displayName: "Bert", status: "core", trialUntil: null, role: "", chars: [] },
            { userId: "u3", displayName: "", status: "core", role: "dps" },
        ],
    };

    it("takes the first char as the row and the others as extra chars", () => {
        const m = modelFromDetail(view, { now: NOW });
        expect(m).toMatchObject({ name: "Kern", versionLabel: "TBC", stand: NOW, slots: { total: 10, tank: 2, healer: 3 } });
        expect(m.members[0]).toEqual({
            // no trial date even when the view had one - the picture is the readers' view
            name: "Thorgrim", status: "trial", classId: "Warrior", color: "#C79C6E",
            spec: "Warrior-Protection", specRole: "tank", role: "tank",
            extraChars: [
                { classId: "Mage", color: "#69CCF0", spec: "Mage-Fire" },
                // a log's spec name the rule set does not know falls back to the class
                { classId: "Rogue", color: "#FFF569", spec: "" },
            ],
        });
    });

    it("keeps a person without chars under their Discord name, else their id", () => {
        const m = modelFromDetail(view, { now: NOW });
        expect(m.members[1]).toMatchObject({ name: "Bert", classId: "", spec: "", specRole: "", extraChars: [] });
        expect(m.members[2]).toMatchObject({ name: "u3", role: "dps" });
    });

    it("copes with an empty view", () => {
        expect(modelFromDetail(null, { now: NOW })).toEqual({ name: "", versionLabel: "", stand: NOW, slots: {}, members: [] });
    });
});

describe("web/roster/rosterImageView rosterImageModel / rosterPicture", () => {
    let count = 0;
    let rosterId;
    beforeEach(() => {
        count += 1;
        rosterStore.useFile(tempStoreFile(`img-rosters-${count}.json`));
        profiles.useFile(tempStoreFile(`img-profiles-${count}.json`));
        characterStore.useFile(tempStoreFile(`img-characters-${count}.json`));
        profiles.addCharacter(ANNA, { name: "Thorgrim", className: "Warrior", specs: [{ key: "Warrior-Protection", gear: "ready" }] }, { name: "Anna" });
        profiles.addCharacter(BERT, { name: "Lunaria", className: "Paladin", specs: [{ key: "Paladin-Holy", gear: "ready" }] }, { name: "Bert" });
        const r = rosterStore.createRoster({ guildId: G, name: "Raid Mo / Do", categoryId: "cat1", slots: { total: 25, tank: 3, healer: 7 }, managers: { userIds: [MANAGER.id], roleIds: [] } });
        rosterId = r.id;
        rosterStore.upsertMember(r.id, ANNA, { chars: ["Thorgrim"] });
        rosterStore.upsertMember(r.id, BERT, { chars: ["Lunaria"], status: "trial", trialUntil: "2026-11-14" });
    });
    afterAll(() => {
        rosterStore.useFile(null);
        profiles.useFile(null);
        characterStore.useFile(null);
    });

    it("builds the model from the roster page's view, with the category's language", async () => {
        const built = await rosterImageModel({ guildId: G, id: rosterId, config: CONFIG, now: NOW });
        expect(built.lang).toBe("de");
        expect(built.roster.name).toBe("Raid Mo / Do");
        expect(built.model.slots).toMatchObject({ total: 25, tank: 3, healer: 7 });
        const thorgrim = built.model.members.find((x) => x.name === "Thorgrim");
        expect(thorgrim).toMatchObject({ classId: "Warrior", spec: "Warrior-Protection", specRole: "tank" });
        expect(built.model.members.find((x) => x.name === "Lunaria")).toMatchObject({ status: "trial" });
        expect(built.model.members.find((x) => x.name === "Lunaria").trialUntil).toBeUndefined();
    });

    it("draws the readers' view for the roster's orga too: no trial date in the picture", async () => {
        for (const user of [MANAGER, ADMIN, READER]) {
            const { svg } = await rosterPicture({ guildId: G, id: rosterId, user, config: CONFIG, now: NOW });
            expect(svg).toContain(">PROBE<");
            expect(svg).toContain(">Lunaria<");
            expect(svg).not.toContain("14.11.");
            expect(svg).not.toContain(">bis ");
        }
    });

    it("is null for an unknown roster or one of another server", async () => {
        expect(await rosterImageModel({ guildId: G, id: "nope", user: ADMIN, config: CONFIG })).toBeNull();
        expect(await rosterImageModel({ guildId: "g2", id: rosterId, user: ADMIN, config: CONFIG })).toBeNull();
        expect(await rosterPicture({ guildId: "g2", id: rosterId, user: ADMIN, config: CONFIG })).toBeNull();
    });

    it("draws the roster as SVG and PNG, the switches passed on", async () => {
        const off = await rosterPicture({ guildId: G, id: rosterId, user: ADMIN, config: CONFIG, now: NOW });
        expect(off.png.subarray(1, 4).toString()).toBe("PNG");
        expect(off.svg).toContain(">Thorgrim<");
        expect(off.svg).toContain(">Lunaria<");
        expect(off.lang).toBe("de");
        rosterStore.upsertMember(rosterId, "200000000000000003", { status: "bench" });
        const on = await rosterPicture({ guildId: G, id: rosterId, user: ADMIN, config: CONFIG, showReserve: true });
        expect(on.svg).toContain("ERSATZ (1)");
    });
});
