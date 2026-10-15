// The Empfehlungen tab and the player page's own recommendations.
const { renderReportPage, renderPlayerPage } = require("../../../src/web/report/render.js");

function report(review) {
    return {
        id: "abc123def456",
        title: "Test Raid",
        players: [{ name: "Farin", type: "Warlock", issues: [] }, { name: "Clean", type: "Mage", issues: [] }],
        roster: [
            { name: "Farin", type: "Warlock", issues: [], potions: {}, armory: [] },
            { name: "Clean", type: "Mage", issues: [], potions: {}, armory: [] },
        ],
        recommendations: {
            generatedAt: 1,
            raid: [{ key: "raid.earlyDeaths", impact: "high", title: "2 Tode in den ersten 30 Sekunden", text: "Pull sauberer.", evidence: [{ label: "Frühe Tode", value: "2" }] }],
            players: [
                { name: "Farin", type: "Warlock", items: [
                    { key: "gear", impact: "high", title: "2 Gear-Probleme", text: "Gear fertig machen.", evidence: [{ label: "Hood", value: "keine Verzauberung" }] },
                    { key: "consumables.food", impact: "low", title: "Essen 80 %", text: "Essen erneuern.", evidence: [] },
                ] },
                { name: "Clean", type: "Mage", items: [] },
            ],
        },
        recommendationReview: review,
    };
}

const admin = { id: "u1", name: "Lead", isAdmin: true };
const writer = { id: "u2", name: "Officer", isAdmin: false, access: { cla: { read: true, write: true } } };
const reader = { id: "u3", name: "Member", isAdmin: false, access: { loot: { read: true } } };

describe("web/report/render — Empfehlungen for a reviewer", () => {
    it("shows every finding with verdict controls, the open count in the KPI card and the raid section", () => {
        const html = renderReportPage(report(null), admin);
        // the raid findings sit under "Das Wichtigste" above the views, with the one send button
        expect(html).toContain("<section class=\"key-findings\" id=\"rs-rec-raid\">");
        expect(html).not.toContain("Offene Empfehlungen");
        expect(html).toContain("<h2>Das Wichtigste</h2>");
        expect(html).toContain("<span class=\"sub\">1 Punkt für den ganzen Raid · 1 offen · 0 freigegeben</span>");
        expect(html).toContain("2 Tode in den ersten 30 Sekunden");
        expect(html).toContain("data-scope=\"raid\" data-player=\"\" data-key=\"raid.earlyDeaths\"");
        expect(html).toContain("data-scope=\"player\" data-player=\"Farin\" data-key=\"gear\"");
        expect(html).toContain("data-review=\"approve\"");
        // one row per finding: impact, title, evidence badges, status, three icon buttons
        expect(html).toContain("<span class=\"badge ev-b\" data-tip=\"Hood\" data-tip-sub=\"keine Verzauberung\">Hood <b>keine Verzauberung</b></span>");
        expect(html).toContain("<span class=\"badge rec-state mid\">offen</span>");
        expect(html).toContain("data-tip=\"Freigeben\"");
        expect(html).toContain("data-tip=\"Nicht senden\"");
        expect(html).toContain("data-tip=\"Text bearbeiten\"");
        expect(html).toContain("Nichts auszusetzen – weiter so.");
        expect(html).toContain("<script src=\"/r-assets/report.js?v=");
    });

    it("reflects the review: state, buttons and the rewritten text", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true, text: "Bitte vor dem Raid verzaubern." }, "consumables.food": { approved: false } } } }), admin);
        // a raider's points are open blocks: the own text with its tag, under "Geht so an …"
        expect(html).toContain("class=\"rec rec-block rec-high rec-state-approved\" data-key=\"gear\"");
        expect(html).toContain("<span class=\"kicker\">Geht so an Farin</span><p><span class=\"rec-source own\">Eigener Text</span><span class=\"rec-body\">Bitte vor dem Raid verzaubern.</span></p>");
        expect(html).toContain("class=\"rec rec-block rec-low rec-state-rejected\" data-key=\"consumables.food\"");
        expect(html).toContain("<span class=\"sub\">1 Punkt für den ganzen Raid · 1 offen · 0 freigegeben</span>"); // only the raid finding is still open
        // the active verdict is a filled, pressed button with its label
        expect(html).toContain("<button type=\"button\" class=\"btn btn-sm btn-yes rec-yes ok\" data-review=\"approve\" aria-pressed=\"true\"");
        expect(html).toContain("<span class=\"lbl\">Freigegeben</span>");
        expect(html).toContain("<button type=\"button\" class=\"btn btn-sm btn-no rec-no bad\" data-review=\"reject\" aria-pressed=\"true\"");
        expect(html).toContain("<textarea class=\"rec-text\" rows=\"3\" placeholder=\"Eigene Formulierung (leer = Vorschlag so lassen)\">Bitte vor dem Raid verzaubern.</textarea>");
        expect(html).toContain("data-review=\"rule\"");
    });

    it("puts the raider's own points into their card: chip, section with controls and the footer", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html).toContain("data-name=\"Farin\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("<span class=\"badge pending\" data-tip=\"Befunde, die noch niemand freigegeben oder verworfen hat\"><span class=\"dot\" aria-hidden=\"true\"></span>1 Punkt zu prüfen</span>");
        expect(html).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">1 offen<\/span>/);
        expect(html).toContain("<b class=\"rf-count\">1 von 2 Punkten geprüft</b>");
        expect(html).toContain("<span class=\"note\">Zuletzt gesendet: nie</span>");
        // without gear issues in the report the gear finding keeps its evidence badges
        expect(html).toContain("<span class=\"badge ev-b\" data-tip=\"Hood\" data-tip-sub=\"keine Verzauberung\">Hood <b>keine Verzauberung</b></span>");
        expect(html).toContain("data-phrase=\"player\"");
        expect(html).toMatch(/data-dialog="send-0"><img class="hicon"[^>]*>Vorschau &amp; senden<\/button>/);
        // a clean raider says so instead of showing nothing
        expect(html).toContain("Nichts auszusetzen – weiter so.");
        expect(html).toContain("data-name=\"Clean\" data-role=\"dps\" data-open=\"0\"");
    });

    it("lets a role with write access to the CLA area review as well", () => {
        const html = renderReportPage(report(null), writer);
        expect(html).toContain("data-review=\"approve\"");
    });
});

