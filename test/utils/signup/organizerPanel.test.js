// Der Raider-Organizer (src/utils/signup/organizerPanel.js): das Panel einer Raid-Kategorie
// als Components-V2-Nachricht und die persönlichen Antworten "Mein Raid" und "Auswertung".
const { organizerPayload, myRaidPayload, myReportPayload, MAX_LINKS } = require("../../../src/utils/signup/organizerPanel");

const V2_FLAG = 32768;
const START = 1900000000;

const container = (payload) => payload.components[0];
// every component of the container, depth first
function walk(node, out = []) {
    out.push(node);
    for (const child of [...(node.components || []), ...(node.accessory ? [node.accessory] : [])]) walk(child, out);
    return out;
}
const all = (payload) => walk(container(payload));
const texts = (payload) => all(payload).filter((c) => c.type === 10).map((c) => c.content);
const buttons = (payload) => all(payload).filter((c) => c.type === 2);
const customIds = (payload) => buttons(payload).map((b) => b.custom_id).filter(Boolean);
const linkButtons = (payload) => buttons(payload).filter((b) => b.style === 5);
const embedOf = (payload) => payload.embeds[0].data || payload.embeds[0];
const rowButtons = (payload) => payload.components.flatMap((r) => r.toJSON().components);

describe("organizerPayload", () => {
    const base = { categoryId: "cat1", categoryName: "╭・ TBC Montag", nextRaid: { startTime: START, attending: 18 } };

    it("ist eine Components-V2-Nachricht mit einem blauen Container und ohne Embeds", () => {
        const payload = organizerPayload(base);
        expect(payload.flags).toBe(V2_FLAG);
        expect(payload.embeds).toEqual([]);
        expect(payload.components).toHaveLength(1);
        expect(container(payload)).toMatchObject({ type: 17, accent_color: 0x1ea1f1 });
    });

    it("nennt die Kategorie ohne Deko, auf Deutsch als Standard", () => {
        expect(texts(organizerPayload(base))[0]).toBe("## Raid-Zentrale · TBC Montag\n-# Alles für deine TBC Montag-Raids an einem Ort");
        expect(texts(organizerPayload({ categoryId: "cat1" }))[0]).toBe("## Raid-Zentrale\n-# Alles für deine Raids an einem Ort");
    });

    it("spricht Englisch mit lang en", () => {
        const payload = organizerPayload({ ...base, lang: "en" });
        expect(texts(payload)[0]).toBe("## Raid hub · TBC Montag\n-# Everything for your TBC Montag raids in one place");
        expect(texts(payload).join("\n")).toContain("**Next raid**");
        expect(texts(payload).join("\n")).toContain("Personal answers are only visible to you");
        expect(buttons(payload).map((b) => b.label)).toEqual(["My raid", "Mark absent", "Mark attending", "My entries", "Evaluation"]);
    });

    it("trägt die fünf Knöpfe in der Reihenfolge, in der sie im Panel stehen (r, a, p, l, o)", () => {
        const ids = customIds(organizerPayload(base));
        // the section's button comes first (the next raid sits above the absence row)
        expect(ids).toEqual(["availability:r:cat1", "availability:a:cat1", "availability:p:cat1", "availability:l:cat1", "availability:o:cat1"]);
        expect(buttons(organizerPayload(base)).map((b) => b.label)).toEqual(["Mein Raid", "Abwesend eintragen", "Dabei eintragen", "Meine Einträge", "Auswertung"]);
    });

    it("zeigt den nächsten Raid mit Discord-Zeitstempeln und der Zahl der Anmeldungen", () => {
        const payload = organizerPayload(base);
        const section = all(payload).find((c) => c.type === 9);
        expect(section.components[0].content).toBe(`📅 **Nächster Raid** · <t:${START}:d> <t:${START}:t>\n-# <t:${START}:R> · 18 angemeldet`);
        expect(section.accessory).toMatchObject({ type: 2, style: 1, custom_id: "availability:r:cat1", label: "Mein Raid" });
    });

    it("nimmt das Datums-Icon des Bots statt 📅, wenn es hochgeladen ist", () => {
        const payload = organizerPayload({ ...base, emojis: { eh_ui_date: { id: "3", name: "eh_ui_date" } } });
        const section = all(payload).find((c) => c.type === 9);
        expect(section.components[0].content).toMatch(/^<:eh_ui_date:3> \*\*Nächster Raid\*\*/);
    });

    it("ohne nächsten Raid fehlt der Mein-Raid-Knopf, der Text sagt es", () => {
        for (const nextRaid of [null, undefined, { startTime: 0, attending: 0 }]) {
            const payload = organizerPayload({ categoryId: "cat1", nextRaid });
            expect(customIds(payload)).toEqual(["availability:a:cat1", "availability:p:cat1", "availability:l:cat1", "availability:o:cat1"]);
            expect(texts(payload)).toContain("📅 **Nächster Raid**\n-# Noch kein Raid geplant.");
        }
        expect(texts(organizerPayload({ categoryId: "c", lang: "en" }))).toContain("📅 **Next raid**\n-# No raid planned yet.");
    });

    it("hat die Auswertung als Bereich mit Knopf und trennt die Bereiche mit Linien", () => {
        const payload = organizerPayload(base);
        const sections = all(payload).filter((c) => c.type === 9);
        expect(sections).toHaveLength(2);
        expect(sections[1].components[0].content).toContain("📊 **Deine Auswertung**");
        expect(sections[1].accessory).toMatchObject({ custom_id: "availability:o:cat1", label: "Auswertung" });
        const separators = all(payload).filter((c) => c.type === 14);
        expect(separators.filter((s) => s.divider === true && s.spacing === 2).length).toBeGreaterThanOrEqual(3);
        expect(separators.filter((s) => s.divider === false && s.spacing === 1).length).toBeGreaterThanOrEqual(1);
        expect(texts(payload).at(-1)).toBe("-# Persönliche Antworten siehst nur du");
    });

    it("zeigt Link-Knöpfe nur, wenn es Links gibt", () => {
        expect(linkButtons(organizerPayload(base))).toEqual([]);
        expect(texts(organizerPayload(base)).join("\n")).not.toContain("Links");
        const payload = organizerPayload({ ...base, links: [{ label: "WCL", url: "https://wcl.example/a" }, { label: "Sheet", url: "https://sheet.example" }] });
        expect(linkButtons(payload).map((b) => [b.label, b.url])).toEqual([["WCL", "https://wcl.example/a"], ["Sheet", "https://sheet.example"]]);
        expect(texts(payload)).toContain("🔗 **Links**");
        // link buttons carry no custom id
        expect(customIds(payload)).toHaveLength(5);
    });

    it("zeigt höchstens fünf Links und lässt unvollständige weg", () => {
        const links = Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, url: `https://x.example/${i}` }));
        expect(MAX_LINKS).toBe(5);
        expect(linkButtons(organizerPayload({ ...base, links }))).toHaveLength(5);
        const partial = organizerPayload({ ...base, links: [{ label: "", url: "https://x.example" }, { label: "Ohne", url: "" }, null] });
        expect(linkButtons(partial)).toEqual([]);
        expect(texts(partial).join("\n")).not.toContain("🔗");
    });

    it("kommt ohne Angaben aus", () => {
        const payload = organizerPayload();
        expect(payload.flags).toBe(V2_FLAG);
        expect(customIds(payload)).toEqual(["availability:a:", "availability:p:", "availability:l:", "availability:o:"]);
    });
});

