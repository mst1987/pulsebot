// The player page /r/<id>/p/<n> (src/web/report/playerPage.js): head, the
// personal KPIs, the raider's points, the fights per boss and the folded sections.
const cases = require("../../fixtures/reportGolden/cases.json");
const { renderPlayerPage } = require("../../../src/web/report/playerPage");

const fixture = (name) => JSON.parse(JSON.stringify(cases.find((c) => c.name === name).args[0]));
const LEAD = { id: "u1", name: "Lead", isAdmin: true };

/** The KPI row as [label, value, sub] triples. */
function kpis(html) {
    const start = html.indexOf("<div class=\"kpis\">");
    if (start < 0) return [];
    const row = html.slice(start, html.indexOf("<div class=\"pstack\">"));
    return [...row.matchAll(/alt="">([^<]+)<\/div>\s*<div class="kpi-v[^"]*">([^<]*?)(?: <small[^>]*>· ([^<]*)<\/small>)?<\/div>/g)].map((m) => [m[1], m[2], m[3]]);
}

const fightsTable = (html) => html.slice(html.indexOf("<section class=\"gcard\" id=\"p-fights\">"), html.indexOf("</section>", html.indexOf("id=\"p-fights\"")));

describe("web/report/playerPage", () => {
    it("renders the 404 page for an index outside the roster", () => {
        const html = renderPlayerPage({ id: "r", roster: [] }, 0, null);
        expect(html).toContain("<h1 class=\"page-title\" style=\"margin-top:24px\">404</h1>");
    });

    it("renders a bare raider: head, no KPIs, the empty points and the preparation section", () => {
        const html = renderPlayerPage({ id: "r<1>", title: "Raid", date: "1.1.2026", roster: [{ name: "Al<x>", type: "Mage", issues: [] }] }, 0, null);
        expect(html).toContain("<title>Al&lt;x&gt; — Raid</title>");
        expect(html).toContain("<div class=\"page-head phead\" style=\"--cc:#69CCF0\">");
        expect(html).toContain("<div class=\"kicker\">Raid · 1.1.2026</div>");
        expect(html).toContain("<h1 class=\"page-title ptitle-cn\">Al&lt;x&gt;</h1>");
        expect(html).toContain("<div class=\"vcard-meta\"><span class=\"badge\">Mage</span><span class=\"badge accent\">");
        expect(html).toContain("DPS</span></div>");
        expect(html).toContain("href=\"/r/r&lt;1&gt;#raider\">");
        expect(kpis(html)).toEqual([]);
        expect(html).toContain("Deine Punkte für den nächsten Raid");
        expect(html).toContain("<div class=\"rlist\"><div class=\"rec-empty\">Noch keine freigegebenen Punkte.</div></div>");
        expect(html).not.toContain("id=\"p-fights\"");
        expect(html).toContain("<details class=\"pgrp\" id=\"p-prep\"><summary>");
        expect(html).not.toContain("<dialog class=\"dlg send\"");
    });

    describe("a raider with a DPS curve (case03)", () => {
        const html = renderPlayerPage(fixture("case03-player"), 0, null);

        it("compares the own DPS with the raid mean and counts the deaths", () => {
            // Alice: mean 72 against 1000 / 6 players = 167 per player
            expect(kpis(html)).toEqual([["DPS", "-57 %", "unter Raid-Schnitt"], ["Tode", "1", undefined]]);
            expect(html).toContain("Eigener DPS gegen den Raid-Schnitt pro Spieler");
            expect(html).toContain("Im Mittel über 1 Kampf mit eigener Kurve von Warcraft Logs.");
            expect(html).toContain("<span class=\"badge count\">1 Kampf</span>");
        });

        it("lists the boss in Deine Kämpfe with the own bar, the raid mean and the hints", () => {
            const table = fightsTable(html);
            expect(table).toContain("Deine Kämpfe");
            expect(table).toContain("Alice › Kampfverlauf · 1 von 1 Boss gezeigt");
            expect(table).toContain("<tr data-flag=\"1\">");
            expect(table).toContain("<span class=\"who\"><img class=\"hicon\" src=\"/bosses/650.jpg\" alt=\"\"><span>Gruul the Dragonkiller</span></span>");
            expect(table).toContain("<span class=\"bar\" data-tip=\"DPS Alice\" data-tip-sub=\"Raid-Schnitt pro Spieler: 167. Grün ab dem Schnitt, gelb unter 90 % davon.\"><i class=\"medium\" style=\"width:100%\"></i><b class=\"medium\">72</b></span>");
            expect(table).toContain("<td class=\"mono mute\">167</td>");
            expect(table).toContain("<td class=\"act\"><span class=\"mute\">–</span></td>");
            expect(table).toContain("1 Tod</span>");
            expect(table).toContain("<span class=\"badge mid\">unter Schnitt</span>");
            expect(table).toContain("<th data-tip=\"Dein DPS / HPS\"");
            expect(table).toContain(">Dein DPS</th>");
            expect(table).not.toContain("pf-seg");
        });

        it("puts the boss's charts in a dialog", () => {
            expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-pf-0\">");
            expect(html).toContain("Gruul the Dragonkiller · Alice</div><div class=\"vcard-meta\">1 Try · 6 px pro Sekunde, seitlich scrollen</div>");
            expect(html).toContain("<section class=\"fight\" id=\"p-fight-3\">");
        });

        it("measures a healer on HPS", () => {
            const heal = renderPlayerPage(fixture("case03-player"), 1, null);
            // Heal: 400 against 400 / 1 raider with an HPS curve
            expect(kpis(heal)).toEqual([["HPS", "+0 %", "über Raid-Schnitt"], ["Tode", "0", undefined]]);
            expect(fightsTable(heal)).toContain(">Dein HPS</th>");
            expect(fightsTable(heal)).toContain("<tr data-flag=\"0\">");
        });
    });

    describe("a full report (case01)", () => {
        it("gives the raid lead the review controls, the phrasing footer and the send dialog", () => {
            const html = renderPlayerPage(fixture("case01-report"), 1, LEAD);
            expect(html).toContain("<h1 class=\"page-title ptitle-cn\">Elun</h1>");
            expect(html).toContain("Punkte für den nächsten Raid");
            expect(html).toContain("Elun › Empfehlungen · 2 freigegeben · 1 offen");
            expect(html).toContain("<button type=\"button\" class=\"btn btn-sm\" data-dialog=\"send-1\">");
            expect(html).toContain("Vorschau &amp; senden</button>");
            expect(html).toContain("<div class=\"raider-foot\" data-report=\"abc123def456\" data-name=\"Elun\"><span class=\"note\">2 freigegeben · 1 offen · zuletzt gesendet: ");
            expect(html).toContain("<dialog class=\"dlg send\" id=\"send-1\"");
            // the first point opens with its text
            expect(html).toMatch(/<details class="rec rrow-d rec-high rec-state-approved" data-key="healers\.mana" open>/);
            expect(kpis(html)).toEqual([
                ["Overheal", "21 %", "300k Heilung"],
                ["Tode", "0", undefined],
                ["Vorbereitung", "100 %", "1 Gear-Problem"],
            ]);
            expect(html).toContain("<details class=\"pgrp\" id=\"p-perf\">");
        });

        it("shows a member only the approved points, without controls", () => {
            const html = renderPlayerPage(fixture("case01-report"), 1, { id: "u3", name: "Member", access: { cla: { read: true } } });
            expect(html).toContain("Deine Punkte für den nächsten Raid");
            expect(html).toContain("Elun › Empfehlungen · von der Raidleitung geprüft");
            expect(html).not.toContain("data-dialog=\"send-1\"");
            expect(html).not.toContain("raider-foot");
            expect(html).toContain("<span class=\"badge count\">2</span>");
        });

        it("reads activity against the raid, deaths from the mechanics and the preparation", () => {
            const brokk = renderPlayerPage(fixture("case01-report"), 0, LEAD);
            const rows = kpis(brokk);
            expect(rows[0]).toEqual(["Aktivität", "94 %", "Raid Ø 90 %"]);
            expect(rows.find((k) => k[0] === "Tode")).toEqual(["Tode", "1", "1 vermeidbar"]);
            expect(rows.find((k) => k[0] === "Vorbereitung")).toEqual(["Vorbereitung", "100 %", "Gear ok"]);
            expect(brokk).toContain("Tank</span>");
            // a raider with nothing approved: the send button is there but disabled
            expect(brokk).toContain("data-dialog=\"send-0\" disabled>");
            const dorn = renderPlayerPage(fixture("case01-report"), 2, LEAD);
            expect(kpis(dorn)[0]).toEqual(["Aktivität", "86 %", "Raid Ø 90 %"]);
            expect(dorn).toContain("data-dialog=\"send-2\" disabled>");
        });
    });

    describe("Deine Kämpfe with several bosses", () => {
        const f = (id, boss, encounterId, over = {}) => ({ id, boss, encounterId, kill: true, duration: 60000, deaths: [], ...over });
        const report = {
            id: "r", title: "T",
            roster: [{ name: "A", type: "Rogue" }],
            timeline: { fights: [
                f(1, "Boss One", 649, { activity: [{ name: "A", activePct: 70 }], deaths: [{ name: "A", at: 1000, avoidable: true }], series: { step: 5000, dps: [300], players: [{ name: "A", dps: [300] }, { name: "B", dps: [100] }] } }),
                f(2, "Boss Two", 650, { activity: [{ name: "A", activePct: 99 }], series: { step: 5000, dps: [200], players: [{ name: "A", dps: [150] }] } }),
                f(3, "Boss Three", 0, { activity: [{ name: "A", activePct: 95 }] }),
            ] },
        };
        const html = renderPlayerPage(report, 0, null);
        const table = fightsTable(html);

        it("shows only the flagged rows first, with a segment to show all", () => {
            expect(table).toContain("A › Kampfverlauf · 2 von 3 Bossen gezeigt");
            expect(table).toContain("<nav class=\"seg sm pf-seg\"><button type=\"button\" class=\"seg-btn active\" data-pfilter=\"flag\">Auffällige<span class=\"n mid\">2</span></button><button type=\"button\" class=\"seg-btn\" data-pfilter=\"all\">Alle 3</button></nav>");
            expect(table.match(/<tr data-flag="0" hidden>/g)).toHaveLength(1);
            expect(table.match(/<tr data-flag="1">/g)).toHaveLength(2);
            expect(table).toContain("1 vermeidbar</span>");
            expect(table).toContain("<span class=\"badge mid\">70 % aktiv</span>");
        });

        it("tones the own bar against the raid mean and leaves out a boss without a curve or icon", () => {
            expect(table).toContain("<i class=\"good\" style=\"width:100%\"></i><b class=\"good\">300</b>");
            expect(table).toContain("<span class=\"badge mid\">unter Schnitt</span>");
            expect(table).toContain("<i class=\"medium\" style=\"width:50%\"></i><b class=\"medium\">150</b>");
            expect(table).toContain("<td><span class=\"who\"><span>Boss Three</span></span></td>");
            expect(table).toContain("<td><span class=\"mute\">–</span></td>\n          <td class=\"mono mute\">–</td>");
            expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-pf-2\">\n          <div class=\"dlg-head\"><div class=\"dlg-main\">");
        });

        it("averages the DPS gap over the fights with a raid curve", () => {
            // Boss One: 300 against 300 / 2 = 150 → +100 %; Boss Two: 150 against 200 / 1 → -25 %; mean +38 %
            expect(kpis(html)).toEqual([["DPS", "+38 %", "über Raid-Schnitt"], ["Tode", "1", "1 vermeidbar"]]);
        });
    });
});
