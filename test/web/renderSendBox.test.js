// The send box in the Empfehlungen tab: counts, button state, reviewer-only.
const { renderReportPage } = require("../../src/web/render.js");

function report(review, sent) {
    return {
        id: "abc123def456",
        title: "Test Raid",
        players: [],
        roster: [{ name: "Farin", type: "Warlock", issues: [], potions: {}, armory: [] }, { name: "Dorn", type: "Shaman", issues: [], potions: {}, armory: [] }],
        recommendations: {
            raid: [],
            players: [
                { name: "Farin", type: "Warlock", items: [{ key: "gear", impact: "high", title: "Gear", text: "…", evidence: [] }] },
                { name: "Dorn", type: "Shaman", items: [{ key: "totems.twisting", impact: "medium", title: "Twisting", text: "…", evidence: [] }] },
            ],
        },
        recommendationReview: review,
        recommendationSent: sent,
    };
}

const admin = { id: "u1", name: "Lead", isAdmin: true };

describe("web/render — send box", () => {
    it("shows reviewers the counts and an active send button once something is approved", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }, { Farin: { at: 1 } }), admin);
        expect(html).toContain("<span>Alle senden</span><span class=\"rec-count\">1</span>");
        expect(html).toContain("<div class=\"rec-send\" data-report=\"abc123def456\">");
        expect(html).toContain("1 Raider mit freigegebenen Punkten · 1 bereits angeschrieben");
        expect(html).toContain("<button type=\"button\" class=\"btn btn-sm\" data-send=\"all\">Freigegebenes per DM senden</button>");
        expect(html).toContain("data-send=\"status\"");
        expect(html).toContain("window.__ehSend");
        expect(html).toContain("/api/cla/recommendations/send");
    });

    it("disables the button while nothing is approved", () => {
        const html = renderReportPage(report(null, {}), admin);
        expect(html).toContain("0 Raider mit freigegebenen Punkten · 0 bereits angeschrieben");
        expect(html).toContain("data-send=\"all\" disabled>");
    });

    it("hides the box from everyone who cannot review", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }, {}), { id: "u3", isAdmin: false, access: { cla: { read: true } } });
        expect(html).not.toContain("class=\"rec-send\"");
        expect(html).not.toContain("window.__ehSend");
    });
});
