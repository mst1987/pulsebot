// The findings on the report page (src/web/report/recommendations.js): review
// rights, one finding row, the raid's list and the "Alle senden" box.
const { IMPACT_LABEL, IMPACT_TONE, canReview, recItem, renderKeyFindings, renderSendBox } = require("../../../src/web/report/recommendations");

const item = (over = {}) => ({ key: "k1", impact: "high", title: "Flask fehlt", text: "Regeltext", approved: null, custom: "", evidence: [], ...over });

describe("web/report/recommendations", () => {
    it("labels and tones the impacts", () => {
        expect(IMPACT_LABEL).toEqual({ high: "hoch", medium: "mittel", low: "gering" });
        expect(IMPACT_TONE).toEqual({ high: "bad", medium: "mid", low: "" });
    });

    describe("canReview", () => {
        it("allows admins and CLA writers, nobody else", () => {
            expect(canReview(null)).toBe(false);
            expect(canReview({ isAdmin: true })).toBe(true);
            expect(canReview({ access: { cla: { write: true } } })).toBe(true);
            expect(canReview({ access: { cla: { read: true } } })).toBe(false);
            expect(canReview({ access: {} })).toBe(false);
            expect(canReview({})).toBe(false);
        });
    });

    describe("recItem", () => {
        it("shows a reader only the text and the expand control, no status for an open finding", () => {
            const html = recItem(item({ title: "A <b>", text: "Mach & tu" }), "raid", "", false);
            expect(html).toContain("<details class=\"rec rrow-d rec-high rec-state-open\" data-key=\"k1\">");
            expect(html).toContain("<span class=\"badge bad\">hoch</span>");
            expect(html).toContain("<span class=\"t rec-title\" data-tip=\"A &lt;b&gt;\">A &lt;b&gt;</span>");
            expect(html).toContain("<span class=\"st\"></span>");
            expect(html).toContain("<span class=\"acts\"><span class=\"exp-lbl\">");
            expect(html).toContain("<p class=\"rec-body\">Mach &amp; tu</p>");
            expect(html).not.toContain("data-review");
        });

        it("shows a reader the status of a decided finding", () => {
            expect(recItem(item({ approved: true }), "raid", "", false)).toContain("<span class=\"badge rec-state ok\">freigegeben</span>");
            expect(recItem(item({ approved: false }), "raid", "", false)).toContain("<span class=\"badge rec-state bad\">nicht senden</span>");
        });

        it("gives a reviewer the three verdict buttons, the active one toned, and the edit tools", () => {
            const html = recItem(item({ approved: true }), "player", "Elun", true, { open: true });
            expect(html).toContain("rec-state-approved\" data-key=\"k1\" open>");
            expect(html).toContain("<span class=\"acts rec-review\" data-scope=\"player\" data-player=\"Elun\" data-key=\"k1\">");
            expect(html).toContain("class=\"ibtn ok\" data-tip=\"Freigeben\"");
            expect(html).toContain("class=\"ibtn\" data-tip=\"Nicht senden\"");
            expect(html).toContain("data-review=\"edit\"");
            expect(html).toContain("Eigenen Text schreiben");
            expect(html).toContain("<textarea class=\"rec-text\" rows=\"3\" placeholder=\"Eigene Formulierung (leer = Vorschlag so lassen)\"></textarea>");
            // plain rule text: nothing to switch back to
            expect(html).not.toContain("Regeltext zeigen");
            expect(recItem(item({ approved: false }), "raid", "", true)).toContain("class=\"ibtn bad\" data-tip=\"Nicht senden\"");
            expect(recItem(item(), "raid", "", true)).toContain("<span class=\"badge rec-state mid\">offen</span>");
        });

        it("prefers the custom text over Claude's over the rule's, and marks the AI text", () => {
            const ai = recItem(item({ ai: "KI-Satz" }), "raid", "", true);
            expect(ai).toContain("<p class=\"rec-body\" data-tip=\"Regeltext\" data-tip-sub=\"Regeltext\"><span class=\"rec-source\"");
            expect(ai).toContain(">KI</span>KI-Satz</p>");
            expect(ai).toContain("Regeltext zeigen");
            expect(ai).toContain("<p class=\"rec-rule\" hidden><span class=\"rec-source\">Regel</span>Regeltext</p>");
            const custom = recItem(item({ ai: "KI-Satz", custom: "Mein <Text>" }), "raid", "", true);
            expect(custom).toContain("<p class=\"rec-body\">Mein &lt;Text&gt;</p>");
            expect(custom).toContain(">Mein &lt;Text&gt;</textarea>");
        });

        it("shows two evidence badges in the row and the next four in the body", () => {
            const evidence = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ label: `L${n}`, value: `V${n}` }));
            const html = recItem(item({ evidence, impact: "low" }), "raid", "", false);
            expect(html).toContain("<span class=\"ev\"><span class=\"badge ev-b\" data-tip=\"L1\" data-tip-sub=\"V1\">L1 <b>V1</b></span><span class=\"badge ev-b\" data-tip=\"L2\" data-tip-sub=\"V2\">L2 <b>V2</b></span></span>");
            expect(html).toContain("<div class=\"badges\"><span class=\"badge ev-b\">L3 <b>V3</b></span>");
            expect(html).toContain("L6 <b>V6</b>");
            expect(html).not.toContain("L7");
            expect(html).toContain("<span class=\"badge\">gering</span>");
        });

        it("falls back to the raw impact for an unknown one", () => {
            expect(recItem(item({ impact: "odd" }), "raid", null, true)).toContain("<span class=\"badge\">odd</span>");
        });
    });

    describe("renderKeyFindings", () => {
        const report = { id: "r1", recommendations: { raid: [], players: [{ name: "Elun", items: [{ key: "a" }] }] }, recommendationReview: { players: { Elun: { a: { approved: true } } } } };
        const raidItems = (specs) => specs.map(([key, impact, approved]) => item({ key, impact, title: `T-${key}`, approved }));
        const keys = (html) => [...html.matchAll(/<details class="rec [^"]*" data-key="([^"]+)"/g)].map((m) => m[1]);

        it("renders nothing without recommendations, and for a reader nothing without approved raid findings", () => {
            expect(renderKeyFindings(report, null, true)).toBe("");
            expect(renderKeyFindings(report, { raid: raidItems([["a", "high", null], ["b", "low", false]]), players: [] }, false)).toBe("");
            expect(renderKeyFindings(report, { raid: [], players: [] }, false)).toBe("");
        });

        it("heads the section with Das Wichtigste and counts open and approved points for a reviewer", () => {
            const html = renderKeyFindings(report, { raid: raidItems([["a", "high", null], ["b", "low", true], ["c", "low", true]]), players: [{ name: "Elun", items: [{ approved: true }] }, { name: "Dorn", items: [{ approved: null }] }] }, true);
            expect(html).toMatch(/^<section class="key-findings" id="rs-rec-raid">/);
            expect(html).toContain("<h2>Das Wichtigste</h2><span class=\"sub\">3 Punkte für den ganzen Raid · 1 offen · 2 freigegeben</span>");
            expect(html).toContain("<button type=\"button\" class=\"btn\" data-dialog=\"dlg-rs-send\">");
            expect(html).toContain("Empfehlungen senden …</button>");
            expect(html).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-send\">");
            expect(html).toContain("Empfehlungen senden</div>");
            expect(html).toContain("Versand · 1 Raider mit freigegebenen Punkten");
            expect(html).toContain("<div class=\"rec-send\" data-report=\"r1\">");
            expect(html).toContain("data-review=\"approve\"");
            // fewer than six: nothing folded
            expect(html).not.toContain("key-more");
        });

        it("says a single point in the singular", () => {
            const html = renderKeyFindings(report, { raid: raidItems([["a", "low", null]]), players: [] }, true);
            expect(html).toContain("1 Punkt für den ganzen Raid · 1 offen · 0 freigegeben");
        });

        it("sorts the findings high, medium, low (stable within an impact)", () => {
            const html = renderKeyFindings(report, { raid: raidItems([["l1", "low", null], ["m1", "medium", null], ["h1", "high", null], ["l2", "low", null], ["h2", "high", null]]), players: [] }, true);
            expect(keys(html)).toEqual(["h1", "h2", "m1", "l1", "l2"]);
        });

        it("shows the first five and folds the rest behind a count of the remaining points", () => {
            const specs = ["a", "b", "c", "d", "e", "f", "g"].map((k, i) => [k, i < 2 ? "low" : "high", null]);
            const html = renderKeyFindings(report, { raid: raidItems(specs), players: [] }, true);
            const [shown, more] = html.split("<details class=\"key-more\">");
            expect(keys(shown)).toEqual(["c", "d", "e", "f", "g"]);
            expect(more).toContain("<summary>2 weitere Punkte anzeigen</summary>");
            expect(keys(more)).toEqual(["a", "b"]);
            // exactly one over: singular
            const one = renderKeyFindings(report, { raid: raidItems(["a", "b", "c", "d", "e", "f"].map((k) => [k, "low", null])), players: [] }, true);
            expect(one).toContain("<summary>1 weiterer Punkt anzeigen</summary>");
            expect(keys(one.split("<details class=\"key-more\">")[1])).toEqual(["f"]);
        });

        it("gives a reader only the approved findings, counted as the raid lead's, without controls or dialog", () => {
            const html = renderKeyFindings(report, { raid: raidItems([["a", "high", null], ["b", "medium", true], ["c", "low", false], ["d", "low", true]]), players: [] }, false);
            expect(html).toContain("<h2>Das Wichtigste</h2><span class=\"sub\">2 Punkte von der Raidleitung</span>");
            expect(keys(html)).toEqual(["b", "d"]);
            expect(html).not.toContain("dlg-rs-send");
            expect(html).not.toContain("Empfehlungen senden");
            expect(html).not.toContain("data-review");
        });

        it("gives a reviewer without any raid finding the empty sentence and still the send button", () => {
            const html = renderKeyFindings(report, { raid: [], players: [] }, true);
            expect(html).toContain("<div class=\"rec-empty\">Nichts, was den ganzen Raid gekostet hätte.</div>");
            expect(html).toContain("0 Punkte für den ganzen Raid · 0 offen · 0 freigegeben");
            expect(html).toContain("data-dialog=\"dlg-rs-send\"");
        });
    });
    describe("renderSendBox", () => {
        const base = {
            id: "rep<1>",
            recommendations: {
                raid: [],
                players: [
                    { name: "Elun", items: [{ key: "a" }] },
                    { name: "Dorn", items: [{ key: "b" }] },
                    { name: "Brokk", items: [{ key: "c" }] },
                ],
            },
            recommendationReview: { players: { Elun: { a: { approved: true } }, Dorn: { b: { approved: true } }, Brokk: { c: { approved: false } } } },
            recommendationSent: { Elun: { at: "2026-09-01T10:00:00Z" } },
        };

        it("counts raiders with approved points and those already written to", () => {
            const html = renderSendBox(base);
            expect(html).toContain("<div class=\"rec-send\" data-report=\"rep&lt;1&gt;\">");
            expect(html).toContain("2 Raider mit freigegebenen Punkten</span>");
            expect(html).toContain("<span class=\"badge ok\">");
            expect(html).toContain("1 bereits angeschrieben</span>");
            expect(html).toContain("data-send=\"all\">");
            expect(html).not.toContain("rec-phrase-meta");
        });

        it("disables sending when nothing is approved", () => {
            const html = renderSendBox({ ...base, recommendationReview: {}, recommendationSent: undefined });
            expect(html).toContain("0 Raider mit freigegebenen Punkten");
            expect(html).toContain("0 bereits angeschrieben");
            expect(html).toContain("data-send=\"all\" disabled>");
        });

        it("shows the last phrasing job with its model, counts and errors", () => {
            const html = renderSendBox({ ...base, recommendationPhrase: { at: "2026-09-01T10:00:00Z", model: "claude", phrased: 5, players: 2, errors: ["x"] } });
            expect(html).toContain("class=\"badge accent rec-phrase-meta\" data-tip=\"KI-Formulierung vom 1.9.2026, 12:00:00\" data-tip-sub=\"claude: 5 Texte für 2 Raider, 1 Fehler\"");
            expect(html).toContain("5 KI-Texte</span>");
            const clean = renderSendBox({ ...base, recommendationPhrase: { at: 0, model: "m", phrased: 1, players: 1 } });
            expect(clean).toContain("data-tip-sub=\"m: 1 Texte für 1 Raider\"");
        });
    });
});
