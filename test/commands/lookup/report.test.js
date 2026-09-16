jest.mock("../../../src/web/reportStore", () => ({ listReports: jest.fn() }));
jest.mock("../../../src/web/lootStats", () => ({ itemCatalog: jest.fn() }));

const { MessageFlags } = require("discord.js");
const report = require("../../../src/commands/lookup/report");
const council = require("../../../src/commands/lookup/council");
const { listReports } = require("../../../src/web/reportStore");
const { itemCatalog } = require("../../../src/web/lootStats");
const { EMBED_LIMITS, embedSize } = require("../../../src/utils/botLookup");
const { mockInteraction } = require("../../helpers/mockInteraction");
const { memberMayRun } = require("../../helpers/botCommandAccess");

const embed = (i) => i.reply.mock.calls[0][0].embeds[0];
const buttons = (i) => (i.reply.mock.calls[0][0].components[0] || { components: [] }).components;

beforeEach(() => {
    jest.clearAllMocks();
    listReports.mockReturnValue([]);
    itemCatalog.mockReturnValue([]);
});

describe("/report", () => {
    it("is open to every member — the report pages are already posted in Discord", () => {
        expect(report.group).toBe("logs");
        expect(memberMayRun(report)).toBe(true);
    });

    it("lists the newest evaluations with links to their pages", async () => {
        listReports.mockReturnValue([
            { id: "old", title: "Karazhan", zone: "Karazhan", generatedAt: 1000, raids: null },
            { id: "new", title: "Hyjal + BT", generatedAt: 5000000, raids: [{ label: "Hyjal", killed: 5, total: 5 }, { label: "BT", killed: 3, total: 9 }] },
        ]);
        const i = mockInteraction();
        await report.execute(i);
        const e = embed(i);
        expect(i.reply.mock.calls[0][0].flags).toBe(MessageFlags.Ephemeral);
        expect(e.description).toContain("**2 Auswertungen**");
        expect(e.description.indexOf("Hyjal + BT")).toBeLessThan(e.description.indexOf("Karazhan"));
        expect(e.description).toMatch(/\[Hyjal \+ BT\]\(.*\/r\/new\)/);
        expect(e.description).toContain("Hyjal 5/5 · BT 3/9");
        expect(buttons(i)[0].url).toMatch(/\/r\/new$/);
    });

    it("lists at most five and stays within the embed limits", async () => {
        listReports.mockReturnValue(Array.from({ length: 30 }, (_, n) => ({ id: `r${n}`, title: "T".repeat(500), zone: "Z".repeat(500), generatedAt: n })));
        const i = mockInteraction();
        await report.execute(i);
        expect((embed(i).description.match(/\/r\/r\d+/g) || [])).toHaveLength(report.MAX_REPORTS);
        expect(embedSize(embed(i))).toBeLessThanOrEqual(EMBED_LIMITS.total);
    });

    it("points to /logcheck when nothing was evaluated yet", async () => {
        const i = mockInteraction();
        await report.execute(i);
        expect(embed(i).description).toContain("/logcheck");
        expect(buttons(i)).toEqual([]);
    });

    it("writes raid progress compactly", () => {
        expect(report.progressText([{ label: "SSC", killed: 2, total: 6 }, { label: "Gruul", total: 0 }])).toBe("SSC 2/6 · Gruul");
        expect(report.progressText(null)).toBe("");
    });
});

describe("/council", () => {
    it("is for admins by default", () => {
        expect(council.group).toBe("loot");
        expect(memberMayRun(council)).toBe(false);
        expect(memberMayRun(council, { botCommandAccess: { council: { mode: "roles", roleIds: ["123456789012345678"] } } },
            { id: "m", roleIds: ["123456789012345678"] })).toBe(true);
    });

    it("links the drop check of the picked item and says how often it went out", async () => {
        itemCatalog.mockReturnValue([{ itemId: 32235, itemName: "Cursed Vision of Sargeras", count: 2, awards: [{ character: "Dorn" }] }]);
        const i = mockInteraction({ options: { item: "32235" } });
        await council.execute(i);
        expect(embed(i).title).toBe("Cursed Vision of Sargeras");
        expect(embed(i).description).toContain("Schon **2×** vergeben, zuletzt an **Dorn**");
        expect(buttons(i)[0]).toEqual(expect.objectContaining({ label: "Drop prüfen", url: expect.stringMatching(/\/lootcouncil\/drop\/32235$/) }));
    });

    it("takes a raid drop the guild never looted, and a bare id", async () => {
        const known = council.findCouncilItem("soul essence");
        expect(known).toEqual({ id: 21882, name: "Soul Essence" });
        expect(council.findCouncilItem("21882")).toEqual(known);
        const i = mockInteraction({ options: { item: String(known.id) } });
        await council.execute(i);
        expect(embed(i).description).toContain("Noch nie vergeben.");
        expect(council.findCouncilItem("999999999")).toEqual({ id: 999999999, name: "Item 999999999" });
    });

    it("reports an unknown name", async () => {
        const i = mockInteraction({ options: { item: "zzzz-kein-item" } });
        await council.execute(i);
        expect(embed(i).title).toBe("Item nicht gefunden");
    });

    it("suggests raid items by name, capped at 25", async () => {
        const i = mockInteraction({ focused: { name: "item", value: "of" } });
        await council.autocomplete(i);
        const choices = i.respond.mock.calls[0][0];
        expect(choices).toHaveLength(25);
        for (const c of choices) {
            expect(c.name.length).toBeLessThanOrEqual(100);
            expect(c.value).toMatch(/^\d+$/);
        }
    });
});
