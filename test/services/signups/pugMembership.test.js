// PuG raids on the web only for members of the PuG server (#907,
// src/services/signups/pugMembership.js): open categories ask the raid's server,
// unreadable membership passes, the orga and an existing signup are exempt.
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => ({
    getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
}));
const mockEvents = new Map();
jest.mock("../../../src/stores/eventStore", () => ({ getEvent: (id) => mockEvents.get(id) || null }));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockMembership = null;
jest.mock("../../../src/services/discord/discord", () => ({ guildMembership: jest.fn(async () => mockMembership) }));

const discord = require("../../../src/services/discord/discord");
const { checkPugMember, markMembersOnly, membershipByServer, isOpenRaid, pugInviteUrl, safeInviteUrl, holdsSignup, serverOf, PUG_MEMBERS_ERROR } = require("../../../src/services/signups/pugMembership");

const ANNA = "200000000000000001";
const event = { id: "eh-pug", guildId: "g-pug", categoryId: "cat-pug", versionId: "tbc" };
const refused = { code: "pug_members_only", error: PUG_MEMBERS_ERROR, inviteUrl: "" };

beforeEach(() => {
    mockSignups.clear();
    mockConfig = {};
    mockMembership = null;
    discord.guildMembership.mockClear();
});

describe("checkPugMember", () => {
    it("refuses a non-member of the raid's server and asks that server", async () => {
        mockMembership = false;
        expect(await checkPugMember(event, ANNA)).toEqual(refused);
        expect(discord.guildMembership).toHaveBeenCalledWith("g-pug", ANNA);
    });

    it("lets members and an unreadable membership pass", async () => {
        mockMembership = true;
        expect(await checkPugMember(event, ANNA)).toEqual({ ok: true });
        mockMembership = null;
        expect(await checkPugMember(event, ANNA)).toEqual({ ok: true });
    });

    it("leaves guild raids, the orga and an existing signup alone", async () => {
        mockMembership = false;
        mockConfig = { categoryRoles: { "cat-pug": ["role-raider"] } };
        expect(await checkPugMember(event, ANNA)).toEqual({ ok: true });
        mockConfig = {};
        expect(await checkPugMember(event, ANNA, { byOrga: true })).toEqual({ ok: true });
        mockSignups.set(`eh-pug/${ANNA}`, { status: "signed" });
        expect(await checkPugMember(event, ANNA)).toEqual({ ok: true });
        expect(await checkPugMember(null, ANNA)).toEqual({ ok: true });
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });

    it("takes a known membership without asking Discord (the bulk route asks once per server)", async () => {
        expect(await checkPugMember(event, ANNA, { membership: false, previous: null })).toEqual(refused);
        expect(await checkPugMember(event, ANNA, { membership: true, previous: null })).toEqual({ ok: true });
        expect(discord.guildMembership).not.toHaveBeenCalled();
    });

    it("a stored absence (\"Abgemeldet\") is no signup that exempts", async () => {
        mockMembership = false;
        mockSignups.set(`eh-pug/${ANNA}`, { status: "absence" });
        expect(await checkPugMember(event, ANNA)).toEqual(refused);
        expect(await checkPugMember(event, ANNA, { previous: { status: "absence" }, membership: false })).toEqual(refused);
        expect(holdsSignup({ status: "absence" })).toBe(false);
        expect(holdsSignup({ status: "tentative" })).toBe(true);
        expect(holdsSignup(null)).toBe(false);
    });
});

