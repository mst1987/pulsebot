const discord = require("../../../src/services/discord/discord.js");

const { LOG_SECTIONS, logButtonRow, logButtonEmbed, logButtonPayload, logDayText, LOG_EVAL_PREFIX } = discord;
const dc = require("../../helpers/discordClient");

/** Pull the plain customId/label pairs out of a built ActionRow. */
function buttonsOf(rows) {
    if (!rows.length) return [];
    return rows[0].components.map((b) => ({
        customId: b.data.custom_id,
        label: b.data.label,
    }));
}

describe("services/discord/discord — log evaluation buttons", () => {
    it("offers one button per analysis half", () => {
        expect(LOG_SECTIONS.map((s) => s.key)).toEqual(["cla", "rpb"]);
        const buttons = buttonsOf(logButtonRow("log1"));
        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toEqual({ customId: `${LOG_EVAL_PREFIX}:log1:cla`, label: "CLA auswerten" });
        expect(buttons[1]).toEqual({ customId: `${LOG_EVAL_PREFIX}:log1:rpb`, label: "RPB auswerten" });
    });

    it("drops the button of a half that already ran", () => {
        const buttons = buttonsOf(logButtonRow("log1", ["cla"]));
        expect(buttons).toHaveLength(1);
        expect(buttons[0].label).toBe("RPB auswerten");
    });

    it("returns no row once both halves are done", () => {
        expect(logButtonRow("log1", ["cla", "rpb"])).toEqual([]);
    });

    it("carries the log id into every customId so the router can find it", () => {
        for (const b of buttonsOf(logButtonRow("abc123"))) {
            expect(b.customId.startsWith(`${LOG_EVAL_PREFIX}:abc123:`)).toBe(true);
        }
    });
});

describe("services/discord/discord — the embed under a detected log (checklist)", () => {
    // Sun 4 Oct 2026, 18:34 in Berlin
    const START = Date.UTC(2026, 9, 4, 16, 34);

    it("a fresh log: orange, head 'erkannt', the report's name linked, both analyses open with what they check", () => {
        const e = logButtonEmbed({ title: "Black Temple + Hyjal", link: "https://classic.warcraftlogs.com/reports/RPT1", startMs: START });
        expect(e.color).toBe(0xe8a33d);
        expect(e.author.name).toBe("Warcraft-Logs-Report erkannt");
        expect(e.title).toBe("Black Temple + Hyjal");
        expect(e.url).toBe("https://classic.warcraftlogs.com/reports/RPT1");
        const lines = e.description.split("\n");
        expect(lines[0]).toBe("So 04.10. · 0 von 2 ausgewertet");
        expect(lines).toContain("⚪ **CLA** – Gear, Verzauberungen, Sockel, Consumables, Drums, Potions & Shadow-Resi");
        expect(lines.some((l) => l.startsWith("⚪ **RPB** – vermeidbarer Schaden"))).toBe(true);
        expect(e.footer.text).toBe("Ein Klick startet die Auswertung · beide landen auf derselben Seite");
    });

    it("one half done: blurple, 'läuft', the finished line ticked with a link, the other still open, no footer", () => {
        const e = logButtonEmbed({ title: "SSC + TK", doneSections: ["cla"], reportUrl: "https://eh.example/r/abc" });
        expect(e.color).toBe(0x5865f2);
        expect(e.author.name).toBe("Log-Auswertung läuft");
        expect(e.description).toContain("1 von 2 ausgewertet");
        expect(e.description).toContain("✅ **CLA** – ausgewertet · [öffnen](https://eh.example/r/abc)");
        expect(e.description).toContain("⚪ **RPB** –");
        expect(e.footer).toBeUndefined();
    });

    it("both done: green, 'vollständig ausgewertet', two ticks", () => {
        const e = logButtonEmbed({ title: "SSC + TK", doneSections: ["cla", "rpb"] });
        expect(e.color).toBe(0x23a55a);
        expect(e.author.name).toBe("Log vollständig ausgewertet");
        expect(e.description).toContain("2 von 2 ausgewertet");
        expect(e.description).toContain("✅ **CLA** – ausgewertet");
        expect(e.description).toContain("✅ **RPB** – ausgewertet");
    });

    it("works before the report's name and date are known, and links only https", () => {
        const e = logButtonEmbed({ link: "javascript:alert(1)" });
        expect(e.title).toBe("Warcraft-Logs-Report");
        expect(e.url).toBeUndefined();
        expect(e.description.split("\n")[0]).toBe("0 von 2 ausgewertet");
        expect(logDayText(0)).toBe("");
        expect(logDayText(START)).toBe("So 04.10.");
    });

    it("the payload: no text content, the embed, open buttons and the evaluation's link", () => {
        const p = logButtonPayload({ logId: "log1", title: "SSC", doneSections: ["cla"], reportUrl: "https://eh.example/r/abc" });
        expect(p.content).toBe("");
        expect(p.embeds).toHaveLength(1);
        expect(buttonsOf(p.components)).toEqual([{ customId: `${LOG_EVAL_PREFIX}:log1:rpb`, label: "RPB auswerten" }]);
        expect(p.components[1].components[0].data).toMatchObject({ label: "Auswertung öffnen", url: "https://eh.example/r/abc" });
        expect(logButtonPayload({ title: "x", doneSections: ["cla", "rpb"] }).components).toEqual([]);
    });
});

describe("services/discord/discord — posting and updating the message under a log", () => {
    afterAll(() => discord.setClient(null));

    it("replies with the embed, pinging nobody, and edits a message (also an old plain-text one) into the embed", async () => {
        const old = { id: "m1", content: "📊 **Warcraft-Logs-Report erkannt**", edit: jest.fn(async () => {}) };
        const channel = dc.makeChannel({ id: "logch", messages: [old] });
        discord.setClient(dc.makeClient({ channels: [channel], user: { id: "bot" } }));
        const message = { reply: jest.fn(async () => ({ channelId: "logch", id: "m9" })) };
        expect(await discord.postLogButton(message, { logId: "log1", link: "https://classic.warcraftlogs.com/reports/R" })).toEqual({ channelId: "logch", messageId: "m9" });
        const sent = message.reply.mock.calls[0][0];
        expect(sent.allowedMentions).toEqual({ repliedUser: false });
        expect(sent.embeds[0].title).toBe("Warcraft-Logs-Report");
        expect(await discord.finishLogButton("logch", "m1", { logId: "log1", title: "SSC", startMs: Date.UTC(2026, 9, 4, 16, 0) })).toBe(true);
        const edited = old.edit.mock.calls[0][0];
        expect(edited.content).toBe("");
        expect(edited.embeds[0].title).toBe("SSC");
        expect(await discord.finishLogButton("logch", "nope", {})).toBe(false);
    });
});
