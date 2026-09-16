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
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    console.log.mockRestore();
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

    it("logs the Node version it actually runs on", () => {
        // PM2 spawns the app with its daemon's Node, so the startup log is the
        // only trustworthy record of the runtime version after an upgrade.
        bot.start();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`Node ${process.version}`));
    });

    it("starts the web server but skips login when no token is set", () => {
        delete process.env.DISCORDJS_BOT_TOKEN;
        bot.start();
        expect(mockStartWebServer).toHaveBeenCalledWith(bot.client);
        expect(mockLogin).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalled();
    });
});

// The interaction router (#251): autocomplete and every select menu kind reach
// the command, looked up by commandName or by the customId before ":".
describe("bot interaction router", () => {
    function fakeInteraction(kind, extra = {}) {
        const guards = [
            "isAutocomplete", "isCommand", "isButton", "isStringSelectMenu", "isUserSelectMenu",
            "isRoleSelectMenu", "isChannelSelectMenu", "isMentionableSelectMenu", "isModalSubmit",
        ];
        const i = {
            replied: false, deferred: false, responded: false,
            reply: jest.fn(async () => {}), respond: jest.fn(async () => {}), followUp: jest.fn(async () => {}),
            ...extra,
        };
        for (const g of guards) i[g] = () => g === kind;
        return i;
    }

    beforeEach(() => {
        bot.client.commands = new (require("discord.js").Collection)();
    });

    it("hands autocomplete to the command's autocomplete()", async () => {
        const cmd = { name: "raid", execute: jest.fn(), autocomplete: jest.fn(async () => {}) };
        bot.client.commands.set("raid", cmd);
        const i = fakeInteraction("isAutocomplete", { commandName: "raid" });
        await bot.handleInteraction(i);
        expect(cmd.autocomplete).toHaveBeenCalledWith(i);
        expect(cmd.execute).not.toHaveBeenCalled();
        expect(i.reply).not.toHaveBeenCalled();
    });

    it("answers autocomplete with an empty list when the command has none or throws", async () => {
        bot.client.commands.set("plain", { name: "plain", execute: jest.fn() });
        const i = fakeInteraction("isAutocomplete", { commandName: "plain" });
        await bot.handleInteraction(i);
        expect(i.respond).toHaveBeenCalledWith([]);
        expect(i.reply).not.toHaveBeenCalled();

        bot.client.commands.set("boom", { name: "boom", execute: jest.fn(), autocomplete: jest.fn(async () => { throw new Error("x"); }) });
        const j = fakeInteraction("isAutocomplete", { commandName: "boom" });
        await bot.handleInteraction(j);
        expect(j.respond).toHaveBeenCalledWith([]);

        const k = fakeInteraction("isAutocomplete", { commandName: "unknown" });
        await bot.handleInteraction(k);
        expect(k.respond).toHaveBeenCalledWith([]);
        expect(k.reply).not.toHaveBeenCalled();
    });

    it.each(["isUserSelectMenu", "isRoleSelectMenu", "isChannelSelectMenu", "isStringSelectMenu", "isButton", "isModalSubmit"])(
        "routes a %s interaction by its customId prefix",
        async (kind) => {
            const cmd = { name: "pick", execute: jest.fn(async () => {}) };
            bot.client.commands.set("pick", cmd);
            const i = fakeInteraction(kind, { customId: "pick:123" });
            await bot.handleInteraction(i);
            expect(cmd.execute).toHaveBeenCalledWith(i, bot.client);
        },
    );

    it("ignores interaction kinds it does not route", async () => {
        const i = fakeInteraction("somethingElse", { customId: "pick" });
        await bot.handleInteraction(i);
        expect(i.reply).not.toHaveBeenCalled();
    });

    it("keeps the name:args lookup", () => {
        expect(bot.lookupKey({ customId: "logcheck-eval:42" })).toBe("logcheck-eval");
        expect(bot.lookupKey({ commandName: "signup", customId: "x:y" })).toBe("signup");
    });
});
