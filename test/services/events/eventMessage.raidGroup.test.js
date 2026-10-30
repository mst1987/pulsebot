// The messages of a raid group (#811): the first raid's signup message counts
// the group ("2 raids · 20 places"), a further raid has no message of its own
// (a redraw asked for it redraws the first raid's), and every raid's setup
// message and DM say "Raid 2 of 2".
const mockEvents = new Map();
jest.mock("../../../src/stores/events/eventStore", () => ({
    getEvent: (id) => mockEvents.get(id) || null,
    setEventMessage: jest.fn(),
    listEvents: (guildId, opts = {}) => [...mockEvents.values()].filter((e) => opts.siblings === true || !(e.raidGroupId && e.raidGroupId !== e.id)),
    isOwnEventId: (id) => String(id).startsWith("eh-"),
}));
jest.mock("../../../src/stores/events/signupStore", () => ({ listSignups: jest.fn(() => []), onSignupsChanged: jest.fn() }));
jest.mock("../../../src/services/discord/discord", () => require("../../helpers/discordMock").withClientHelpers({ getClient: jest.fn() }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const { _internal: { buildEventMessage } } = require("../../../src/services/events/eventMessage");
const { buildSetupMessage, buildSetupDm } = require("../../../src/services/setup/setupMessage");
const { groupSummary } = require("../../../src/services/events/raidGroup");
const { ownEvent } = require("../../factories/events");

const primary = ownEvent({ id: "eh-za", title: "Zul'Aman", guildId: "g1", raidGroupId: "eh-za", raidGroupIndex: 1 });
const sibling = ownEvent({ id: "eh-za2", title: "Zul'Aman 2", guildId: "g1", raidGroupId: "eh-za", raidGroupIndex: 2 });

beforeEach(() => {
    mockEvents.clear();
    mockEvents.set(primary.id, primary);
    mockEvents.set(sibling.id, sibling);
});

const text = (msg) => JSON.stringify(msg.embeds[0]);

describe("the signup message of a raid group", () => {
    it("counts the raids and every place of the group in its head", () => {
        const group = groupSummary(primary);
        expect(group).toMatchObject({ count: 2, places: 20 });
        expect(text(buildEventMessage(primary, [], { lang: "en", raidGroup: group }))).toContain("**2 raids** · 20 places");
        expect(text(buildEventMessage(primary, [], { lang: "de", raidGroup: group }))).toContain("**2 Raids** · 20 Plätze");
    });

    it("says nothing of a group outside one", () => {
        expect(text(buildEventMessage(ownEvent(), [], { lang: "en" }))).not.toMatch(/raids\*\* ·/);
    });
});

describe("the setup message and DM of a raid of a group", () => {
    const approved = { version: 1, approvedAt: 1, groups: [{ index: 1, slots: [{ userId: "u1", character: "Alpha", spec: "Mage-Fire", role: "ranged" }] }], bench: [] };

    it("names the raid: \"Raid 2 of 2\"", () => {
        expect(buildSetupMessage(sibling, approved, { lang: "en", raidOf: { index: 2, count: 2 } }).embeds[0].description).toContain("**Raid 2 of 2**");
        expect(buildSetupMessage(sibling, approved, { lang: "de", raidOf: { index: 2, count: 2 } }).embeds[0].description).toContain("**Raid 2 von 2**");
        expect(buildSetupMessage(sibling, approved, { lang: "en" }).embeds[0].description || "").not.toContain("Raid 2 of 2");
    });

    it("says it in the DM's kicker too", () => {
        const dm = JSON.stringify(buildSetupDm(sibling, { userId: "u1", character: "Alpha", spec: "Mage-Fire", role: "ranged", group: 1 }, { lang: "en", raidOf: { index: 2, count: 2 } }));
        expect(dm).toContain("Raid 2 of 2");
    });
});
