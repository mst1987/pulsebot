// web/roster/activeRoster: the roster a request may touch - only one of the
// active server (an empty side on either end is no filter).
jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "g1") }));

const rosterStore = require("../../../src/stores/rosterStore");
const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { activeRoster, inGuild } = require("../../../src/web/roster/activeRoster");
const { tempStoreFile } = require("../../helpers/tempStore");

let roster;
beforeAll(() => rosterStore.useFile(tempStoreFile("rosters.json")));
afterAll(() => rosterStore.useFile(null));
beforeEach(() => {
    for (const r of rosterStore.listRosters("")) rosterStore.deleteRoster(r.id);
    roster = rosterStore.createRoster({ name: "Raid", guildId: "g1" });
    activeGuildFor.mockReturnValue("g1");
});

describe("web/roster/activeRoster", () => {
    it("answers the roster of the active server", () => {
        expect(activeRoster({}, roster.id)).toEqual(expect.objectContaining({ id: roster.id }));
        expect(activeRoster({}, ` ${roster.id} `)).toEqual(expect.objectContaining({ id: roster.id }));
    });

    it("answers null for another server's roster and for an unknown id", () => {
        activeGuildFor.mockReturnValue("g2");
        expect(activeRoster({}, roster.id)).toBeNull();
        activeGuildFor.mockReturnValue("g1");
        expect(activeRoster({}, "nope")).toBeNull();
        expect(activeRoster({}, undefined)).toBeNull();
    });

    it("does not filter without an active server or without the roster's server", () => {
        activeGuildFor.mockReturnValue("");
        expect(activeRoster({}, roster.id)).not.toBeNull();
        expect(inGuild({ guildId: "" }, "g2")).toBe(true);
        expect(inGuild({ guildId: "g1" }, "g2")).toBe(false);
    });
});
