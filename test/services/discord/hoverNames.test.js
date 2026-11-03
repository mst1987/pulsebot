// The Discord name with the character behind it as a hover text: escaping, fallbacks, the link budget, the name memory.
jest.mock("../../../src/services/discord/discord", () => ({ resolveUserNames: jest.fn(async () => ({})) }));
jest.mock("../../../src/config/variables", () => ({ publicBaseUrl: "https://eh.example", embedAccentColor: 7 }));

const discord = require("../../../src/services/discord/discord");
const variables = require("../../../src/config/variables");
const {
    LINK_CAPS, NAME_WAIT_MS, eventHasLastNames, discordNameText, discordLinkText, hoverTitle, hoverNames, fitLinks, resolveHoverNames, _resetForTests,
} = require("../../../src/services/discord/hoverNames");

const URL = "https://eh.example/e/eh-1";
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const RLO = String.fromCharCode(0x202e);
// What Discord draws as nothing: Hangul filler, Braille blank, variation selector.
const BLANKS = [0x3164, 0x2800, 0xfe0f].map((c) => String.fromCharCode(c));
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
        ["say \"hi\"", "say \"hi\""],
    ])("keeps %j readable and harmless", (name, expected) => {
        expect(discordNameText(name)).toBe(expected);
    });

    it("never mentions", () => {
        expect(discordNameText("@everyone")).toBe(`@${ZWSP}everyone`);
    });

    it.each(["<:x:123>", "<a:x:123>", "<@123>", "<@!123>", "<@&123>", "<#123>", "<t:123:R>"])("removes Discord's syntax %j whole", (name) => {
        expect(discordNameText(name)).toBe("");
        expect(discordNameText(`Kira ${name}`)).toBe("Kira");
    });

    it.each(BLANKS)("takes a name of nothing but the filler %j for empty, and keeps it inside a name", (blank) => {
        expect(discordNameText(blank)).toBe("");
        expect(discordNameText(`${blank} ${blank}`)).toBe("");
        expect(discordNameText(`Ma${blank}rc`)).toBe(`Ma${blank}rc`);
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

describe("discordLinkText", () => {
    // measured on Discord: inside a masked link a backslash shows, these read as they are
    it.each([
        "(Tank)", "a) b", "a( b", "xX_Shadow_Xx", "Lena | Heal", "Konstantin (Tank)", "# titel", "- liste", "a\"b", "pfad/name",
    ])("leaves %j as it is", (name) => {
        expect(discordLinkText(name)).toBe(name);
    });

    it.each([
        ["> zitat", "zitat"],
        ["back\\slash", "backslash"],
        ["_kursiv_", "kursiv"],
        ["*stern*", "stern"],
        ["~~strike~~", "strike"],
        ["||spoiler||", "|spoiler|"],
        ["`code`", "code"],
        ["**fett**", "fett"],
        ["@everyone", "everyone"],
        ["Kira <:eh:123>", "Kira"],
        ["x]y", "x)y"],
        ["x\\]y", "x)y"],
        ["Ludmilla [Offi]", "Ludmilla (Offi)"],
        ["a__b__c", "a_b_c"],
        ["_a_b_", "a_b"],
    ])("cleans %j to %j", (name, expected) => {
        expect(discordLinkText(name)).toBe(expected);
    });

    it.each(["<@123>", "<@!123>", "<#123>", "<@&123>", "<t:123:R>", "<t:123>", "<:eh:123>", "<a:eh:123>", "</cmd:123>"])("removes Discord's syntax %j without a bare id", (name) => {
        expect(discordLinkText(name)).toBe("");
    });

    it.each([
        "ok](https://evil.example) [z", "evil*.com", "https://evil.example", "www.foo",
    ])("treats %j as an address: empty, so the character is shown", (name) => {
        expect(discordLinkText(name)).toBe("");
    });

    it.each(["***", "___", "`~`", "@", ...BLANKS, ZWSP, "", null, undefined])("is empty when nothing visible is left of %j", (name) => {
        expect(discordLinkText(name)).toBe("");
    });

    it("never carries a backslash or a square bracket", () => {
        for (const name of ["a\\b", "*_~`|\"\\", "[x](y)", "a\\_b", "<@1>\\[x]"]) {
            expect(discordLinkText(name)).not.toMatch(/[\\[\]]/);
        }
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

    it("does not escape in the link, does in the plain text: both read the same", () => {
        const names = hoverNames({ discordNames: { 1: "Konstantin (Tank)", 2: "xX_Shadow_Xx", 3: "Lena | Heal", 4: "Ludmilla [Offi]" }, url: URL, fallback });
        const person = (userId) => ({ userId, character: "Aldric Sturmwind" });
        expect(names.linked(person("1"))).toBe(`[Konstantin (Tank)](<${URL}> "Aldric Sturmwind")`);
        expect(names.linked(person("2"))).toBe(`[xX_Shadow_Xx](<${URL}> "Aldric Sturmwind")`);
        expect(names.linked(person("3"))).toBe(`[Lena | Heal](<${URL}> "Aldric Sturmwind")`);
        expect(names.linked(person("4"))).toBe(`[Ludmilla (Offi)](<${URL}> "Aldric Sturmwind")`);
        expect(names.plain(person("1"))).toBe("Konstantin \\(Tank\\)");
        expect(names.plain(person("2"))).toBe("xX\\_Shadow\\_Xx");
        expect(names.plain(person("3"))).toBe("Lena \\| Heal");
        expect(names.plain(person("4"))).toBe("Ludmilla \\(Offi\\)");
    });

    it.each(["***", "<@123>", "<:eh:123>", ...BLANKS])("shows the character for a name with nothing to show: %j", (name) => {
        const names = hoverNames({ discordNames: { 1: name }, url: URL, fallback });
        for (const show of [names.linked, names.plain]) expect(show({ userId: "1", character: "Aldric Sturmwind" })).toBe("Aldric Sturmwind");
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

    it("counts a link shorter than its plain text as room, and stays within the budget", () => {
        // the plain text escapes, the link does not: here a link saves characters
        const shorter = (item, linked) => (linked ? item : `${item}\\\\\\`);
        const out = fitLinks(["a", "b"], shorter, { max: 9, sep: "\n" });
        expect(out).toEqual(["a", "b"]);
        expect(out.join("\n").length).toBeLessThanOrEqual(9);
        // the room the first link frees pays for the second's cost
        const mixed = (item, linked) => {
            if (item === "a") return linked ? "a" : "a\\\\\\";
            return linked ? "b-link" : "b";
        };
        const fit = fitLinks(["a", "b"], mixed, { max: 11, sep: "\n" });
        expect(fit).toEqual(["a", "b-link"]);
        expect(fit.join("\n").length).toBeLessThanOrEqual(11);
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

    it("saves the wait when every name is known, still asking for a changed one", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc", 2: "Lena" });
        await resolveHoverNames(forever, ["1", "2"]);
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marcus" });
        await expect(resolveHoverNames(forever, ["1", "2"])).resolves.toEqual({ 1: "Marcus", 2: "Lena" });
        expect(discord.resolveUserNames).toHaveBeenLastCalledWith("g1", ["1", "2"], { waitMs: 0 });
    });

    it("waits as soon as one name is new, also when a raider joins", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1"]);
        discord.resolveUserNames.mockResolvedValueOnce({ 2: "Lena" });
        await expect(resolveHoverNames(forever, ["1", "2"])).resolves.toEqual({ 1: "Marc", 2: "Lena" });
        expect(discord.resolveUserNames).toHaveBeenLastCalledWith("g1", ["1", "2"], { waitMs: NAME_WAIT_MS });
    });

    it("waits again for a name that did not arrive, the known ones keep theirs", async () => {
        discord.resolveUserNames.mockResolvedValueOnce({ 1: "Marc" });
        await resolveHoverNames(forever, ["1", "2"]);
        discord.resolveUserNames.mockResolvedValueOnce({});
        await expect(resolveHoverNames(forever, ["1", "2"])).resolves.toEqual({ 1: "Marc" });
        expect(discord.resolveUserNames).toHaveBeenLastCalledWith("g1", ["1", "2"], { waitMs: NAME_WAIT_MS });
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
