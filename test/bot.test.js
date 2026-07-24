// bot.js boots the web server independently of the Discord gateway, and a failed
// login must never crash the process. We mock the gateway + web server and drive
// the exported start() directly (require alone must not boot anything).

const mockStartWebServer = jest.fn();
const mockLogin = jest.fn(() => Promise.resolve("ok"));

jest.mock("../src/web/server", () => ({ startWebServer: mockStartWebServer }));
jest.mock("../src/web/logChannel", () => ({ handleLogMessage: jest.fn() }));
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("discord.js", () => {
    // Keep the real exports (ChannelType, builders, Collection, …) so the real
    // command modules load; only replace Client so no gateway connection is made.
    const actual = jest.requireActual("discord.js");
    class Client {
        constructor() { this.commands = null; this._h = {}; this.login = mockLogin; }
        on(evt, cb) { this._h[evt] = cb; }
    }
    return { ...actual, Client };
});

const bot = require("../src/bot");

const OLD_TOKEN = process.env.DISCORDJS_BOT_TOKEN;

beforeEach(() => {
    jest.clearAllMocks();
    mockLogin.mockResolvedValue("ok");
    process.env.DISCORDJS_BOT_TOKEN = "tok";
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    console.warn.mockRestore();
    console.error.mockRestore();
    if (OLD_TOKEN === undefined) delete process.env.DISCORDJS_BOT_TOKEN;
    else process.env.DISCORDJS_BOT_TOKEN = OLD_TOKEN;
});

describe("bot start()", () => {
    it("does not auto-boot on require (start is explicit)", () => {
        // require ran above without a token check firing; nothing was booted yet
        // beyond module load — startWebServer is only called via start().
        expect(typeof bot.start).toBe("function");
        expect(mockStartWebServer).not.toHaveBeenCalled();
    });

    it("loads commands and starts the web server, then logs in when a token is set", async () => {
        bot.start();
        // web server + commands come up synchronously, before any login attempt
        expect(mockStartWebServer).toHaveBeenCalledWith(bot.client);
        expect(bot.client.commands.size).toBeGreaterThan(0);
        // login is deferred a microtask (so a synchronous token throw becomes a
        // catchable rejection); let it run before asserting
        await new Promise((r) => setImmediate(r));
        expect(mockLogin).toHaveBeenCalledWith("tok");
    });

    it("keeps the web server up when the Discord login fails (non-fatal)", async () => {
        mockLogin.mockRejectedValue(new Error("TokenInvalid"));
        expect(() => bot.start()).not.toThrow();
        expect(mockStartWebServer).toHaveBeenCalledWith(bot.client);
        // let the caught rejection settle so it doesn't surface as unhandled
        await new Promise((r) => setImmediate(r));
        expect(console.error).toHaveBeenCalled();
    });

    it("starts the web server but skips login when no token is set", () => {
        delete process.env.DISCORDJS_BOT_TOKEN;
        bot.start();
        expect(mockStartWebServer).toHaveBeenCalledWith(bot.client);
        expect(mockLogin).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalled();
    });
});
