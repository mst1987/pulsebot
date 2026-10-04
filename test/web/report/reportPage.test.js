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
        // the raid findings are no area group any more: three groups, three flagged
        expect(html).toMatch(/Raid<span class="n mid">3<\/span>/);
        expect(html).toContain("Raider<span class=\"n\">3</span>");
        const row = kpis(html);
        expect(row.map((k) => k[0])).toEqual(["Bosse", "Tode", "Flask / Elixiere", "Raid-Buffs"]);
        expect(row[1]).toEqual(["Tode", "4", "2 vermeidbar"]);
        expect(row[2]).toEqual(["Flask / Elixiere", "89 %", "Ø Food 83 %"]);
        expect(row[3]).toEqual(["Raid-Buffs", "50 %", "1 von 1 lückenhaft"]);
        expect(html).not.toContain("Offene Empfehlungen");
        // the admin gets the chrome, not the public header
        expect(html).not.toContain("<header class=\"pubbar\">");
    });

    it("puts Das Wichtigste between the KPI cards and the view switch, with the send button for the raid lead", () => {
        const html = renderReportPage(fixture("case01-report"), LEAD);
        const kpiAt = html.indexOf("<div class=\"kpis\">");
        const keyAt = html.indexOf("<section class=\"key-findings\" id=\"rs-rec-raid\">");
        const barAt = html.indexOf("<div class=\"view-bar\"><nav class=\"seg views\">");
        expect(kpiAt).toBeGreaterThan(-1);
        expect(keyAt).toBeGreaterThan(kpiAt);
        expect(barAt).toBeGreaterThan(keyAt);
        expect(html).toContain("<h2>Das Wichtigste</h2><span class=\"sub\">2 Punkte für den ganzen Raid · 2 offen · 0 freigegeben</span>");
        expect(html).toContain("data-dialog=\"dlg-rs-send\"");
        // the send dialog lives in the section, not in the Raid view
        expect(html.indexOf("<dialog class=\"dlg detail\" id=\"dlg-rs-send\">")).toBeLessThan(barAt);
    });

    it("shows a reader no Das Wichtigste without approved raid findings, and no open-recommendation KPI", () => {
        const html = renderReportPage(fixture("case01-report"), null);
        expect(kpis(html).map((k) => k[0])).toEqual(["Bosse", "Tode", "Flask / Elixiere", "Raid-Buffs"]);
        expect(html).not.toContain("key-findings");
        expect(html).not.toContain("Empfehlungen senden");
        expect(html).not.toContain("href=\"/cla\"");
    });

    it("shows a reader the approved raid findings under Das Wichtigste, without controls", () => {
        const report = { id: "r", recommendations: { raid: [{ key: "a", impact: "high", title: "T", text: "t" }], players: [] }, recommendationReview: { raid: { a: { approved: true } } } };
        const html = renderReportPage(report, null);
        expect(html).toContain("<h2>Das Wichtigste</h2><span class=\"sub\">1 Punkt von der Raidleitung</span>");
        expect(html).not.toContain("dlg-rs-send");
        expect(html).not.toContain("data-review");
    });

    it("adds a Raid-Buffs KPI with the mean coverage, toned by it, and says when all ran through", () => {
        const buffs = (rows) => ({ id: "r", raidBuffs: { rows, players: [] } });
        const row = (over) => ({ key: "k", label: "K", expected: true, coveragePct: 100, none: 0, partial: 0, late: 0, ...over });
        const low = kpis(renderReportPage(buffs([row({ coveragePct: 50, none: 1 }), row({ key: "j", coveragePct: 70, partial: 1 }), row({ key: "i", coveragePct: 100 })]), null));
        expect(low).toEqual([["Raid-Buffs", "73 %", "2 von 3 lückenhaft"]]);
        const good = renderReportPage(buffs([row({ coveragePct: 100 }), row({ key: "j", coveragePct: 96 })]), null);
        expect(kpis(good)).toEqual([["Raid-Buffs", "98 %", "alle durchgehend"]]);
        expect(good).toContain("<div class=\"kpi-v good\">98 %");
        const mid = renderReportPage(buffs([row({ coveragePct: 85, late: 1 })]), null);
        expect(mid).toContain("<div class=\"kpi-v warn\">85 %");
        expect(renderReportPage(buffs([row({ coveragePct: 40, none: 2 })]), null)).toContain("<div class=\"kpi-v bad\">40 %");
        // rows that are not expected or have no coverage figure do not count; without any: no card
        const none = renderReportPage(buffs([row({ expected: false }), row({ coveragePct: null })]), null);
        expect(none).not.toContain("Raid-Buffs</div>");
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

    it("tells the raid lead there is nothing raid-wide when no raid finding exists", () => {
        const report = { id: "r", roster: [{ name: "A" }], recommendations: { raid: [], players: [{ name: "A", items: [{ key: "k" }] }] }, recommendationReview: { players: { A: { k: { approved: true } } } } };
        const html = renderReportPage(report, LEAD);
        expect(html).toContain("<div class=\"rec-empty\">Nichts, was den ganzen Raid gekostet hätte.</div>");
        expect(html).toContain("0 Punkte für den ganzen Raid · 0 offen · 0 freigegeben");
        expect(html).toContain("Versand · 1 Raider mit freigegebenen Punkten");
        expect(kpis(html)).toEqual([["Gear-Probleme", "0", "bei 0 Spieler(n)"]]);
    });
});
