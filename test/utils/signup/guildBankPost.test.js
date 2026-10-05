const { ButtonStyle } = require("discord.js");
const post = require("../../../src/utils/signup/guildBankPost");
const { cardText } = require("../../helpers/cardText");

const REQUEST = {
    id: "abc123", userId: "200000000000000001", userName: "Anna_*", categoryId: "cat1",
    item: "Super Mana Potion", amount: 12, purpose: "BT Donnerstag", status: "open", reason: "",
    createdAt: 1_800_000_000_000, handledBy: "", handledByName: "", handledAt: 0,
};

const inputs = (modal) => modal.toJSON().components.map((row) => row.components[0]);

describe("utils/signup/guildBankPost", () => {
    it("builds the raider's modal in their language", () => {
        const de = post.requestModal("cat1", "de").toJSON();
        expect(de.custom_id).toBe("availability:mb:cat1");
        expect(de.title).toBe("Gildenbank-Anfrage");
        expect(inputs(post.requestModal("cat1", "de")).map((c) => [c.custom_id, c.label, c.required, c.max_length])).toEqual([
            ["item", "Was brauchst du?", true, 80],
            ["amount", "Wie viel?", true, 6],
            ["purpose", "Wofür? (optional)", false, 100],
        ]);
        expect(post.requestModal("cat1", "en").toJSON().title).toBe("Guild bank request");
        expect(inputs(post.requestModal("", "en"))[0].label).toBe("What do you need?");
    });

    it("sums a request up for the raider, with what it is for when given", () => {
        expect(post.requestSummary(REQUEST, "de")).toBe("**12× Super Mana Potion**\nWofür: BT Donnerstag");
        expect(post.requestSummary({ ...REQUEST, purpose: "" }, "en")).toBe("**12× Super Mana Potion**");
    });

    it("writes the DM in the raider's language", () => {
        expect(cardText(post.decisionCard({ ...REQUEST, status: "done" }, "de"))).toBe("-# Gildenbank\n## Anfrage erledigt\n**12× Super Mana Potion**");
        expect(cardText(post.decisionCard({ ...REQUEST, status: "done" }, "en"))).toBe("-# Guild bank\n## Request done\n**12× Super Mana Potion**");
        expect(cardText(post.decisionCard({ ...REQUEST, status: "rejected", reason: "leer" }, "en"))).toBe("-# Guild bank\n## Request declined\n**12× Super Mana Potion**\nReason: leer");
        expect(cardText(post.decisionCard({ ...REQUEST, status: "rejected" }, "de"))).toBe("-# Gildenbank\n## Anfrage abgelehnt\n**12× Super Mana Potion**");
    });

    it("posts an open request to the orga in German, amber, with both buttons", () => {
        const payload = post.orgaPayload(REQUEST, { categoryName: "╭・ TBC Montag" });
        const [embed] = payload.embeds;
        expect(embed.title).toBe("🏦 Anfrage von Anna\\_\\*");
        expect(embed.color).toBe(0xe8a33d);
        expect(embed.description).toBe("<@200000000000000001> · <t:1800000000:R>");
        expect(embed.fields).toEqual([
            { name: "Gegenstand", value: "Super Mana Potion", inline: true },
            { name: "Menge", value: "12", inline: true },
            { name: "Wofür", value: "BT Donnerstag", inline: true },
        ]);
        expect(embed.footer.text).toBe("TBC Montag · offen");
        const buttons = payload.components[0].components;
        expect(buttons.map((b) => [b.custom_id, b.label, b.style])).toEqual([
            ["guildbank:done:abc123", "Erledigt", ButtonStyle.Success],
            ["guildbank:reject:abc123", "Ablehnen …", ButtonStyle.Secondary],
        ]);
    });

    it("shows the status line instead of the buttons once handled", () => {
        const done = post.orgaPayload({ ...REQUEST, purpose: "", status: "done", handledByName: "Orga", handledAt: 1_800_000_100_000 });
        expect(done.components).toEqual([]);
        expect(done.embeds[0].description).toContain("✅ Erledigt von Orga · <t:1800000100:R>");
        expect(done.embeds[0].fields[2].value).toBe("—");
        expect(done.embeds[0].footer.text).toBe("erledigt");
        const rejected = post.orgaPayload({ ...REQUEST, status: "rejected", handledByName: "Orga", reason: "nicht da" });
        expect(rejected.embeds[0].description).toContain("⛔ Abgelehnt von Orga: nicht da");
        expect(post.statusLine({ ...REQUEST, status: "rejected", handledByName: "" })).toBe("⛔ Abgelehnt von ?");
        expect(post.statusLine(REQUEST)).toBe("");
    });

    it("builds the orga's decline modal and reads its ids", () => {
        const modal = post.rejectModal("abc123").toJSON();
        expect(modal.custom_id).toBe("guildbank:mreject:abc123");
        expect(modal.title).toBe("Anfrage ablehnen");
        expect(modal.components[0].components[0]).toMatchObject({ custom_id: "reason", label: "Grund (optional, der Raider sieht ihn)", required: false, max_length: 200 });
        expect(post.parseOrgaId("guildbank:done:abc123")).toEqual({ action: "done", id: "abc123" });
        expect(post.parseOrgaId(undefined)).toEqual({ action: "", id: "" });
    });

    it("keeps typed text plain: no markdown, no mentions", () => {
        expect(post.plain("**@everyone** [x](y)")).toBe("\\*\\*@​everyone\\*\\* \\[x\\]\\(y\\)");
    });
});
