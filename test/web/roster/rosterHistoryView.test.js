// web/roster/rosterHistoryView (#655): a roster's history newest first, paged,
// filtered to one person, with the names of actor and subject.
jest.mock("../../../src/services/discord/discord", () => ({
    listHumanMembers: jest.fn(async () => ({ error: null, members: [{ id: "100001", displayName: "Anna" }, { id: "1", displayName: "Marc" }] })),
}));

const discord = require("../../../src/services/discord/discord");
const profiles = require("../../../src/stores/raiderProfileStore");
const { tempStoreFile } = require("../../helpers/tempStore");
const { buildRosterHistory, MAX_LIMIT } = require("../../../src/web/roster/rosterHistoryView");

const line = (n, over = {}) => ({ at: `2026-10-0${n}T10:00:00.000Z`, by: "1", userId: "100001", what: "member", detail: `status core → bench ${n}`, ...over });
const ROSTER = {
    guildId: "g1",
    history: [
        line(1, { what: "created", userId: "", detail: "Raid" }),
        line(2, { what: "member-added", detail: "core, devi" }),
        line(3, { userId: "100002", by: "" }),
        line(4, { what: "role-give-failed", detail: "@Raider: no_permission" }),
    ],
};

beforeAll(() => profiles.useFile(tempStoreFile("profiles.json")));
afterAll(() => profiles.useFile(null));
beforeEach(() => {
    profiles.reset();
    profiles.addCharacter("100002", { name: "Brakk", className: "Hunter", specs: [] }, { name: "Bert" });
});

describe("web/roster/rosterHistoryView", () => {
    it("answers every line newest first with the names of actor and subject", async () => {
        const view = await buildRosterHistory(ROSTER);
        expect(view.total).toBe(4);
        expect(view.entries.map((e) => e.what)).toEqual(["role-give-failed", "member", "member-added", "created"]);
        expect(view.entries[0]).toEqual({ at: "2026-10-04T10:00:00.000Z", by: "1", byName: "Marc", userId: "100001", userName: "Anna", what: "role-give-failed", detail: "@Raider: no_permission" });
        // the profile's name when Discord does not know the person; nobody for an empty actor
        expect(view.entries[1]).toEqual(expect.objectContaining({ userName: "Bert", by: "", byName: "" }));
        expect(view.entries[3].userName).toBe("");
    });

    it("pages and filters to one person", async () => {
        const page = await buildRosterHistory(ROSTER, { offset: "1", limit: "2" });
        expect(page.entries.map((e) => e.what)).toEqual(["member", "member-added"]);
        expect([page.offset, page.limit, page.total]).toEqual([1, 2, 4]);
        const anna = await buildRosterHistory(ROSTER, { userId: "100001" });
        expect(anna.entries.map((e) => e.what)).toEqual(["role-give-failed", "member-added"]);
        expect(anna.total).toBe(2);
        expect((await buildRosterHistory(ROSTER, { limit: 9999 })).limit).toBe(MAX_LIMIT);
        expect((await buildRosterHistory(ROSTER, { limit: "abc", offset: -5 })).offset).toBe(0);
    });

    it("falls back to the ids when the member list is not available", async () => {
        discord.listHumanMembers.mockRejectedValueOnce(new Error("offline"));
        const view = await buildRosterHistory(ROSTER);
        expect(view.entries[0]).toEqual(expect.objectContaining({ byName: "1", userName: "100001" }));
        expect((await buildRosterHistory({ guildId: "", history: [] })).entries).toEqual([]);
    });
});
