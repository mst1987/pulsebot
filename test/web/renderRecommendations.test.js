// The Empfehlungen tab and the player page's own recommendations.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

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

describe("web/render — Empfehlungen for a reviewer", () => {
    it("shows every finding with verdict controls, the open count in the KPI card and the raid section", () => {
        const html = renderReportPage(report(null), admin);
        expect(html).toContain("id=\"rs-rec-raid\" open>");
        expect(html).toContain("Offene Empfehlungen</div>");
        expect(html).toContain("<div class=\"kpi-v\">3 <small>· bei 1 von 2 Raidern</small></div>"); // three undecided
        expect(html).toContain("<b>1 offen.</b>"); // the raid section counts its own
        expect(html).toContain("<span>Empfehlungen an den Raid</span><span class=\"rec-count hot\">1</span>");
        expect(html).toContain("2 Tode in den ersten 30 Sekunden");
        expect(html).toContain("data-scope=\"raid\" data-player=\"\" data-key=\"raid.earlyDeaths\"");
        expect(html).toContain("data-scope=\"player\" data-player=\"Farin\" data-key=\"gear\"");
        expect(html).toContain("data-review=\"approve\"");
        expect(html).toContain("<span class=\"rec-ev\"><span>Hood</span><b>keine Verzauberung</b></span>");
        expect(html).toContain("Nichts auszusetzen – weiter so.");
        expect(html).toContain("window.__ehReview");
    });

    it("reflects the review: state, buttons and the rewritten text", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true, text: "Bitte vor dem Raid verzaubern." }, "consumables.food": { approved: false } } } }), admin);
        expect(html).toContain("class=\"rec rec-high rec-state-approved\" data-key=\"gear\"");
        expect(html).toContain("<p class=\"rec-body\">Bitte vor dem Raid verzaubern.</p>");
        expect(html).toContain("class=\"rec rec-low rec-state-rejected\" data-key=\"consumables.food\"");
        expect(html).toContain("<div class=\"kpi-v\">1 <small>· bei 0 von 2 Raidern</small></div>"); // only the raid finding is still open
        expect(html).toContain("<button type=\"button\" class=\"btn btn-sm\" data-review=\"approve\">");
    });

    it("puts the raider's own points into their card: chip, section with controls and the footer", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html).toContain("data-name=\"Farin\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("<b>2</b> Empfehlungen · 1 offen</span>");
        expect(html).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">2 · 1 offen<\/span>/);
        expect(html).toContain("<span class=\"note\">1 freigegeben · 1 offen · zuletzt gesendet: nie</span>");
        expect(html).toContain("data-phrase=\"player\"");
        expect(html).toContain("data-dialog=\"send-0\">Vorschau &amp; senden</button>");
        // a clean raider says so instead of showing nothing
        expect(html).toContain("Nichts auszusetzen – weiter so.");
        expect(html).toContain("data-name=\"Clean\" data-role=\"dps\" data-open=\"0\"");
    });

    it("lets a role with write access to the CLA area review as well", () => {
        const html = renderReportPage(report(null), writer);
        expect(html).toContain("data-review=\"approve\"");
    });
});

describe("web/render — Empfehlungen for everyone else", () => {
    it("hides the raid section while nothing is approved, then shows only the approved items without controls", () => {
        expect(renderReportPage(report(null), reader)).not.toContain("id=\"rs-rec-raid\"");
        expect(renderReportPage(report(null), null)).not.toContain("id=\"rs-rec-raid\"");
        expect(renderReportPage(report(null), reader)).not.toContain("2 Gear-Probleme");
        const html = renderReportPage(report({ raid: { "raid.earlyDeaths": { approved: true } }, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(html).toContain("id=\"rs-rec-raid\"");
        expect(html).toContain("<span>Empfehlungen an den Raid</span><span class=\"rec-count\">1</span>");
        expect(html).toContain("<div class=\"kpi-v\">2 <small>· freigegeben · bei 1 Raidern</small></div>"); // the raid's point and Farin's
        expect(html).toContain("2 Gear-Probleme");
        expect(html).not.toContain("Essen 80 %");
        expect(html).not.toContain("data-review=");
        expect(html).not.toContain("window.__ehReview");
        expect(html).not.toContain("id=\"rs-send\"");
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

describe("web/render — player page", () => {
    it("shows the raider their approved items only, and a reviewer all of them with controls", () => {
        const review = { raid: {}, players: { Farin: { gear: { approved: true } } } };
        const own = renderPlayerPage(report(review), 0, reader);
        expect(own).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">1<\/span>/);
        expect(own).toContain("2 Gear-Probleme");
        expect(own).not.toContain("Essen 80 %");
        expect(own).not.toContain("data-review=");
        const mine = renderPlayerPage(report(review), 0, admin);
        expect(mine).toContain("Essen 80 %");
        expect(mine).toContain("data-review=\"reject\"");
        expect(mine).toContain("window.__ehReview");
        // nothing approved, nothing to show
        expect(renderPlayerPage(report(null), 0, reader)).not.toMatch(/Empfehlungen<span class="n(?: mid| bad)?">/);
        expect(renderPlayerPage(report(review), 1, admin)).toContain("Nichts auszusetzen – weiter so.");
    });
});
