// The raider cards in the Empfehlungen tab fold: one <details> per raider, closed by default.
const { renderReportPage } = require("../../src/web/render.js");

function report(review) {
    return {
        id: "abc123def456",
        title: "Test Raid",
        players: [],
        roster: [{ name: "Farin", type: "Warlock", issues: [], potions: {}, armory: [] }, { name: "Dorn", type: "Shaman", issues: [], potions: {}, armory: [] }],
        recommendations: {
            raid: [],
            players: [
                { name: "Farin", type: "Warlock", items: [{ key: "gear", impact: "high", title: "Gear", text: "…", evidence: [] }, { key: "food", impact: "low", title: "Essen", text: "…", evidence: [] }] },
                { name: "Dorn", type: "Shaman", items: [] },
            ],
        },
        recommendationReview: review,
    };
}

const admin = { id: "u1", name: "Lead", isAdmin: true };
const reader = { id: "u3", isAdmin: false, access: { cla: { read: true } } };

describe("web/render — foldable raider cards", () => {
    it("renders each raider as a closed details card with the counts in its summary", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html.match(/<details class="rec-card/g)).toHaveLength(2);
        expect(html).not.toContain("<details class=\"rec-card\" open");
        expect(html).toContain("<summary class=\"rec-card-head\">");
        expect(html).toContain("<span class=\"rec-count\">2 Punkte · 1 offen · 1 frei</span>");
        expect(html).toContain("<span class=\"rec-count\">0 Punkte</span>");
        // a card with undecided points is marked
        expect(html).toContain("<details class=\"rec-card rec-card-open\"");
        expect(html).toContain("data-cards=\"open\">Alle aufklappen</button>");
        expect(html).toContain("data-cards=\"close\">Alle zuklappen</button>");
        expect(html).toContain("window.__ehCards");
    });

    it("keeps the reader's summary to the count of approved points", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(html).toContain("<span class=\"rec-count\">1 Punkt</span>");
        expect(html).not.toContain("offen");
    });
});
