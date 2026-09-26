// "Alle senden": the one action in the head of the raid's recommendations, a dialog with counts, mapping check, phrasing and send.
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
    it("opens from the area head as a dialog with the counts and an active send button once something is approved", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }, { Farin: { at: 1 } }), admin);
        expect(html).toMatch(/<button type="button" class="btn btn-sm" data-dialog="dlg-rs-send"><img class="hicon"[^>]*inv_letter_15\.jpg" alt="">Alle senden …<\/button>/);
        expect(html).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-send\">");
        expect(html).toContain("<div class=\"rec-send\" data-report=\"abc123def456\">");
        expect(html).toContain("1 Raider mit freigegebenen Punkten</span>");
        expect(html).toContain("1 bereits angeschrieben</span>");
        expect(html).toMatch(/<button type="button" class="btn btn-sm" data-send="all"><img class="hicon"[^>]*>Freigegebenes per DM senden<\/button>/);
        expect(html).toContain("data-send=\"status\"");
        expect(html).toMatch(/class="btn btn-run btn-sm" data-phrase="all"/);
        expect(html).toContain("<script src=\"/r-assets/report.js?v=");
    });

    it("disables the button while nothing is approved", () => {
        const html = renderReportPage(report(null, {}), admin);
        expect(html).toContain("0 Raider mit freigegebenen Punkten</span>");
        expect(html).toContain("0 bereits angeschrieben</span>");
        expect(html).toContain("data-send=\"all\" disabled>");
    });

    it("hides the box from everyone who cannot review", () => {
        const html = renderReportPage(report({ raid: {}, players: { Farin: { gear: { approved: true } } } }, {}), { id: "u3", isAdmin: false, access: { cla: { read: true } } });
        expect(html).not.toContain("class=\"rec-send\"");
        expect(html).not.toContain("dlg-rs-send");
        expect(html).not.toContain("data-send=");
    });
});