describe("markMembersOnly (GET /api/signups)", () => {
    const row = (over = {}) => ({ id: "eh-pug", source: "eventhelper", openToAll: true, started: false, cancelled: false, mine: null, ...over });
    beforeEach(() => {
        mockEvents.clear();
        mockEvents.set("eh-pug", event);
        mockEvents.set("eh-pug2", { ...event, id: "eh-pug2" });
        mockEvents.set("eh-other", { ...event, id: "eh-other", guildId: "g-other" });
    });

    it("marks open raids of a non-member with the invite link, one lookup per server", async () => {
        mockMembership = false;
        const out = await markMembersOnly([row(), row({ id: "eh-pug2" }), row({ id: "eh-other" })], ANNA);
        expect(out.map((r) => [r.id, r.membersOnly, r.inviteUrl])).toEqual([
            ["eh-pug", true, ""], ["eh-pug2", true, ""], ["eh-other", true, ""],
        ]);
        expect(discord.guildMembership).toHaveBeenCalledTimes(2);
    });

    it("leaves members alone, says when Discord could not tell", async () => {
        mockMembership = true;
        expect((await markMembersOnly([row()], ANNA))[0]).toEqual(row());
        mockMembership = null;
        expect((await markMembersOnly([row()], ANNA))[0]).toMatchObject({ membershipUnknown: true });
        expect((await markMembersOnly([row()], ANNA))[0].membersOnly).toBeUndefined();
    });

    it("skips guild raids, Raid-Helper, started/cancelled raids, own signups and the orga - an absence does not exempt", async () => {
        mockMembership = false;
        const rows = [
            row({ openToAll: false }), row({ source: "raidhelper" }), row({ started: true }), row({ cancelled: true }),
            row({ mine: { status: "tentative" } }), row({ id: "eh-unknown" }),
        ];
        expect(await markMembersOnly(rows, ANNA)).toEqual(rows);
        expect(await markMembersOnly([row()], ANNA, { isOrga: async (ev) => ev.id === "eh-pug" })).toEqual([row()]);
        expect(discord.guildMembership).not.toHaveBeenCalled();
        expect((await markMembersOnly([row({ mine: { status: "absence" } })], ANNA))[0].membersOnly).toBe(true);
    });

    // a hanging Discord costs one time limit (5 s), not one per server
    it("asks all servers at once, so a slow Discord costs one time limit", async () => {
        jest.useFakeTimers();
        try {
            discord.guildMembership.mockImplementation((guildId) => new Promise((resolve) => setTimeout(() => resolve(guildId !== "g-pug"), 5000)));
            let out = null;
            markMembersOnly([row(), row({ id: "eh-pug2" }), row({ id: "eh-other" })], ANNA).then((rows) => { out = rows; });
            await jest.advanceTimersByTimeAsync(5000);
            expect(out.map((r) => [r.id, Boolean(r.membersOnly)])).toEqual([["eh-pug", true], ["eh-pug2", true], ["eh-other", false]]);
            expect(discord.guildMembership.mock.calls).toEqual([["g-pug", ANNA], ["g-other", ANNA]]);
        } finally {
            jest.useRealTimers();
            discord.guildMembership.mockImplementation(async () => mockMembership);
        }
    });
});

describe("membershipByServer", () => {
    it("one lookup per distinct server, all started before any answers", async () => {
        jest.useFakeTimers();
        try {
            discord.guildMembership.mockImplementation((guildId) => new Promise((resolve) => setTimeout(() => resolve(guildId === "g-pug" ? false : null), 5000)));
            const pending = membershipByServer([event, { ...event, id: "eh-pug2" }, { ...event, id: "eh-other", guildId: "g-other" }], ANNA, { config: {} });
            expect(discord.guildMembership).toHaveBeenCalledTimes(2);
            let members = null;
            pending.then((m) => { members = m; });
            await jest.advanceTimersByTimeAsync(4999);
            expect(members).toBeNull();
            await jest.advanceTimersByTimeAsync(1);
            expect([...members]).toEqual([["g-pug", false], ["g-other", null]]);
        } finally {
            jest.useRealTimers();
            discord.guildMembership.mockImplementation(async () => mockMembership);
        }
    });

    it("an empty list asks nobody; isOpenRaid follows the category rule", async () => {
        expect((await membershipByServer([], ANNA)).size).toBe(0);
        expect(discord.guildMembership).not.toHaveBeenCalled();
        expect(isOpenRaid(event, {})).toBe(true);
        expect(isOpenRaid(event, { categoryRoles: { "cat-pug": ["role-raider"] } })).toBe(false);
    });
});

describe("safeInviteUrl", () => {
    it("passes only an https link", () => {
        expect(safeInviteUrl(" https://discord.gg/abc ")).toBe("https://discord.gg/abc");
        expect(safeInviteUrl("http://discord.gg/abc")).toBe("");
        expect(safeInviteUrl("javascript:alert(1)")).toBe("");
        expect(safeInviteUrl("https://")).toBe("");
        expect(safeInviteUrl(null)).toBe("");
    });
});

describe("serverOf / pugInviteUrl", () => {
    it("the raid's own server, else the configured one; no invite link yet", () => {
        expect(serverOf(event, { guildId: "g-main" })).toBe("g-pug");
        expect(serverOf({ id: "x" }, { guildId: "g-main" })).toBe("g-main");
        expect(serverOf(null, null)).toBe("");
        expect(pugInviteUrl(event, { config: {} })).toBe("");
        expect(pugInviteUrl({ id: "x" }, { config: {} })).toBe("");
    });
});
