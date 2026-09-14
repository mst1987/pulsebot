// The raider cards fold: one <details> per raider, closed by default, at most three badges in the head.
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

/** The <summary> of one raider's card. */
function head(html, name) {
    const at = html.indexOf(`id="raider-${name}"`);
    return html.slice(at, html.indexOf("</summary>", at));
}

describe("web/render — foldable raider cards", () => {
    it("renders each raider as a closed details card with what stands out as badges", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), admin);
        expect(html.match(/<details class="vcard raider-card"/g)).toHaveLength(2);
        expect(html).not.toMatch(/<details class="vcard raider-card"[^>]*\sopen>/);
        expect(head(html, "Farin")).toContain("inv_misc_note_01.jpg\" alt=\"\">1 offen</span>");
        // nothing stands out: one badge in the ok tone
        expect(head(html, "Dorn")).toContain("<span class=\"badge ok\">");
        expect(head(html, "Dorn").match(/class="badge (?:ok|mid|bad|accent)"/g)).toHaveLength(2); // the role badge + the one ok badge
        // a card with undecided points is marked for the "Offen" filter
        expect(html).toContain("data-name=\"Farin\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toMatch(/data-rolefilter="open"><img class="hicon"[^>]*>Offen <span class="n mid">1<\/span>/);
        // one icon button opens or closes every visible card
        expect(html).toContain("data-tip=\"Alle auf- oder zuklappen\"");
        expect(html).toContain("data-cards=\"toggle\"");
        expect(html).toContain("window.__ehCards");
    });

    it("keeps the reader's badge to the count of approved points", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }), reader);
        expect(head(html, "Farin")).toContain("inv_misc_note_01.jpg\" alt=\"\">1 Empfehlung</span>");
        expect(html).toMatch(/data-rolefilter="open"><img class="hicon"[^>]*>Empfehlungen <span class="n mid">1<\/span>/);
        expect(html).not.toContain(" offen");
    });
});
