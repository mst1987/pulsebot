// PuG raids on the web only for members of the PuG server (#907,
// src/services/signups/pugMembership.js): open categories ask the raid's server,
// unreadable membership passes, the orga and an existing signup are exempt.
const mockSignups = new Map();
jest.mock("../../../src/stores/signupStore", () => ({
    getSignup: (eventId, userId) => mockSignups.get(`${eventId}/${userId}`) || null,
}));
let mockConfig = {};
jest.mock("../../../src/stores/settingsStore", () => ({ getConfig: () => mockConfig }));
let mockMembership = null;
jest.mock("../../../src/services/discord/discord", () => ({ guildMembership: jest.fn(async () => mockMembership) }));

const discord = require("../../../src/services/discord/discord");
const { checkPugMember, pugInviteUrl, serverOf, PUG_MEMBERS_ERROR } = require("../../../src/services/signups/pugMembership");

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
