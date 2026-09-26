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
        expect(html).toContain("<section class=\"gcard\" id=\"rs-rec-raid\">");
        expect(html).toContain("Offene Empfehlungen</div>");
        expect(html).toContain("<div class=\"kpi-v\">3 <small>· bei 1 von 2 Raidern</small></div>"); // three undecided
        // the area head counts its own in the breadcrumb, the one action is "Alle senden"
        expect(html).toContain("<b>Empfehlungen an den Raid</b><span class=\"kicker\">Raid › Empfehlungen · 1 offen · 0 freigegeben</span>");
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
        expect(html).toContain("class=\"rec rrow-d rec-high rec-state-approved\" data-key=\"gear\"");
        expect(html).toContain("<p class=\"rec-body\">Bitte vor dem Raid verzaubern.</p>");
        expect(html).toContain("class=\"rec rrow-d rec-low rec-state-rejected\" data-key=\"consumables.food\"");
        expect(html).toContain("<div class=\"kpi-v\">1 <small>· bei 0 von 2 Raidern</small></div>"); // only the raid finding is still open
        // the active verdict is toned; the text sits in the row's body with the editor
        expect(html).toMatch(/<button type="button" class="ibtn ok" data-tip="Freigeben"[^>]*data-review="approve">/);
        expect(html).toMatch(/<button type="button" class="ibtn bad" data-tip="Nicht senden"[^>]*data-review="reject">/);
        expect(html).toContain("<textarea class=\"rec-text\" rows=\"3\" placeholder=\"Eigene Formulierung (leer = Vorschlag so lassen)\">Bitte vor dem Raid verzaubern.</textarea>");
        expect(html).toContain("data-review=\"rule\"");
    });

    it("puts the raider's own points into their card: chip, section with controls and the footer", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html).toContain("data-name=\"Farin\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("inv_misc_note_01.jpg\" alt=\"\">1 offen</span>");
        expect(html).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">2 · 1 offen<\/span>/);
        expect(html).toContain("<span class=\"note\">1 freigegeben · 1 offen · zuletzt gesendet: nie</span>");
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
        expect(html).toContain("<b>Empfehlungen an den Raid</b><span class=\"kicker\">Raid › Empfehlungen · 1 Punkt von der Raidleitung</span></div><span class=\"grow\"></span><span class=\"badge count\">1</span>");
        expect(html).toContain("<div class=\"kpi-v\">2 <small>· freigegeben · bei 1 Raidern</small></div>"); // the raid's point and Farin's
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
        // the first point opens with its text
        expect(own).toContain("<details class=\"rec rrow-d rec-high rec-state-approved\" data-key=\"gear\" open>");
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