describe("myRaidPayload", () => {
    const event = { title: "Karazhan", startTime: START };
    const urls = { signupUrl: "https://discord.example/m", planUrl: "https://eh.example/p/abc" };
    const description = (payload) => embedOf(payload).description;

    it("nennt Titel mit Kategorie, Zeit und die Anmeldung", () => {
        const payload = myRaidPayload({ event, signup: { status: "signed", character: "Zibbo" }, specText: "Heilig", categoryName: "╭・ TBC Montag" });
        expect(embedOf(payload).title).toBe("Karazhan · TBC Montag");
        expect(description(payload)).toBe(`📅 <t:${START}:d> <t:${START}:t> · <t:${START}:R>\n\nDu bist als **Zibbo** · Heilig angemeldet.`);
        expect(payload.components).toEqual([]);
    });

    // The bot's own icons where it has them: spec icon before the name, status and date icons.
    it("zeigt Spec-, Status- und Datums-Icon des Bots, wenn es sie gibt", () => {
        const emojis = {
            eh_mage_arcane: { id: "1", name: "eh_mage_arcane" },
            eh_ui_signed: { id: "2", name: "eh_ui_signed" },
            eh_ui_date: { id: "3", name: "eh_ui_date" },
        };
        const payload = myRaidPayload({ event, signup: { status: "signed", character: "Devire" }, specText: "Arkan", specKey: "Mage-Arcane", emojis });
        expect(description(payload)).toBe(`<:eh_ui_date:3> <t:${START}:d> <t:${START}:t> · <t:${START}:R>\n\n<:eh_ui_signed:2> Du bist als **<:eh_mage_arcane:1> Devire** · Arkan angemeldet.`);
        // an unknown spec or a missing emoji: just the name, no gap
        const plain = myRaidPayload({ event, signup: { status: "signed", character: "Devire" }, specText: "Arkan", specKey: "Mage-Fire", emojis: {} });
        expect(description(plain)).toContain("Du bist als **Devire** · Arkan angemeldet.");
        // no signup: no status icon
        expect(description(myRaidPayload({ event, emojis })).split("\n\n")[1]).toBe("Du bist noch nicht angemeldet.");
    });

    it.each([
        ["signed", "Du bist als **Zibbo** · Heilig angemeldet."],
        ["late", "Du bist als **Zibbo** · Heilig angemeldet, kommst aber später."],
        ["tentative", "Du bist als **Zibbo** · Heilig vorläufig angemeldet."],
        ["bench", "Du stehst mit **Zibbo** · Heilig auf der Ersatzbank."],
    ])("sagt den Status %s", (status, line) => {
        const payload = myRaidPayload({ event, signup: { status, character: "Zibbo" }, specText: "Heilig" });
        expect(description(payload).split("\n\n")[1]).toBe(line);
    });

    it("sagt eine Abmeldung und eine fehlende Anmeldung", () => {
        expect(description(myRaidPayload({ event, signup: { status: "absence" } }))).toContain("Du hast dich für diesen Raid abgemeldet.");
        expect(description(myRaidPayload({ event, signup: null }))).toContain("Du bist noch nicht angemeldet.");
    });

    it("nimmt einen unbekannten Status wie Dabei und füllt fehlende Angaben mit ?", () => {
        expect(description(myRaidPayload({ event, signup: { status: "weird" } }))).toContain("**?** · ?");
    });

    it("spricht Englisch", () => {
        const payload = myRaidPayload({ event, signup: null, signupUrl: urls.signupUrl, lang: "en" });
        expect(description(payload)).toContain("You are not signed up yet.");
        expect(rowButtons(payload).map((b) => b.label)).toEqual(["Sign up"]);
    });

    it("hat Anmelden bzw. Zur Anmeldung und den Raidplan als Link-Knöpfe, je nach Adresse", () => {
        const none = rowButtons(myRaidPayload({ event, signup: null, ...urls }));
        expect(none.map((b) => [b.label, b.url, b.style])).toEqual([["Anmelden", urls.signupUrl, 5], ["Raidplan", urls.planUrl, 5]]);
        const signedUp = rowButtons(myRaidPayload({ event, signup: { status: "signed", character: "Z" }, ...urls }));
        expect(signedUp.map((b) => b.label)).toEqual(["Zur Anmeldung", "Raidplan"]);
        expect(rowButtons(myRaidPayload({ event, signup: null, signupUrl: urls.signupUrl })).map((b) => b.label)).toEqual(["Anmelden"]);
        expect(rowButtons(myRaidPayload({ event, signup: null, planUrl: urls.planUrl })).map((b) => b.label)).toEqual(["Raidplan"]);
        expect(myRaidPayload({ event, signup: null }).components).toEqual([]);
    });

    it("ohne Raid: ein Satz und keine Knöpfe", () => {
        const payload = myRaidPayload({ event: null, ...urls });
        expect(embedOf(payload)).toMatchObject({ title: "Nächster Raid", description: "Noch kein Raid geplant." });
        expect(payload.components).toEqual([]);
        expect(embedOf(myRaidPayload({ lang: "en" }))).toMatchObject({ title: "Next raid", description: "No raid planned yet." });
    });

    it("nimmt ohne Titel nur die Kategorie, ohne beides den Standardtitel", () => {
        expect(embedOf(myRaidPayload({ event: { startTime: START }, categoryName: "Raids" })).title).toBe("Raids");
        expect(embedOf(myRaidPayload({ event: { startTime: START } })).title).toBe("Nächster Raid");
    });
});

