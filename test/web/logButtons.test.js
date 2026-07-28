const discord = require("../../src/web/discord.js");

const { LOG_SECTIONS, logButtonRow, logButtonContent, LOG_EVAL_PREFIX } = discord;

/** Pull the plain customId/label pairs out of a built ActionRow. */
function buttonsOf(rows) {
    if (!rows.length) return [];
    return rows[0].components.map((b) => ({
        customId: b.data.custom_id,
        label: b.data.label,
    }));
}

describe("web/discord — log evaluation buttons", () => {
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

describe("web/discord — log button message text", () => {
    it("describes both analyses for a freshly detected log", () => {
        const text = logButtonContent("SSC + TK");
        expect(text).toContain("Warcraft-Logs-Report erkannt");
        expect(text).toContain("SSC + TK");
        expect(text).toContain("CLA auswerten");
        expect(text).toContain("RPB auswerten");
        // each button's scope is spelled out
        expect(text).toContain("Gear");
        expect(text).toContain("vermeidbarer Schaden");
    });

    it("reports the finished half and still explains the open one", () => {
        const text = logButtonContent("SSC + TK", ["cla"]);
        expect(text).toContain("CLA ausgewertet");
        expect(text).toContain("RPB auswerten");
        expect(text).not.toContain("CLA auswerten");
        expect(text).toContain("derselben Seite");
    });

    it("says so once both halves are done", () => {
        const text = logButtonContent("SSC + TK", ["cla", "rpb"]);
        expect(text).toContain("Vollständig ausgewertet");
        expect(text).not.toContain("auswerten**");
    });

    it("works without a title", () => {
        expect(logButtonContent("")).toContain("Warcraft-Logs-Report erkannt");
        expect(logButtonContent("", ["cla", "rpb"])).toContain("Vollständig ausgewertet");
    });
});
