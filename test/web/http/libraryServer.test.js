const { mockRes, json } = require("../../helpers/http");

jest.mock("../../../src/web/http/activeGuild", () => ({ activeGuildFor: jest.fn(() => "") }));
jest.mock("../../../src/stores/settings/configStore", () => ({ getConfig: jest.fn(() => ({})) }));
jest.mock("../../../src/services/discord/roles/guildRoles", () => ({ resolveServer: jest.fn(({ guildId }) => guildId) }));
jest.mock("../../../src/services/discord/servers/serverOf", () => ({ firstServerId: jest.fn(() => "") }));

const { activeGuildFor } = require("../../../src/web/http/activeGuild");
const { resolveServer } = require("../../../src/services/discord/roles/guildRoles");
const { firstServerId } = require("../../../src/services/discord/servers/serverOf");
const { knownServer, libraryReadServer, libraryWriteServer } = require("../../../src/web/http/libraryServer");

const A = "111111111111111111";
const B = "222222222222222222";
const admin = { id: "1", isAdmin: true };
const orga = { id: "2", isAdmin: false };
const status = (res) => res.writeHead.mock.calls[0][0];

beforeEach(() => {
    activeGuildFor.mockReturnValue("");
    firstServerId.mockReturnValue("");
    resolveServer.mockImplementation(({ guildId }) => guildId);
});

describe("web/http/libraryServer", () => {
    it("knownServer: only a server of the list", () => {
        expect(knownServer(A)).toBe(true);
        resolveServer.mockReturnValue("other");
        expect(knownServer(A)).toBe(false);
        expect(knownServer("")).toBe(false);
        expect(knownServer(null)).toBe(false);
    });

    describe("libraryReadServer", () => {
        it("without a wish: the active server", () => {
            activeGuildFor.mockReturnValue(A);
            expect(libraryReadServer(mockRes(), orga, {}, "")).toBe(A);
            expect(libraryReadServer(mockRes(), admin, {}, null)).toBe(A);
        });

        it("nobody active: a full admin reads the first server, everybody else gets 400", () => {
            firstServerId.mockReturnValue(B);
            expect(libraryReadServer(mockRes(), admin, {}, "")).toBe(B);
            const res = mockRes();
            expect(libraryReadServer(res, orga, {}, "")).toBeNull();
            expect(status(res)).toBe(400);
            expect(json(res).error.code).toBe("no_active_server");
        });

        it("a full admin without any server gets 400 as well", () => {
            const res = mockRes();
            expect(libraryReadServer(res, admin, {}, "")).toBeNull();
            expect(status(res)).toBe(400);
        });

        it("another server: only a full admin, and only a known one", () => {
            activeGuildFor.mockReturnValue(A);
            expect(libraryReadServer(mockRes(), admin, {}, B)).toBe(B);
            expect(libraryReadServer(mockRes(), orga, {}, A)).toBe(A);

            const refused = mockRes();
            expect(libraryReadServer(refused, orga, {}, B)).toBeNull();
            expect(status(refused)).toBe(404);

            resolveServer.mockReturnValue(A);
            const unknown = mockRes();
            expect(libraryReadServer(unknown, admin, {}, B)).toBeNull();
            expect(status(unknown)).toBe(404);
        });
    });

    describe("libraryWriteServer", () => {
        it("goes to the server the tab loaded while it is the active one", () => {
            activeGuildFor.mockReturnValue(A);
            expect(libraryWriteServer(mockRes(), orga, {}, A)).toBe(A);
        });

        it("a tab of another server is refused for an orga member, not written into the active one", () => {
            activeGuildFor.mockReturnValue(B);
            const res = mockRes();
            expect(libraryWriteServer(res, orga, {}, A)).toBeNull();
            expect(status(res)).toBe(409);
            expect(json(res).error.code).toBe("server_switched");
        });

        it("a write naming no server is refused as well, it never falls back to the active one", () => {
            activeGuildFor.mockReturnValue(A);
            const res = mockRes();
            expect(libraryWriteServer(res, orga, {}, "")).toBeNull();
            expect(status(res)).toBe(409);
        });

        it("no server at all answers 400", () => {
            for (const user of [orga, admin]) {
                const res = mockRes();
                expect(libraryWriteServer(res, user, {}, "")).toBeNull();
                expect(status(res)).toBe(400);
            }
        });

        it("a full admin writes to the tab's server if the server is known", () => {
            activeGuildFor.mockReturnValue(B);
            expect(libraryWriteServer(mockRes(), admin, {}, A)).toBe(A);
            resolveServer.mockReturnValue(B);
            const res = mockRes();
            expect(libraryWriteServer(res, admin, {}, A)).toBeNull();
            expect(status(res)).toBe(404);
        });
    });
});
