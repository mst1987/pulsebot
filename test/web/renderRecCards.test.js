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
    it("renders each raider as a closed details card with the counts in its chips", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html.match(/<details class="vcard raider-card"/g)).toHaveLength(2);
        expect(html).not.toMatch(/<details class="vcard raider-card"[^>]*\sopen>/);
        expect(html).toContain("<b>2</b> Empfehlungen · 1 offen</span>");
        expect(html).toContain("<b>0</b> Empfehlungen</span>");
        // a card with undecided points is marked for the "Offen" filter
        expect(html).toContain("data-name=\"Farin\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("data-rolefilter=\"open\">Offen <span class=\"n\">1</span>");
        expect(html).toContain("data-cards=\"open\">Alle aufklappen</button>");
        expect(html).toContain("data-cards=\"close\">Alle zuklappen</button>");
        expect(html).toContain("window.__ehCards");
    });

    it("keeps the reader's chip to the count of approved points", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(html).toContain("<b>1</b> Empfehlung</span>");
        expect(html).toContain("data-rolefilter=\"open\">Empfehlungen <span class=\"n\">1</span>");
        expect(html).not.toContain("offen");
    });
});
