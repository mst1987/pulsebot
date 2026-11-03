// The Discord name with the character behind it as a hover text: escaping, fallbacks, the link budget, the name memory.
jest.mock("../../../src/services/discord/discord", () => ({ resolveUserNames: jest.fn(async () => ({})) }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const discord = require("../../../src/services/discord/discord");
const variables = require("../../../src/config/variables");
const {
    LINK_CAPS, NAME_WAIT_MS, eventHasLastNames, discordNameText, hoverTitle, hoverNames, fitLinks, resolveHoverNames, _resetForTests,
} = require("../../../src/services/discord/hoverNames");

const URL = "https://eh.example/e/eh-1";
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const RLO = String.fromCharCode(0x202e);
const forever = { id: "eh-1", guildId: "g1", versionId: "forever" };
const tbc = { id: "eh-2", guildId: "g1", versionId: "tbc" };

beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    variables.publicBaseUrl = "https://eh.example";
});

describe("eventHasLastNames", () => {
    it("reads the rule of the event's version, not the space in a name", () => {
        expect(eventHasLastNames(forever)).toBe(true);
        expect(eventHasLastNames(tbc)).toBe(false);
    });
});

describe("discordNameText", () => {
    it.each([
        ["Marc", "Marc"],
        ["  Lena   W ", "Lena W"],
        ["Lena | Heal", "Lena \\| Heal"],
        ["xX_Shadow_Xx", "xX\\_Shadow\\_Xx"],
        ["*fett*", "\\*fett\\*"],
        ["~strike~", "\\~strike\\~"],
        ["`code`", "\\`code\\`"],
        ["back\\slash", "back\\\\slash"],
        ["(Tank)", "\\(Tank\\)"],
        ["[Offi] Lu", "\\(Offi\\) Lu"],
        ["<:x:123>", "\\<:x:123\\>"],
        ["say \"hi\"", "say \"hi\""],
    ])("keeps %j readable and harmless", (name, expected) => {
        expect(discordNameText(name)).toBe(expected);
    });

    it("never mentions", () => {
        expect(discordNameText("@everyone")).toBe(`@${ZWSP}everyone`);
        expect(discordNameText("<@123>")).toBe(`\\<@${ZWSP}123\\>`);
    });

    it("cannot end a link's text: no bare square bracket stays", () => {
        expect(discordNameText("a](https://evil.example) b")).toBe("");
        expect(discordNameText("a] [b")).not.toMatch(/[[\]]/);
    });

    it.each([
        "https://evil.example", "discord.gg/abc", "www.foo", "Marc.de", "x://y", "EVIL.COM",
    ])("treats %j as an address: empty, so the character is shown", (name) => {
        expect(discordNameText(name)).toBe("");
    });

    it("keeps a name that only has dots in it", () => {
        expect(discordNameText("J. Doe")).toBe("J. Doe");
        expect(discordNameText("v1.2")).toBe("v1.2");
    });

    it("drops invisible characters and takes a name of nothing but those for empty", () => {
        expect(discordNameText(`Ma${RLO}rc${ZWSP}`)).toBe("Marc");
        expect(discordNameText(`${ZWSP}${RLO}`)).toBe("");
        expect(discordNameText(ZWJ)).toBe("");
        expect(discordNameText("")).toBe("");
        expect(discordNameText(null)).toBe("");
        expect(discordNameText(undefined)).toBe("");
    });

    it("keeps the joiner inside an emoji sequence", () => {
        const family = `${String.fromCodePoint(0x1f468)}${ZWJ}${String.fromCodePoint(0x1f469)}`;
        expect(discordNameText(family)).toBe(family);
    });

    it("stays on one line", () => {
        expect(discordNameText("a\nb\tc")).toBe("a b c");
    });
});

describe("hoverTitle", () => {
    it("keeps letters of every alphabet, apostrophe and hyphen", () => {
        expect(hoverTitle("Aldric Sturmwind")).toBe("Aldric Sturmwind");
        expect(hoverTitle("Éowyn O'Neil-Größe")).toBe("Éowyn O'Neil-Größe");
    });

    it("removes what could end the quoted title", () => {
        expect(hoverTitle("Evil\") [x](y) \"z")).toBe("Evil xy z");
        expect(hoverTitle("")).toBe("");
        expect(hoverTitle(null)).toBe("");
    });
});

describe("hoverNames", () => {
    const fallback = (p) => p.character || `<@${p.userId}>`;
    const hover = hoverNames({ discordNames: { 1: "Marc", 2: "https://evil.example" }, url: URL, fallback });

    it("is null without names or address: the message stays with the characters", () => {
        expect(hoverNames({ discordNames: null, url: URL, fallback })).toBeNull();
        expect(hoverNames({ discordNames: {}, url: "", fallback })).toBeNull();
    });

    it("links the Discord name, the character as its title", () => {
        expect(hover.linked({ userId: "1", character: "Aldric Sturmwind" })).toBe(`[Marc](<${URL}> "Aldric Sturmwind")`);
        expect(hover.plain({ userId: "1", character: "Aldric Sturmwind" })).toBe("Marc");
    });

    it("shows the character as text without a Discord name, or with an address for one", () => {
        for (const show of [hover.linked, hover.plain]) {
            expect(show({ userId: "9", character: "Aldric Sturmwind" })).toBe("Aldric Sturmwind");
            expect(show({ userId: "2", character: "Aldric Sturmwind" })).toBe("Aldric Sturmwind");
        }
    });

    it("leaves a row without a character to the fallback, even with a known Discord name", () => {
        for (const show of [hover.linked, hover.plain]) expect(show({ userId: "1", character: "" })).toBe("<@1>");
    });

    it("falls back when nothing of the character is left for the title", () => {
        expect(hover.linked({ userId: "1", character: "\"()\"" })).toBe("\"()\"");
    });
});

