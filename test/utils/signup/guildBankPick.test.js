// The guild bank's request form from the stock (#633): the ephemeral pick card
// with a heading and a select per group, and the item modal with the amount,
// what it is for and — with two or more characters — the recipient.
const { MessageFlags } = require("discord.js");
const pick = require("../../../src/utils/signup/guildBankPick");
const { cardText, cardControls } = require("../../helpers/cardText");

const item = (over = {}) => ({ itemId: 32193, name: "Bold Living Ruby", available: 10, maxPerRequest: 5, emojiId: "e1", ...over });
const GROUPS = [
    { name: "Edelsteine", items: [item(), item({ itemId: 32228, name: "Smooth Dawnstone", available: 7, maxPerRequest: 0, emojiId: "" })] },
    { name: "", items: [item({ itemId: 1, name: "", available: 1, maxPerRequest: 0 })] },
];
const BANK = { scannedAt: 1_800_000_000_000 };

/** Every node of a payload, nested ones too. */
function nodes(payload) {
    const out = [];
    const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        out.push(n);
        walk(n.components);
        walk(n.accessory);
    };
    walk(payload.components);
    return out;
}

describe("utils/signup/guildBankPick", () => {
    it("asks 'What do you need?' with the bank's state, a heading and a select per group", () => {
        const payload = pick.pickPayload({ categoryId: "cat1", bank: BANK, groups: GROUPS, lang: "de" });
        expect(payload.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
        expect(cardText(payload)).toBe([
            "-# Gildenbank",
            "## Was brauchst du?",
            "Stand der Bank: <t:1800000000:R>. Du siehst nur, was die Orga freigegeben hat.",
            "**Edelsteine**\n-# 2 Sorten",
            "**Sonstiges**\n-# 1 Sorte",
            "-# Danach fragt der Bot nach Menge und Zweck.",
        ].join("\n"));
        const selects = cardControls(payload);
        expect(selects.map((s) => [s.custom_id, s.placeholder])).toEqual([
            ["availability:bp:cat1:0", "Gegenstand wählen …"],
            ["availability:bp:cat1:1", "Gegenstand wählen …"],
        ]);
        expect(selects[0].options).toEqual([
            { label: "Bold Living Ruby", description: "Verfügbar: 10 · max. 5 pro Anfrage", value: "32193", emoji: { id: "e1", name: "gb_32193" } },
            { label: "Smooth Dawnstone", description: "Verfügbar: 7", value: "32228" },
        ]);
        expect(selects[1].options[0]).toMatchObject({ label: "Item 1", value: "1" });
    });

    it("speaks English, and leaves out what Discord cannot take: more than 25 items, more than the components allow", () => {
        const many = Array.from({ length: 30 }, (_, i) => item({ itemId: i + 1, name: `Item ${i + 1}` }));
        const groups = Array.from({ length: pick.MAX_GROUPS + 2 }, (_, i) => ({ name: `G${i}`, items: i === 0 ? many : [item()] }));
        const payload = pick.pickPayload({ categoryId: "", bank: { scannedAt: 0 }, groups, lang: "en" });
        const text = cardText(payload);
        expect(text).toContain("## What do you need?\nYou only see what the orga has released.");
        expect(text).toContain("**G0**\n-# 30 kinds · 25 shown");
        expect(text).toContain("-# Next the bot asks for the amount and what it is for. 2 more categories are not shown.");
        expect(cardControls(payload)).toHaveLength(pick.MAX_GROUPS);
        expect(cardControls(payload)[0].options).toHaveLength(25);
        expect(cardControls(payload)[1].options[0].description).toBe("Available: 10 · max. 5 per request");
        expect(nodes(payload).length).toBeLessThanOrEqual(40);
    });

    it("builds the item modal: the item as text, amount, purpose — no character select with one character or none", () => {
        const modal = pick.itemModal({ categoryId: "cat1", item: item(), characters: [{ key: "zibbo", name: "Zibbo" }], lang: "de" });
        expect(modal.custom_id).toBe("availability:mbi:cat1:32193");
        expect(modal.title).toBe("Gildenbank-Anfrage");
        expect(modal.components[0]).toEqual({ type: 10, content: "**Bold Living Ruby** · Verfügbar: 10 · max. 5" });
        expect(modal.components.slice(1).map((c) => [c.type, c.label, c.component.custom_id, c.component.required])).toEqual([
            [18, "Wie viel?", "amount", true],
            [18, "Wofür? (optional)", "purpose", false],
        ]);
        expect(modal.components[1].component).toMatchObject({ type: 4, max_length: 6, placeholder: "z. B. 2" });
        expect(pick.itemModal({ item: item({ maxPerRequest: 0, name: "" }), lang: "en" }).components[0].content).toBe("**Item 32193** · Available: 10");
    });

    it("asks 'To which character?' with two or more, the first preselected", () => {
        const characters = [{ key: "zibbo", name: "Zibbo", realm: "Spine Shatter" }, { key: "zibbowar", name: "Zibbowar" }];
        const modal = pick.itemModal({ categoryId: "cat1", item: item(), characters, lang: "en" });
        const last = modal.components[3];
        expect(last.label).toBe("To which character?");
        expect(last.component).toMatchObject({ type: 3, custom_id: "character", min_values: 1, max_values: 1, required: true });
        expect(last.component.options).toEqual([
            { label: "Zibbo-SpineShatter", value: "zibbo", default: true },
            { label: "Zibbowar", value: "zibbowar", default: false },
        ]);
    });

    it("reads the item id of a submitted modal", () => {
        expect(pick.itemIdOfModal("availability:mbi:cat1:32193")).toBe(32193);
        expect(pick.itemIdOfModal("availability:mbi::7")).toBe(7);
        expect(pick.itemIdOfModal("availability:mb:cat1")).toBe(0);
        expect(pick.itemIdOfModal(undefined)).toBe(0);
        expect(pick.itemEmojiOption({ itemId: 5, emojiId: "" })).toBeUndefined();
    });
});
