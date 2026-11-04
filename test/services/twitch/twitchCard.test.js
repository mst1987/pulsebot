const {
    TWITCH_COLOR, ENDED_COLOR, escapeText, previewUrl, fillText, durationText, liveCard, endedCard,
} = require("../../../src/services/twitch/twitchCard");

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NOW = 1800000000000;
const WINDOW = 5 * 60 * 1000;

const entry = (over = {}) => ({ login: "foo", roleId: "555555", text: "", ...over });
const display = (over = {}) => ({
    name: "Foo", title: "Raidabend", game: "World of Warcraft", viewers: 1234, thumbnail: "https://cdn.example/foo-{width}x{height}.jpg", ...over,
});
const textOf = (payload) => JSON.stringify(payload.components);
/** Every text display of the card, joined: what Discord reads as markdown. */
function markdownOf(payload) {
    return payload.components[0].components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
}

describe("the Twitch emoji in the kicker", () => {
    const { setAppEmojis, resetAppEmojis } = require("../../../src/services/discord/appEmojis");
    const CARD = () => liveCard({ lang: "de", entry: entry(), display: display(), now: NOW });
    const OVER = () => endedCard({ lang: "de", login: "foo", display: display(), durationMs: WINDOW });

    afterEach(() => resetAppEmojis());

    it("stands in front of the words on both cards once it is loaded", () => {
        setAppEmojis([{ id: "77", name: "eh_ui_twitch" }]);
        expect(markdownOf(CARD())).toMatch(/^-# <:eh_ui_twitch:77> \S/m);
        expect(markdownOf(OVER())).toMatch(/^-# <:eh_ui_twitch:77> \S/m);
    });

    it("leaves just the words without it, and no unicode stand-in", () => {
        resetAppEmojis();
        const line = markdownOf(CARD()).split("\n").find((l) => l.startsWith("-# "));
        expect(line).toMatch(/^-# [\w ]+$/);
    });
});

describe("escapeText", () => {
    it("escapes markdown so a title stays plain text", () => {
        expect(escapeText("**fett** _kursiv_ ~~weg~~ `code` ||spoiler||")).toBe(
            "\\*\\*fett\\*\\* \\_kursiv\\_ \\~\\~weg\\~\\~ \\`code\\` \\|\\|spoiler\\|\\|",
        );
    });

    it("makes a link, a heading, a quote and a list harmless", () => {
        expect(escapeText("[klick](https://evil.example)")).toBe("\\[klick\\]\\(https\\://evil.example\\)");
        expect(escapeText("# Titel")).toBe("\\# Titel");
        expect(escapeText("> Zitat")).toBe("\\> Zitat");
        expect(escapeText("- Liste")).toBe("\\- Liste");
    });

    it("breaks every mention", () => {
        expect(escapeText("@everyone @here")).toBe(`@${ZERO_WIDTH_SPACE}everyone @${ZERO_WIDTH_SPACE}here`);
        expect(escapeText("<@&555555>")).toBe(`\\<@${ZERO_WIDTH_SPACE}&555555\\>`);
    });

    it("keeps it to one line and takes nothing for empty", () => {
        expect(escapeText("eins\n\n  zwei\tdrei ")).toBe("eins zwei drei");
        expect(escapeText(null)).toBe("");
        expect(escapeText(undefined)).toBe("");
    });
});

describe("previewUrl", () => {
    it("fills the size and adds a query that changes per 5 minutes", () => {
        const first = previewUrl("https://cdn.example/foo-{width}x{height}.jpg", NOW);
        expect(first).toBe(`https://cdn.example/foo-1280x720.jpg?t=${Math.floor(NOW / WINDOW)}`);
        expect(first).not.toContain("{");
        expect(previewUrl("https://cdn.example/foo-{width}x{height}.jpg", NOW + WINDOW)).not.toBe(first);
    });

    it("appends to a query it already finds", () => {
        expect(previewUrl("https://cdn.example/a.jpg?x=1", NOW)).toContain("?x=1&t=");
    });

    it("gives nothing for no picture", () => {
        expect(previewUrl("", NOW)).toBe("");
        expect(previewUrl(undefined, NOW)).toBe("");
    });
});

describe("fillText", () => {
    it("fills the placeholders in one pass, escaped, and keeps the orga's markdown", () => {
        const out = fillText("**{streamer}** spielt {game}: {title} {url}", {
            login: "foo",
            display: display({ name: "F_oo", title: "{url}", game: "W*W" }),
        });
        expect(out).toBe("**F\\_oo** spielt W\\*W: {url} https://www.twitch.tv/foo");
    });

    it("falls back to the login and leaves an unknown placeholder alone", () => {
        expect(fillText("{streamer} {other}", { login: "foo", display: {} })).toBe("foo {other}");
    });
});

describe("durationText", () => {
    it("reads in hours and minutes, at least one minute", () => {
        expect(durationText("de", 125 * 60 * 1000)).toBe("2 Std. 5 Min.");
        expect(durationText("en", 125 * 60 * 1000)).toBe("2 h 5 min");
        expect(durationText("de", 0)).toBe("1 Min.");
        expect(durationText("en", 45 * 60 * 1000)).toBe("45 min");
    });
});

describe("liveCard", () => {
    it("never allows a ping itself, whatever the text says", () => {
        const payload = liveCard({ lang: "de", entry: entry({ text: "@everyone <@&999999>" }), display: display(), now: NOW });
        expect(payload.allowedMentions).toEqual({ parse: [] });
    });

    it("shows the chosen role as its first line", () => {
        const payload = liveCard({ lang: "de", entry: entry(), display: display(), now: NOW });
        expect(payload.components[0].components[0].content).toBe("<@&555555>");
    });

    it("has no mention line without a role", () => {
        const payload = liveCard({ lang: "de", entry: entry({ roleId: "" }), display: display(), now: NOW });
        expect(textOf(payload)).not.toContain("<@&");
    });

    it("escapes everything Twitch sends", () => {
        const payload = liveCard({
            lang: "de",
            entry: entry(),
            display: display({ name: "F*oo", title: "@everyone **laut**", game: "[Spiel](http://x)" }),
            now: NOW,
        });
        const text = markdownOf(payload);
        expect(text).toContain("## F\\*oo");
        expect(text).toContain(`@${ZERO_WIDTH_SPACE}everyone \\*\\*laut\\*\\*`);
        expect(text).toContain("\\[Spiel\\]\\(http\\://x\\)");
        expect(text).not.toContain("@everyone");
    });

    it("shows the title once when the own text already names it", () => {
        const count = (text) => text.split("Raidabend").length - 1;
        const named = liveCard({ lang: "de", entry: entry({ text: "{streamer}: {title}" }), display: display(), now: NOW });
        const other = liveCard({ lang: "de", entry: entry({ text: "Schaut rein!" }), display: display(), now: NOW });
        const none = liveCard({ lang: "de", entry: entry(), display: display(), now: NOW });
        expect(count(markdownOf(named))).toBe(1);
        expect(count(markdownOf(other))).toBe(1);
        expect(count(markdownOf(none))).toBe(1);
    });

    it("carries the colour, the preview in its size, the viewers and the link button", () => {
        const payload = liveCard({ lang: "de", entry: entry(), display: display(), now: NOW });
        const container = payload.components[0];
        expect(container.accent_color).toBe(TWITCH_COLOR);
        expect(textOf(payload)).toContain("foo-1280x720.jpg?t=");
        expect(markdownOf(payload)).toContain("1.234");
        expect(textOf(payload)).toContain("https://www.twitch.tv/foo");
    });

    it("is in the language of the server", () => {
        const de = liveCard({ lang: "de", entry: entry(), display: display(), now: NOW });
        const en = liveCard({ lang: "en", entry: entry(), display: display(), now: NOW });
        expect(markdownOf(en)).toContain("Live on Twitch");
        expect(markdownOf(en)).toContain("1,234");
        expect(markdownOf(de)).not.toContain("Live on Twitch");
    });
});

describe("endedCard", () => {
    it("is grey, without ping line, button or picture", () => {
        const payload = endedCard({ lang: "en", login: "foo", display: display(), durationMs: 65 * 60 * 1000 });
        expect(payload.components[0].accent_color).toBe(ENDED_COLOR);
        expect(payload.allowedMentions).toEqual({ parse: [] });
        expect(textOf(payload)).not.toContain("<@&");
        expect(textOf(payload)).not.toContain("twitch.tv");
        expect(textOf(payload)).not.toContain("cdn.example");
        expect(markdownOf(payload)).toContain("Stream ended");
        expect(markdownOf(payload)).toContain("1 h 5 min");
    });

    it("draws without anything Twitch said", () => {
        const payload = endedCard({ lang: "en", login: "foo", display: null, durationMs: 0 });
        expect(markdownOf(payload)).toContain("## foo");
    });
});
