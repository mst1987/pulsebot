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

describe("web/render — Empfehlungen tab for a reviewer", () => {
    it("shows every finding with verdict controls, the open count and the raid section", () => {
        const html = renderReportPage(report(null), admin);
        expect(html).toContain("data-tab=\"recommendations\"");
        expect(html).toContain("<span class=\"tab-count\">3</span>"); // three undecided
        expect(html).toContain("<b>3 offen.</b>");
        expect(html).toContain("<h2>Für den Raid</h2>");
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
        expect(html).toContain("<span class=\"tab-count\">1</span>"); // only the raid finding is still open
        expect(html).toContain("<button type=\"button\" class=\"btn btn-sm\" data-review=\"approve\">");
    });

    it("lets a role with write access to the CLA area review as well", () => {
        const html = renderReportPage(report(null), writer);
        expect(html).toContain("data-review=\"approve\"");
    });
});

describe("web/render — Empfehlungen for everyone else", () => {
    it("hides the tab while nothing is approved, then shows only the approved items without controls", () => {
        expect(renderReportPage(report(null), reader)).not.toContain("data-tab=\"recommendations\"");
        expect(renderReportPage(report(null), null)).not.toContain("data-tab=\"recommendations\"");
        const html = renderReportPage(report({ raid: { "raid.earlyDeaths": { approved: true } }, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(html).toContain("data-tab=\"recommendations\"");
        expect(html).toContain("<span class=\"tab-count\">2</span>");
        expect(html).toContain("2 Gear-Probleme");
        expect(html).not.toContain("Essen 80 %");
        expect(html).not.toContain("data-review=");
        expect(html).not.toContain("window.__ehReview");
        // a raider without approved findings gets no card
        expect(html).not.toContain("Nichts auszusetzen");
    });

    it("leaves the tab out of a report from before the rules", () => {
        const r = report(null);
        delete r.recommendations;
        expect(renderReportPage(r, admin)).not.toContain("data-tab=\"recommendations\"");
    });
});

describe("web/render — player page", () => {
    it("shows the raider their approved items only, and a reviewer all of them with controls", () => {
        const review = { raid: {}, players: { Farin: { gear: { approved: true } } } };
        const own = renderPlayerPage(report(review), 0, reader);
        expect(own).toContain("<h2>Empfehlungen</h2>");
        expect(own).toContain("2 Gear-Probleme");
        expect(own).not.toContain("Essen 80 %");
        expect(own).not.toContain("data-review=");
        const mine = renderPlayerPage(report(review), 0, admin);
        expect(mine).toContain("Essen 80 %");
        expect(mine).toContain("data-review=\"reject\"");
        // nothing approved, nothing to show
        expect(renderPlayerPage(report(null), 0, reader)).not.toContain("<h2>Empfehlungen</h2>");
        expect(renderPlayerPage(report(review), 1, admin)).not.toContain("<h2>Empfehlungen</h2>");
    });
});