describe("fitLinks", () => {
    const render = (item, linked) => (linked ? `${item}-linked` : item);

    it("links everything that fits", () => {
        expect(fitLinks(["a", "b"], render, { max: 100 })).toEqual(["a-linked", "b-linked"]);
    });

    it("links in order until the budget is spent, the rest stays plain and listed", () => {
        // plain "a\nb\nc" = 5, each link costs 7
        expect(fitLinks(["a", "b", "c"], render, { max: 5 + 7 + 7 })).toEqual(["a-linked", "b-linked", "c"]);
        expect(fitLinks(["a", "b", "c"], render, { max: 5 + 6 })).toEqual(["a", "b", "c"]);
    });

    it("gives the room a too long link leaves to a later, shorter one", () => {
        const costly = (item, linked) => (linked ? `${item}${item === "a" ? "-very-long-link" : "-l"}` : item);
        expect(fitLinks(["a", "b"], costly, { max: 3 + 2 })).toEqual(["a", "b-l"]);
    });

    it("stops at the cap", () => {
        expect(fitLinks(["a", "b", "c"], render, { max: 100, cap: 1 })).toEqual(["a-linked", "b", "c"]);
        expect(fitLinks(["a", "b"], render, { max: 100, cap: 0 })).toEqual(["a", "b"]);
    });

    it("does not count items without a link against the cap", () => {
        const some = (item, linked) => (linked && item !== "a" ? `${item}-linked` : item);
        expect(fitLinks(["a", "b"], some, { max: 100, cap: 1 })).toEqual(["a", "b-linked"]);
    });

    it("gives nobody a link when even the plain texts do not fit", () => {
        expect(fitLinks(["aaaa", "bbbb"], render, { max: 3 })).toEqual(["aaaa", "bbbb"]);
    });

    it("counts its separator", () => {
        expect(fitLinks(["a", "b"], render, { max: 2 + 7, sep: "" })).toEqual(["a-linked", "b"]);
        expect(fitLinks(["a", "b"], render, { max: 3 + 6, sep: "\n" })).toEqual(["a", "b"]);
    });

    it("handles an empty list", () => {
        expect(fitLinks([], render, { max: 0 })).toEqual([]);
    });

    it("the caps end with none, from all links down", () => {
        expect(LINK_CAPS[0]).toBe(Infinity);
        expect(LINK_CAPS[LINK_CAPS.length - 1]).toBe(0);
    });
});

describe("resolveHoverNames", () => {
    it("asks Discord for each user once, with a short wait", async () => {
        discord.resolveUserNames.mockResolvedValue({ 1: "Marc" });
        await expect(resolveHoverNames(forever, ["1", "1", 2, "", null])).resolves.toEqual({ 1: "Marc" });
        expect(discord.resolveUserNames).toHaveBeenCalledWith("g1", ["1", "2"], { waitMs: NAME_WAIT_MS });
        expect(NAME_WAIT_MS).toBeLessThan(3000);
    });

    it("asks Discord for nothing when no name would be used", async () => {
        await expect(resolveHoverNames(tbc, ["1"])).resolves.toBeNull();
        await expect(resolveHoverNames({ ...forever, guildId: "" }, ["1"])).resolves.toBeNull();
        await expect(resolveHoverNames(null, ["1"])).resolves.toBeNull();
        variables.publicBaseUrl = "";
        await expect(resolveHoverNames(forever, ["1"])).resolves.toBeNull();
        expect(discord.resolveUserNames).not.toHaveBeenCalled();
    });

    it("keeps the last known name when one does not arrive in time", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1"]);
        discord.resolveUserNames.mockResolvedValueOnce({});
        await expect(resolveHoverNames(forever, ["1"])).resolves.toEqual({ 1: "Marc" });
    });

    it("takes a new name over the last known one", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1"]);
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marcus" });
        await expect(resolveHoverNames(forever, ["1"])).resolves.toEqual({ 1: "Marcus" });
        discord.resolveUserNames.mockResolvedValueOnce({});
        await expect(resolveHoverNames(forever, ["1"])).resolves.toEqual({ 1: "Marcus" });
    });

    it("keeps the names per server", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1"]);
        discord.resolveUserNames.mockResolvedValueOnce({});
        await expect(resolveHoverNames({ ...forever, guildId: "g2" }, ["1"])).resolves.toEqual({});
    });

    it("never throws: a failed lookup uses what is known", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1"]);
        discord.resolveUserNames.mockRejectedValueOnce(new Error("gateway"));
        await expect(resolveHoverNames(forever, ["1", "2"])).resolves.toEqual({ 1: "Marc" });
    });
});
