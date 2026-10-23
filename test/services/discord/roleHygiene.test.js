// Role hygiene counts of one server (src/services/discord/roleHygiene.js): empty
// only with a complete member cache, above the bot, sensitive rights; @everyone
// and integration roles left out.
const { PermissionsBitField } = require("discord.js");

let mockOnline = true;
let mockGuild = null;
jest.mock("../../../src/services/discord/discord", () => ({
    isOnline: () => mockOnline,
    getGuild: () => mockGuild,
}));

const { roleHygiene } = require("../../../src/services/discord/roleHygiene");

const G = "900000000000000001";
const F = PermissionsBitField.Flags;
const role = (id, position, flags = [], extra = {}) => ({ id, name: id, position, permissions: new PermissionsBitField(flags), ...extra });

function guild({ memberCount = 2, cached = 2 } = {}) {
    const members = new Map();
    for (let i = 0; i < cached; i += 1) members.set(`m${i}`, { roles: { cache: new Set(i === 0 ? ["r1"] : []) } });
    const roles = [
        role(G, 0, [F.MentionEveryone]),
        role("r1", 1),
        role("r2", 2, [F.KickMembers]),
        role("r3", 8, [F.Administrator]),
        role("bot", 5, [F.ManageRoles], { managed: true }),
    ];
    return {
        memberCount,
        members: { cache: members, me: { roles: { highest: { position: 5 } } } },
        roles: { cache: new Map(roles.map((r) => [r.id, r])) },
    };
}

beforeEach(() => {
    mockOnline = true;
    mockGuild = guild();
});

describe("roleHygiene", () => {
    it("counts empty, above the bot and sensitive roles", () => {
        expect(roleHygiene(G)).toEqual({ known: true, total: 3, empty: 2, aboveBot: 1, sensitive: 2 });
    });

    it("leaves empty unknown while the member cache is incomplete", () => {
        mockGuild = guild({ memberCount: 50, cached: 2 });
        expect(roleHygiene(G).empty).toBeNull();
    });

    it("knows nothing while the bot is offline or not on the server", () => {
        mockOnline = false;
        expect(roleHygiene(G)).toEqual({ known: false, total: null, empty: null, aboveBot: null, sensitive: null });
        mockOnline = true;
        mockGuild = null;
        expect(roleHygiene(G).known).toBe(false);
        expect(roleHygiene("").known).toBe(false);
    });
});
