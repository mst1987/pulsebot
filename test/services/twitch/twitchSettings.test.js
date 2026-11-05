const {
    MAX_STREAMERS_PER_SERVER, MAX_TEXT_LENGTH, MAX_GAME_FILTERS, MAX_GAME_NAME_LENGTH,
    TwitchSettingsError, parseLogin, normalizeGames, normalizeTwitchStreamers,
    twitchStreamersOf, allTwitchStreamers, twitchStreamersFromBody, matchesGameFilter,
} = require("../../../src/services/twitch/twitchSettings");

const CHANNEL = "111111";
const ROLE = "555555";

function refusal(fn) {
    try {
        fn();
    } catch (e) {
        expect(e).toBeInstanceOf(TwitchSettingsError);
        return e.code;
    }
    throw new Error("expected a refusal");
}

describe("parseLogin", () => {
    it.each([
        ["Foo_Bar", "foo_bar"],
        ["  foo  ", "foo"],
        ["@foo", "foo"],
        ["https://www.twitch.tv/Foo", "foo"],
        ["http://twitch.tv/foo/", "foo"],
        ["m.twitch.tv/foo?sr=a", "foo"],
        ["twitch.tv/foo#top", "foo"],
    ])("reads %s as %s", (raw, login) => {
        expect(parseLogin(raw)).toBe(login);
    });

    it.each([
        [""],
        [null],
        ["a"],
        ["foo bar"],
        ["ümlaut"],
        ["a".repeat(26)],
        ["https://www.twitch.tv/videos/123"],
        ["https://evil.example/foo"],
        ["evil.example"],
    ])("refuses %s", (raw) => {
        expect(parseLogin(raw)).toBe("");
    });
});

describe("normalizeGames", () => {
    it("cleans a list: no blanks, no doubles whatever the case, the limits hold", () => {
        expect(normalizeGames([" WoW ", "wow", "", null, "Hearthstone"])).toEqual(["WoW", "Hearthstone"]);
        expect(normalizeGames(Array.from({ length: 9 }, (_, i) => `Spiel ${i}`))).toHaveLength(MAX_GAME_FILTERS);
        expect(normalizeGames(["x".repeat(99)])[0]).toHaveLength(MAX_GAME_NAME_LENGTH);
    });

    it("takes a text split by comma or line", () => {
        expect(normalizeGames("WoW, Hearthstone\nDiablo")).toEqual(["WoW", "Hearthstone", "Diablo"]);
        expect(normalizeGames(undefined)).toEqual([]);
    });
});

describe("normalizeTwitchStreamers", () => {
    it("drops broken entries and a second entry of a login, and fills what is missing", () => {
        expect(normalizeTwitchStreamers([
            { login: "Foo", channelId: CHANNEL },
            { login: "foo", channelId: "222222" },
            { login: "", channelId: CHANNEL },
            { login: "bar", channelId: "kein" },
            null,
            "text",
            [],
        ])).toEqual([{ login: "foo", channelId: CHANNEL, roleId: "", text: "", games: [], source: "orga" }]);
    });

    it("drops an impossible role, cuts the text and an unknown source falls back to orga", () => {
        const [entry] = normalizeTwitchStreamers([{
            login: "foo", channelId: CHANNEL, roleId: "x", text: "y".repeat(MAX_TEXT_LENGTH + 9), source: "wer-auch-immer",
        }]);
        expect(entry.roleId).toBe("");
        expect(entry.text).toHaveLength(MAX_TEXT_LENGTH);
        expect(entry.source).toBe("orga");
    });

    it("keeps the source of an approved request", () => {
        const [entry] = normalizeTwitchStreamers([{ login: "foo", channelId: CHANNEL, source: "raider" }]);
        expect(entry.source).toBe("raider");
    });

    it("takes no list as empty", () => {
        expect(normalizeTwitchStreamers(undefined)).toEqual([]);
        expect(normalizeTwitchStreamers({})).toEqual([]);
    });
});

describe("the lists per server", () => {
    const config = {
        serverSettings: {
            100000: { twitchStreamers: [{ login: "foo", channelId: CHANNEL }] },
            200000: { twitchStreamers: [{ login: "foo", channelId: "222222" }, { login: "bar", channelId: "222222" }] },
            300000: {},
        },
    };

    it("reads the list of one server only", () => {
        expect(twitchStreamersOf("100000", { config }).map((e) => e.channelId)).toEqual([CHANNEL]);
        expect(twitchStreamersOf("300000", { config })).toEqual([]);
        expect(twitchStreamersOf("999999", { config })).toEqual([]);
    });

    it("lists every server's entries with their server", () => {
        expect(allTwitchStreamers({ config }).map((e) => `${e.guildId}:${e.login}`)).toEqual(["100000:foo", "200000:foo", "200000:bar"]);
    });
});

describe("twitchStreamersFromBody", () => {
    const body = (over = {}) => ({ login: "foo", channelId: CHANNEL, ...over });

    it("gives a clean entry of the form's fields only", () => {
        expect(twitchStreamersFromBody([body({
            login: "https://twitch.tv/Foo", roleId: ROLE, text: " Hallo ", games: ["WoW"], source: "raider", extra: 1,
        })])).toEqual([{ login: "foo", channelId: CHANNEL, roleId: ROLE, text: "Hallo", games: ["WoW"], source: "orga" }]);
    });

    it("keeps the stored source, never the body's", () => {
        const current = [{ login: "foo", source: "selbst" }];
        expect(twitchStreamersFromBody([body({ source: "orga" })], { current })[0].source).toBe("selbst");
    });

    it.each([
        ["invalid_list", () => "keine Liste"],
        ["too_many", () => Array.from({ length: MAX_STREAMERS_PER_SERVER + 1 }, (_, i) => body({ login: `name${i}` }))],
        ["invalid_login", () => [body({ login: "foo bar" })]],
        ["invalid_login", () => [null]],
        ["duplicate_streamer", () => [body(), body({ login: "FOO" })]],
        ["missing_channel", () => [body({ channelId: "" })]],
        ["invalid_role", () => [body({ roleId: "abc" })]],
        ["text_too_long", () => [body({ text: "x".repeat(MAX_TEXT_LENGTH + 1) })]],
        ["too_many_games", () => [body({ games: Array.from({ length: MAX_GAME_FILTERS + 1 }, (_, i) => `Spiel ${i}`) })]],
    ])("refuses with %s", (code, input) => {
        expect(refusal(() => twitchStreamersFromBody(input()))).toBe(code);
    });
});

describe("matchesGameFilter", () => {
    it("passes everything without a filter", () => {
        expect(matchesGameFilter([], "Irgendwas")).toBe(true);
        expect(matchesGameFilter(undefined, "")).toBe(true);
    });

    it("passes any of several names, case-insensitive and contained", () => {
        const games = ["world of warcraft", "HEARTHSTONE"];
        expect(matchesGameFilter(games, "World of Warcraft: Classic")).toBe(true);
        expect(matchesGameFilter(games, "Hearthstone")).toBe(true);
        expect(matchesGameFilter(games, "Just Chatting")).toBe(false);
    });

    it("does not pass a stream without a category when a filter is set", () => {
        expect(matchesGameFilter(["wow"], "")).toBe(false);
    });
});
