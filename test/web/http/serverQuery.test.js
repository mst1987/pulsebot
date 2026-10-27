// The server of a Discord page's request (#895): guildId of the list, the first
// server by default, an old side=talk, and 400 unknown_guild for anything else.
jest.mock("../../../src/stores/configStore", () => ({
    getConfig: () => ({ discordServers: { servers: [{ guildId: "900000000000000001" }, { guildId: "900000000000000002" }], talkGuildId: "900000000000000002", links: [] } }),
}));

const { serverFromQuery } = require("../../../src/web/http/serverQuery");
const { mockRes, status, json } = require("../../helpers/http");

const ask = (params) => {
    const res = mockRes();
    return { res, out: serverFromQuery(new URLSearchParams(params), res) };
};

describe("web/http/serverQuery", () => {
    it("takes the server of the list or the first one", () => {
        expect(ask({ guildId: "900000000000000002" }).out).toBe("900000000000000002");
        expect(ask({}).out).toBe("900000000000000001");
        expect(ask({ side: "talk" }).out).toBe("900000000000000002");
    });

    it("answers 400 unknown_guild for a server outside the list", () => {
        const { res, out } = ask({ guildId: "900000000000000099" });
        expect(out).toBeNull();
        expect(status(res)).toBe(400);
        expect(json(res).error.code).toBe("unknown_guild");
    });

    it("hands an empty id on when no server is configured", () => {
        const res = mockRes();
        expect(serverFromQuery(new URLSearchParams(), res, { discordServers: { servers: [], links: [] } })).toBe("");
    });
});
