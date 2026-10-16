// The Orga-Zentrale as a Discord message (services/events/orgaHubPanel.js): a
// Components V2 container with the heading, the summary, the two buttons and
// one section per raid — within Discord's 40 components.
const { MessageFlags } = require("discord.js");
const { orgaHubPayload, statusIcon, newRaidId, linksId, raidCapacity, MAX_RAIDS, COMPONENT_LIMIT, COLOR_ORGA } =require("../../../src/services/events/orgaHubPanel");

const raid = (i, over = {}) => ({
    title: `Raid ${i}`, startTime: 1800000000 + i * 86400, channelId: `c${i}`, status: "draft", label: "Setup in Arbeit",
    detail: "23 Anmeldungen · 19 von 25 im Setup", linkLabel: "Setup", url: `https://eh.example/raids/detail?event=eh-${i}&tab=setup`, ...over,
});

/** Every component, nested ones included. */
function all(list) {
    const out = [];
    for (const c of list || []) {
        out.push(c);
        out.push(...all(c.components));
        if (c.accessory) out.push(c.accessory);
    }
    return out;
}
const texts = (payload) => all(payload.components).filter((c) => c.type === 10).map((c) => c.content);
const buttons = (payload) => all(payload.components).filter((c) => c.type === 2);

describe("services/events/orgaHubPanel", () => {
    it("is one turquoise Components V2 container with heading, summary and the two buttons", () => {
        const p = orgaHubPayload({
            categoryId: "cat1", categoryName: "╭・ TBC Montag", raids: [raid(1)], total: 1, webUrl: "https://eh.example/raids",
            counts: [{ status: "open", label: "1 Setup offen" }, { status: "posted", label: "1 gepostet" }],
        });
        expect(p.flags).toBe(MessageFlags.IsComponentsV2);
        expect(p.embeds).toEqual([]);
        expect(p.components).toHaveLength(1);
        expect(p.components[0].accent_color).toBe(COLOR_ORGA);
        const head = texts(p)[0];
        expect(head).toContain("## Orga-Zentrale · TBC Montag");
        expect(head).toContain("-# 1 Raid in den nächsten 4 Wochen");
        expect(head).toContain("🟠 1 Setup offen · ✅ 1 gepostet");
        const [create, web] = buttons(p);
        expect(create).toMatchObject({ custom_id: "orga:new:cat1", label: "Raid anlegen", style: 1 });
        expect(web).toMatchObject({ label: "Alle Raids im Web", url: "https://eh.example/raids", style: 5 });
    });

    it("draws each raid as three lines with the link into the web beside it", () => {
        const p = orgaHubPayload({ categoryId: "cat1", raids: [raid(1, { title: "Kara *Mo*" })], total: 1 });
        const section = all(p.components).find((c) => c.type === 9);
        expect(section.components[0].content).toBe([
            "**Kara \\*Mo\\***",
            "<t:1800086400:d> <t:1800086400:t> · <t:1800086400:R> · <#c1>",
            "🔵 **Setup in Arbeit** · 23 Anmeldungen · 19 von 25 im Setup",
        ].join("\n"));
        expect(section.accessory).toMatchObject({ label: "Setup", url: "https://eh.example/raids/detail?event=eh-1&tab=setup", style: 5 });
    });

    it("strikes a cancelled raid through and gives it no link", () => {
        const p = orgaHubPayload({ raids: [raid(1, { status: "cancelled", label: "Abgesagt", detail: "", linkLabel: "", url: "", channelId: "" })] });
        expect(all(p.components).some((c) => c.type === 9)).toBe(false);
        expect(texts(p)).toContain("~~**Raid 1**~~\n~~<t:1800086400:d> <t:1800086400:t> · <t:1800086400:R>~~\n✖️ **Abgesagt**");
    });

    it("shows a raid as plain text without a public address, and no web button", () => {
        const p = orgaHubPayload({ raids: [raid(1, { url: "" })], total: 1 });
        expect(all(p.components).some((c) => c.type === 9)).toBe(false);
        expect(buttons(p).map((b) => b.label)).toEqual(["Raid anlegen", "Links …"]);
    });

    describe("orga links", () => {
        const link = (i) => ({ label: `Link ${i}`, url: `https://example.org/${i}` });
        const rows = (p) => all(p.components).filter((c) => c.type === 1);

        it("has only the \"Links …\" button next to \"Raid anlegen\" while there are no links", () => {
            const p = orgaHubPayload({ categoryId: "cat1", webUrl: "https://eh.example/raids" });
            expect(rows(p)).toHaveLength(1);
            expect(buttons(p).map((b) => [b.label, b.style, b.custom_id || b.url])).toEqual([
                ["Raid anlegen", 1, "orga:new:cat1"],
                ["Alle Raids im Web", 5, "https://eh.example/raids"],
                ["Links …", 2, "orga:links:cat1"],
            ]);
            expect(linksId("cat1")).toBe("orga:links:cat1");
        });

        it("draws the links as link buttons in a row of their own below", () => {
            const p = orgaHubPayload({ categoryId: "cat1", links: [link(1), link(2)] });
            expect(rows(p)).toHaveLength(2);
            expect(rows(p)[1].components).toEqual([
                expect.objectContaining({ label: "Link 1", url: "https://example.org/1", style: 5 }),
                expect.objectContaining({ label: "Link 2", url: "https://example.org/2", style: 5 }),
            ]);
        });

        it("fits Discord's 40 components in the worst case: 5 links, many raids, the summary", () => {
            const raids = Array.from({ length: 13 }, (_, i) => raid(i + 1));
            const p = orgaHubPayload({
                categoryId: "cat1", raids, total: 13, webUrl: "https://eh.example/raids", links: [1, 2, 3, 4, 5].map(link),
                counts: [{ status: "open", label: "5 Setup offen" }, { status: "draft", label: "8 in Arbeit" }],
            });
            expect(all(p.components).length).toBeLessThanOrEqual(COMPONENT_LIMIT);
            expect(all(p.components).filter((c) => c.type === 9)).toHaveLength(raidCapacity(5));
            expect(raidCapacity(5)).toBe(8);
            const foot = texts(p)[texts(p).length - 1];
            expect(foot).toContain("-# 5 weitere Raids stehen im Web");
            expect(foot).toContain("höchstens 8 Raids");
        });

        it("keeps room for ten raids without links and shrinks with every link row", () => {
            expect(raidCapacity(0)).toBe(MAX_RAIDS);
            expect([1, 2, 3, 4, 5].map(raidCapacity)).toEqual([9, 9, 9, 8, 8]);
            for (let n = 0; n <= 5; n++) {
                const p = orgaHubPayload({ categoryId: "c", raids: Array.from({ length: 12 }, (_, i) => raid(i)), total: 12, webUrl: "https://eh.example/raids", links: Array.from({ length: n }, (_, i) => link(i)) });
                expect(all(p.components).length).toBeLessThanOrEqual(COMPONENT_LIMIT);
            }
        });

        it("ignores a sixth link and rows without label or address", () => {
            const p = orgaHubPayload({ categoryId: "c", links: [1, 2, 3, 4, 5, 6].map(link).concat([{ label: "", url: "" }]) });
            expect(rows(p)[1].components).toHaveLength(5);
        });
    });

    it("says so when no raid is planned", () => {
        const p = orgaHubPayload({ categoryId: "cat1" });
        expect(texts(p)[0]).toBe("## Orga-Zentrale\n-# Keine Raids in den nächsten 4 Wochen");
        expect(texts(p)).toContain("Noch kein Raid geplant. „Raid anlegen“ legt den nächsten an.");
    });

    it("lists at most ten raids, names the rest and stays within 40 components", () => {
        const raids = Array.from({ length: 13 }, (_, i) => raid(i + 1));
        const p = orgaHubPayload({ categoryId: "cat1", raids, total: 13, webUrl: "https://eh.example/raids", counts: [{ status: "draft", label: "13 in Arbeit" }] });
        expect(all(p.components).filter((c) => c.type === 9)).toHaveLength(MAX_RAIDS);
        expect(all(p.components).length).toBeLessThanOrEqual(40);
        const foot = texts(p)[texts(p).length - 1];
        expect(foot).toContain("-# 3 weitere Raids stehen im Web");
        expect(foot).toContain("höchstens 10 Raids, der Rest steht im Web");
        expect(orgaHubPayload({ raids: Array.from({ length: 11 }, (_, i) => raid(i)) }).components[0].components.slice(-1)[0].content)
            .toContain("1 weitere Raid steht im Web");
    });

    it("draws the status icons from the bot's application emojis where it has them", () => {
        expect(statusIcon({ eh_ui_orgaopen: { id: "42", name: "eh_ui_orgaopen" } }, "open")).toBe("<:eh_ui_orgaopen:42>");
        expect(statusIcon({}, "posted")).toBe("✅");
        expect(statusIcon({}, "nope")).toBe("");
        expect(newRaidId("cat9")).toBe("orga:new:cat9");
    });
});

describe("Emoji der Orga-Links", () => {
    it("zeichnet das Emoji eines Links in den Knopf, auch ein eigenes Discord-Emoji", () => {
        const p = orgaHubPayload({ categoryId: "c", links: [
            { label: "A", url: "https://a.example", emoji: "🧙" },
            { label: "B", url: "https://b.example", emoji: "<a:xx:123456789012345678>" },
            { label: "C", url: "https://c.example" },
        ] });
        const linkBtns = buttons(p).filter((b) => b.style === 5 && ["A", "B", "C"].includes(b.label));
        expect(linkBtns.map((b) => b.emoji)).toEqual([{ name: "🧙", animated: false }, { id: "123456789012345678", name: "xx", animated: true }, undefined]);
    });
});
