const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, StringSelectMenuBuilder } = require("discord.js");
const { card, cardFromEmbed, factsLine, KIND_COLORS, CARD_TEXT_LIMIT } = require("../../../src/utils/discord/card");

const container = (payload) => payload.components[0];
const texts = (payload) => container(payload).components
    .flatMap((c) => (c.type === ComponentType.TextDisplay ? [c.content] : c.type === ComponentType.Section ? c.components.map((t) => t.content) : []));
const btn = (label) => new ButtonBuilder().setCustomId(`x:${label}`).setLabel(label).setStyle(ButtonStyle.Secondary);

describe("card", () => {
    it("is one Components V2 container that sends and edits alike (empty content and embeds, nothing pings)", () => {
        const p = card({ title: "Zugesagt" });
        expect(p.flags & MessageFlags.IsComponentsV2).toBe(MessageFlags.IsComponentsV2);
        expect(p.flags & MessageFlags.Ephemeral).toBe(0);
        expect(p).toMatchObject({ content: "", embeds: [], allowedMentions: { parse: [] } });
        expect(p.components).toHaveLength(1);
        expect(container(p).type).toBe(ComponentType.Container);
    });

    it("colours its bar by kind; a colour of its own wins (the event's)", () => {
        expect(container(card({ kind: "ok", title: "a" })).accent_color).toBe(KIND_COLORS.ok);
        expect(container(card({ kind: "error", title: "a" })).accent_color).toBe(0xe5534b);
        expect(container(card({ kind: "warn", title: "a" })).accent_color).toBe(0xe0a33a);
        expect(container(card({ kind: "raid", color: 0x2bb39b, title: "a" })).accent_color).toBe(0x2bb39b);
        expect(container(card({ kind: "nope", title: "a" })).accent_color).toBe(KIND_COLORS.info);
    });

    it("lays out kicker, heading and text in one block, then the facts, the buttons after a line and the note", () => {
        const p = card({ kicker: "BT · Hyjal", title: "Gruppe 3 als Heiler", text: "Mit dir: Zibbip", facts: [["Gruppe", "3"], { name: "Rolle", value: "Heiler" }], buttons: [btn("Zum Kanal")], note: "Nur du siehst das", ephemeral: true });
        expect(texts(p)).toEqual(["-# BT · Hyjal\n## Gruppe 3 als Heiler\nMit dir: Zibbip", "**Gruppe** 3 · **Rolle** Heiler", "-# Nur du siehst das"]);
        const kinds = container(p).components.map((c) => c.type);
        expect(kinds).toEqual([ComponentType.TextDisplay, ComponentType.TextDisplay, ComponentType.Separator, ComponentType.ActionRow, ComponentType.TextDisplay]);
        expect(p.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    });

    it("puts mentions in the first line and lets them ping", () => {
        const p = card({ kind: "warn", mentions: "<@1> <@2>", title: "Anmeldung fehlt" });
        expect(texts(p)[0]).toBe("<@1> <@2>");
        expect(p.allowedMentions).toEqual({ parse: ["users", "roles"] });
        expect(card({ mentions: "<@1>", allowedMentions: { users: ["1"] } }).allowedMentions).toEqual({ users: ["1"] });
    });

    it("shows a picture beside the heading as a section", () => {
        const sec = container(card({ title: "Raid", thumbnail: "https://x/y.png" })).components[0];
        expect(sec.type).toBe(ComponentType.Section);
        expect(sec.accessory).toMatchObject({ type: ComponentType.Thumbnail, media: { url: "https://x/y.png" } });
    });

    it("puts buttons five to a row and keeps ready rows (a select menu too)", () => {
        const select = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("s").addOptions({ label: "a", value: "a" }));
        const rows = container(card({ title: "a", buttons: [1, 2, 3, 4, 5, 6].map((n) => btn(`b${n}`)).concat([select]) })).components.filter((c) => c.type === ComponentType.ActionRow);
        expect(rows.map((r) => r.components.length)).toEqual([5, 1, 1]);
        expect(rows[2].components[0].type).toBe(ComponentType.StringSelect);
    });

    it("never sends more than Discord's 4000 characters of text", () => {
        const p = card({ title: "a", text: "x".repeat(5000), note: "n" });
        const total = texts(p).join("").length;
        expect(total).toBeLessThanOrEqual(CARD_TEXT_LIMIT);
        expect(texts(p)[0].endsWith("…")).toBe(true);
    });

    it("leaves out what is empty", () => {
        const p = card({ title: "Nur ein Titel", facts: [["Leer", ""]], fields: [] });
        expect(container(p).components).toHaveLength(1);
        expect(factsLine([[" ", " "], ["A", "1"], ["", "nur Wert"]])).toBe("**A** 1 · nur Wert");
    });
});

describe("cardFromEmbed", () => {
    it("turns an embed spec into a card: author over the heading, inline fields as facts, the others as blocks, footer as note", () => {
        const p = cardFromEmbed({ author: "Setup", title: "Gespeichert", description: "Alles da.", fields: [{ name: "Gruppe", value: "3", inline: true }, { name: "Notiz", value: "lang\nmehrzeilig" }], footer: { text: "EventHelper" }, color: 0x123456 }, { ephemeral: true });
        expect(texts(p)).toEqual(["-# Setup\n## Gespeichert\nAlles da.", "**Gruppe** 3", "**Notiz**\nlang\nmehrzeilig", "-# EventHelper"]);
        expect(container(p).accent_color).toBe(0x123456);
        expect(p.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    });
});

describe("card parts", () => {
    it("puts its own body of parts between the facts and the buttons: text, a divider, rows", () => {
        const select = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("s:1").setPlaceholder("x").addOptions({ label: "a", value: "a" }));
        const p = card({ title: "Was brauchst du?", facts: [["A", "1"]], parts: ["---", "**Edelsteine**", select, null, "---", "**Tränke**", select.toJSON()], buttons: [btn("Ok")] });
        const types = container(p).components.map((c) => c.type);
        expect(types).toEqual([
            ComponentType.TextDisplay, ComponentType.TextDisplay,
            ComponentType.Separator, ComponentType.TextDisplay, ComponentType.ActionRow,
            ComponentType.Separator, ComponentType.TextDisplay, ComponentType.ActionRow,
            ComponentType.Separator, ComponentType.ActionRow,
        ]);
        expect(texts(p)).toEqual(["## Was brauchst du?", "**A** 1", "**Edelsteine**", "**Tränke**"]);
        expect(container(p).components[4].components[0]).toMatchObject({ type: ComponentType.StringSelect, custom_id: "s:1" });
    });
});