describe("myReportPayload", () => {
    const report = { title: "Karazhan Clear", generatedAt: START * 1000, character: "Zibbo" };

    it("nennt Auswertung, Datum und Charakter, mit Knöpfen zur Auswertung und zum Profil", () => {
        const payload = myReportPayload({ report, reportUrl: "https://eh.example/r/abc/p/2", profileUrl: "https://eh.example/profile" });
        expect(embedOf(payload).title).toBe("Deine Auswertung");
        expect(embedOf(payload).description).toBe(`**Karazhan Clear** · <t:${START}:D>\nDein Charakter: **Zibbo**`);
        expect(rowButtons(payload).map((b) => [b.label, b.url, b.style])).toEqual([
            ["Auswertung öffnen", "https://eh.example/r/abc/p/2", 5],
            ["Mein Profil", "https://eh.example/profile", 5],
        ]);
    });

    it("ohne Auswertung steht der Hinweis da und nur das Profil ist verlinkt", () => {
        const payload = myReportPayload({ report: null, reportUrl: "https://eh.example/r/abc", profileUrl: "https://eh.example/profile" });
        expect(embedOf(payload).description).toContain("Noch keine Auswertung mit einem deiner Charaktere.");
        expect(rowButtons(payload).map((b) => b.label)).toEqual(["Mein Profil"]);
    });

    it("lässt Knöpfe ohne Adresse weg", () => {
        expect(myReportPayload({ report, profileUrl: "https://eh.example/profile" }).components).toHaveLength(1);
        expect(rowButtons(myReportPayload({ report, profileUrl: "https://eh.example/profile" })).map((b) => b.label)).toEqual(["Mein Profil"]);
        expect(myReportPayload({ report }).components).toEqual([]);
        expect(myReportPayload().components).toEqual([]);
    });

    it("spricht Englisch und kommt ohne Datum und Titel aus", () => {
        const payload = myReportPayload({ report: { character: "Zibbo", generatedAt: 0 }, reportUrl: "https://x.example", lang: "en" });
        expect(embedOf(payload).title).toBe("Your evaluation");
        expect(embedOf(payload).description).toBe("**Raid** · \nYour character: **Zibbo**");
        expect(rowButtons(payload).map((b) => b.label)).toEqual(["Open evaluation"]);
        expect(embedOf(myReportPayload({ lang: "en" })).description).toContain("No evaluation with one of your characters yet.");
    });
});
