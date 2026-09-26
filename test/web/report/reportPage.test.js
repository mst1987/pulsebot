// The report page /r/<id> (src/web/report/reportPage.js): head, KPI cards and
// the three views.
const cases = require("../../fixtures/reportGolden/cases.json");
const { renderReportPage } = require("../../../src/web/report/reportPage");

const fixture = (name) => JSON.parse(JSON.stringify(cases.find((c) => c.name === name).args[0]));
const LEAD = { id: "u1", name: "Lead", isAdmin: true };

/** The KPI row as [label, value, sub] triples. */
function kpis(html) {
    const row = html.slice(html.indexOf("<div class=\"kpis\">"), html.indexOf("<div class=\"view-bar\">"));
    return [...row.matchAll(/alt="">([^<]+)<\/div>\s*<div class="kpi-v[^"]*">([^<]*?)(?: <small[^>]*>· ([^<]*)<\/small>)?<\/div>/g)].map((m) => [m[1], m[2], m[3]]);
}

describe("web/report/reportPage", () => {
    it("renders a bare report: the Raid view first, gear problems as the only KPI", () => {
        const html = renderReportPage({ id: "r1", players: [{ name: "A", type: "Mage", issues: [{ itemName: "x", severity: "high", label: "y" }] }], roster: [] }, null);
        expect(html).toContain("<title>Log-Check</title>");
        expect(html).toContain("<div class=\"kicker\">Log-Auswertung</div>");
        expect(html).toContain("<h1 class=\"page-title\">Log-Check</h1>");
        expect(html).not.toContain("<div class=\"page-actions\">");
        expect(kpis(html)).toEqual([["Gear-Probleme", "1", "bei 1 Spieler(n)"]]);
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-raid\">");
        expect(html).toContain("<div id=\"view-raid\" class=\"view\">");
        expect(html).toContain("<div id=\"view-bosse\" class=\"view\" hidden><div class=\"empty\">Keine Boss-Kämpfe im Log.</div></div>");
        expect(html).toContain("<div id=\"view-raider\" class=\"view\" hidden><div class=\"empty\">Keine Raider gefunden.</div></div>");
        expect(html).toContain("<header class=\"pubbar\">");
    });

    it("says so when nothing raid-wide was evaluated and counts a clean gear check as good", () => {
        const html = renderReportPage({ id: "r1", title: "Leer", zone: "Z", date: "1.1.2026" }, null);
        expect(html).toContain("<div class=\"kicker\">Log-Auswertung · Zone: Z · 1.1.2026</div>");
        expect(html).toContain("<div class=\"empty\">Keine raid-weiten Auswertungen in diesem Report.</div>");
        expect(html).toContain("Raid<span class=\"n\">0</span>");
        expect(kpis(html)).toEqual([["Gear-Probleme", "0", "bei 0 Spieler(n)"]]);
        expect(html).toContain("<div class=\"kpi tone-good\"");
    });

    it("opens the Bosse view for a report with a timeline, with the links for an admin (case01)", () => {
        const html = renderReportPage(fixture("case01-report"), LEAD);
        expect(html).toContain("<title>Log-Check: Montagsraid Gruul</title>");
        expect(html).toContain("<div class=\"kicker\">Log-Auswertung · Zone: Gruul&#39;s Lair · 7.9.2026</div>");
        expect(html).toContain("<a class=\"btn btn-ghost btn-sm\" href=\"/cla\">");
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-bosse\">");
        expect(html).toContain("<div id=\"view-raid\" class=\"view\" hidden>");
        expect(html).toMatch(/Raid<span class="n mid">4<\/span>/);
        expect(html).toContain("Raider<span class=\"n\">3</span>");
        const row = kpis(html);
        expect(row.map((k) => k[0])).toEqual(["Bosse", "Tode", "Offene Empfehlungen", "Flask / Elixiere"]);
        expect(row[1]).toEqual(["Tode", "4", "2 vermeidbar"]);
        expect(row[2]).toEqual(["Offene Empfehlungen", "4", "bei 2 von 3 Raidern"]);
        expect(row[3]).toEqual(["Flask / Elixiere", "89 %", "Ø Food 83 %"]);
        // the admin gets the chrome, not the public header
        expect(html).not.toContain("<header class=\"pubbar\">");
    });

    it("shows a reader the approved recommendations instead of the open ones", () => {
        const html = renderReportPage(fixture("case01-report"), null);
        const row = kpis(html);
        expect(row[2]).toEqual(["Empfehlungen", "2", "freigegeben · bei 1 Raidern"]);
        expect(html).not.toContain("href=\"/cla\"");
    });

    it("counts bosses from the uptime rows and deaths from the RPB without a timeline (case02)", () => {
        const html = renderReportPage(fixture("case02-report"), null);
        expect(html).toContain("<a class=\"btn btn-ghost btn-sm\" href=\"https://www.warcraftlogs.com/reports/xyz\" target=\"_blank\" rel=\"noopener\">");
        const row = kpis(html);
        expect(row[0]).toEqual(["Bosse", "2", "1 Kill, 1 Wipe"]);
        expect(row[1]).toEqual(["Tode", "1", undefined]);
        expect(row[2]).toEqual(["Flask / Elixiere", "50 %", "Ø Food 100 %"]);
        expect(html).toContain("<div class=\"kpi-v warn\">50 %");
    });

    it("counts deaths from the fights without a mechanics summary and grammar for one kill", () => {
        const report = {
            id: "r1",
            timeline: { fights: [
                { id: 1, boss: "A", encounterId: 1, kill: true, duration: 1000, deaths: [{ name: "X", at: 0 }] },
                { id: 2, boss: "B", encounterId: 2, kill: false, duration: 1000, deaths: [{ name: "X", at: 0 }, { name: "Y", at: 0 }] },
            ] },
            consumables: { players: [{ name: "X", buffed: 95, food: 90 }, { name: "Y", buffed: 30, food: 10 }] },
        };
        const html = renderReportPage(report, null);
        const row = kpis(html);
        expect(row[0]).toEqual(["Bosse", "2", "1 Kill, 1 Wipe"]);
        expect(row[1]).toEqual(["Tode", "3", undefined]);
        expect(row[2]).toEqual(["Flask / Elixiere", "63 %", "Ø Food 50 %"]);
        const good = renderReportPage({ id: "r", consumables: { players: [{ name: "X", buffed: 95, food: 90 }] }, bossUptimes: { metrics: [], rows: [{ boss: "A", kill: true }, { boss: "B", kill: true }] } }, null);
        expect(kpis(good)[0]).toEqual(["Bosse", "2", "2 Kills, 0 Wipes"]);
        expect(good).toContain("<div class=\"kpi-v good\">95 %");
        const bad = renderReportPage({ id: "r", consumables: { players: [{ name: "X", buffed: 10, food: 0 }] } }, null);
        expect(bad).toContain("<div class=\"kpi-v bad\">10 %");
    });

    it("marks no open recommendation as good for the raid lead", () => {
        const report = { id: "r", roster: [{ name: "A" }], recommendations: { raid: [], players: [{ name: "A", items: [{ key: "k" }] }] }, recommendationReview: { players: { A: { k: { approved: true } } } } };
        const html = renderReportPage(report, LEAD);
        expect(kpis(html)[0]).toEqual(["Offene Empfehlungen", "0", "bei 0 von 1 Raidern"]);
        expect(html).toContain("<div class=\"kpi-v good\">0");
    });
});