describe("web/report/render — Empfehlungen for everyone else", () => {
    it("hides the raid section while nothing is approved, then shows only the approved items without controls", () => {
        expect(renderReportPage(report(null), reader)).not.toContain("id=\"rs-rec-raid\"");
        expect(renderReportPage(report(null), null)).not.toContain("id=\"rs-rec-raid\"");
        expect(renderReportPage(report(null), reader)).not.toContain("2 Gear-Probleme");
        const html = renderReportPage(report({ raid: { "raid.earlyDeaths": { approved: true } }, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(html).toContain("id=\"rs-rec-raid\"");
        expect(html).toContain("<h2>Das Wichtigste</h2><span class=\"sub\">1 Punkt von der Raidleitung</span>");
        expect(html).not.toContain("Offene Empfehlungen");
        expect(html).toContain("2 Gear-Probleme");
        expect(html).not.toContain("Essen 80 %");
        expect(html).not.toContain("data-review=");
        expect(html).not.toContain("dlg-rs-send");
        // a raider without approved findings gets no section, no footer
        expect(html).not.toContain("Nichts auszusetzen");
        expect(html).not.toContain("class=\"raider-foot\"");
    });

    it("leaves the recommendations out of a report from before the rules", () => {
        const r = report(null);
        delete r.recommendations;
        const html = renderReportPage(r, admin);
        expect(html).not.toContain("id=\"rs-rec-raid\"");
        expect(html).not.toContain("Offene Empfehlungen");
        expect(html).not.toContain("<b>1</b> Empfehlungen");
    });
});

describe("web/report/render — player page", () => {
    it("shows the raider their approved items only, and a reviewer all of them with controls", () => {
        const review = { raid: {}, players: { Farin: { gear: { approved: true } } } };
        const own = renderPlayerPage(report(review), 0, reader);
        // their points come first, under their own head
        expect(own).toContain("<b>Deine Punkte für den nächsten Raid</b><span class=\"kicker\">Farin › Empfehlungen · von der Raidleitung geprüft</span>");
        expect(own.indexOf("id=\"p-points\"")).toBeLessThan(own.indexOf("id=\"p-prep\""));
        // every point shows its text, from the raid lead, without verdicts
        expect(own).toContain("<div class=\"rec rec-block rec-high rec-state-approved\" data-key=\"gear\">");
        expect(own).toContain("<span class=\"kicker\">Von der Raidleitung</span>");
        expect(own).toContain("2 Gear-Probleme");
        expect(own).not.toContain("Essen 80 %");
        expect(own).not.toContain("data-review=");
        const mine = renderPlayerPage(report(review), 0, admin);
        expect(mine).toContain("Essen 80 %");
        expect(mine).toContain("data-review=\"reject\"");
        expect(mine).toContain("<script src=\"/r-assets/report.js?v=");
        // nothing approved, nothing to show
        expect(renderPlayerPage(report(null), 0, reader)).toContain("Noch keine freigegebenen Punkte.");
        expect(renderPlayerPage(report(review), 1, admin)).toContain("Nichts auszusetzen – weiter so.");
    });
});
