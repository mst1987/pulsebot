const { ButtonStyle } = require("discord.js");
const post = require("../../../src/utils/signup/guildBankPost");
const { cardText, cardButtons, cardColor } = require("../../helpers/cardText");
const { isCardPayload } = require("../../helpers/card");

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

    it("posts an open free-text request to the orga as a card in German, amber, with Erledigt and Ablehnen", () => {
        const payload = post.orgaPayload(REQUEST, { categoryName: "╭・ TBC Montag" });
        expect(isCardPayload(payload)).toBe(true);
        expect(cardColor(payload)).toBe(0xe8a33d);
        expect(cardText(payload)).toBe([
            "-# Gildenbank",
            "## 12× Super Mana Potion",
            "<@200000000000000001> · <t:1800000000:R>",
            "Wofür: BT Donnerstag",
            "-# TBC Montag · offen",
        ].join("\n"));
        expect(cardButtons(payload).map((b) => [b.custom_id, b.label, b.style])).toEqual([
            ["guildbank:done:abc123", "Erledigt", ButtonStyle.Success],
            ["guildbank:reject:abc123", "Ablehnen …", ButtonStyle.Secondary],
        ]);
        expect(payload.allowedMentions).toEqual({ parse: [] });
    });

    it("shows the status note instead of the buttons once handled", () => {
        const done = post.orgaPayload({ ...REQUEST, purpose: "", status: "done", handledByName: "Orga", handledAt: 1_800_000_100_000 });
        expect(cardButtons(done)).toEqual([]);
        expect(cardText(done)).toContain("-# ✅ Erledigt von Orga · <t:1800000100:R>");
        expect(cardText(done)).not.toContain("Wofür");
        expect(cardColor(done)).toBe(post.COLOR_DONE);
        const rejected = post.orgaPayload({ ...REQUEST, status: "rejected", handledByName: "Orga", reason: "nicht da" });
        expect(cardText(rejected)).toContain("⛔ Abgelehnt von Orga: nicht da");
        expect(cardColor(rejected)).toBe(post.COLOR_REJECTED);
        expect(post.statusLine({ ...REQUEST, status: "rejected", handledByName: "" })).toBe("⛔ Abgelehnt von ?");
        expect(post.statusLine(REQUEST)).toBe("");
    });

    describe("a request from the stock", () => {
        const STOCK_REQUEST = {
            ...REQUEST, item: "Bold Living Ruby", amount: 2, purpose: "Gruul", bankKey: "tbc:x:y", itemId: 32193,
            icon: "inv_jewelcrafting_livingruby_03", group: "Edelsteine", characterName: "Zibbo", realm: "Spine Shatter",
        };
        const STOCK = { count: 14, reserved: 4, available: 10, group: "Edelsteine", icon: "inv_jewelcrafting_livingruby_03" };

        it("open: kicker with the group, icon, the stock's numbers with 'danach', Bestätigen and Ablehnen", () => {
            const payload = post.orgaPayload(STOCK_REQUEST, { categoryName: "TBC Montag", stock: STOCK });
            expect(cardText(payload)).toBe([
                "-# Gildenbank · Edelsteine",
                "## 2× Bold Living Ruby",
                "<@200000000000000001> · <t:1800000000:R>",
                "Wofür: Gruul",
                "An: Zibbo-SpineShatter",
                "**Bestand** 14 · **Vorgemerkt** 4 · **Verfügbar** 10 (danach 8)",
                "-# TBC Montag · offen",
            ].join("\n"));
            const section = payload.components[0].components.find((c) => c.type === 9);
            expect(section.accessory.media.url).toBe("https://wow.zamimg.com/images/wow/icons/large/inv_jewelcrafting_livingruby_03.jpg");
            expect(cardButtons(payload).map((b) => [b.custom_id, b.label, b.style])).toEqual([
                ["guildbank:confirm:abc123", "Bestätigen", ButtonStyle.Success],
                ["guildbank:reject:abc123", "Ablehnen …", ButtonStyle.Secondary],
            ]);
            expect(cardColor(payload)).toBe(post.COLOR_OPEN);
        });

        it("confirmed: blue, no 'danach', Ausgegeben and Vormerkung lösen, who set it aside", () => {
            const payload = post.orgaPayload({ ...STOCK_REQUEST, status: "confirmed", handledByName: "Arthas" }, { stock: { ...STOCK, reserved: 6, available: 8 } });
            expect(cardColor(payload)).toBe(post.COLOR_CONFIRMED);
            expect(cardText(payload)).toContain("**Bestand** 14 · **Vorgemerkt** 6 · **Verfügbar** 8\n");
            expect(cardText(payload)).toContain("-# Vorgemerkt von Arthas · wartet auf Ausgabe im Spiel");
            expect(cardButtons(payload).map((b) => [b.custom_id, b.label])).toEqual([
                ["guildbank:handout:abc123", "Ausgegeben"],
                ["guildbank:release:abc123", "Vormerkung lösen"],
            ]);
        });

        it("handed out: green, no numbers, no buttons, how it went out", () => {
            const out = { ...STOCK_REQUEST, status: "handedOut", handledByName: "Arthas", handedOutByName: "Jaina" };
            for (const [via, note] of [["discord", "ausgegeben von Jaina"], ["manual", "ausgegeben von Jaina · im Spiel abgehakt"], ["mail", "per Post ausgegeben von Jaina"]]) {
                const payload = post.orgaPayload({ ...out, handoutVia: via }, { stock: STOCK });
                expect(cardText(payload)).toContain(`-# ${note}`);
                expect(cardText(payload)).not.toContain("Bestand");
                expect(cardButtons(payload)).toEqual([]);
                expect(cardColor(payload)).toBe(post.COLOR_DONE);
            }
        });

        it("falls back to the request's own group and icon when the bank no longer knows the item", () => {
            const payload = post.orgaPayload(STOCK_REQUEST, { stock: null });
            expect(cardText(payload)).toContain("-# Gildenbank · Edelsteine");
            expect(cardText(payload)).not.toContain("Bestand");
            expect(post.stockFacts({ ...STOCK_REQUEST, status: "rejected" }, STOCK)).toEqual([]);
        });

        it("names the recipient for the raider and in the DMs of confirmation and hand-out", () => {
            expect(post.requestSummary(STOCK_REQUEST, "en")).toBe("**2× Bold Living Ruby**\nFor: Gruul\nTo: Zibbo-SpineShatter");
            expect(post.recipientName({ characterName: "Zibbo" })).toBe("Zibbo");
            expect(post.recipientName({})).toBe("");
            const confirmed = post.decisionCard({ ...STOCK_REQUEST, status: "confirmed" }, "de");
            expect(cardText(confirmed)).toBe("-# Gildenbank\n## Anfrage bestätigt\n**2× Bold Living Ruby**\nFür dich vorgemerkt – du bekommst es bald im Spiel.\nAn: Zibbo-SpineShatter");
            expect(cardColor(confirmed)).toBe(post.COLOR_CONFIRMED);
            expect(cardText(post.decisionCard({ ...STOCK_REQUEST, status: "handedOut", handoutVia: "discord" }, "en")))
                .toBe("-# Guild bank\n## Request handed out\n**2× Bold Living Ruby**\nHanded out to Zibbo-SpineShatter.");
            expect(cardText(post.decisionCard({ ...STOCK_REQUEST, status: "handedOut", handoutVia: "mail" }, "de")))
                .toBe("-# Gildenbank\n## Anfrage ausgegeben\n**2× Bold Living Ruby**\nPer Post an Zibbo-SpineShatter geschickt.");
            expect(cardText(post.decisionCard({ ...STOCK_REQUEST, characterName: "", status: "handedOut", handoutVia: "mail" }, "en"))).toContain("Sent by mail.");
            expect(cardText(post.decisionCard({ ...STOCK_REQUEST, characterName: "", status: "handedOut" }, "en"))).toBe("-# Guild bank\n## Request handed out\n**2× Bold Living Ruby**");
        });
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
