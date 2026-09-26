// Sicht Raid (src/web/report/raidGroups.js): the raid's findings and the three
// area groups, one metric card and one detail dialog per area.
const cases = require("../../fixtures/reportGolden/cases.json");
const { reportContext } = require("../../../src/web/report/context");
const { raidGroups } = require("../../../src/web/report/raidGroups");

const fixture = (name) => JSON.parse(JSON.stringify(cases.find((c) => c.name === name).args[0]));
const LEAD = { id: "u1", name: "Lead", isAdmin: true };
const groupsOf = (report, user = null) => raidGroups(reportContext(report, user));
const byId = (groups) => Object.fromEntries(groups.map((g) => [g.id, g]));

/** The metric card of one area: { tone, value, unit, html }. */
function card(groups, id) {
    const html = groups.map((g) => g.html).join("");
    const at = html.indexOf(`id="rs-${id}" role="button"`);
    if (at < 0) return null;
    const start = html.lastIndexOf("<div class=\"mcard", at);
    const end = html.indexOf("<div class=\"mcard", at);
    const body = html.slice(start, end < 0 ? html.indexOf("<dialog", at) : end);
    const m = body.match(/<div class="mc-val([^"]*)">([^<]*)(?:<small>([^<]*)<\/small>)?/);
    return { tone: m[1].trim(), value: m[2], unit: m[3], html: body };
}

describe("web/report/raidGroups", () => {
    it("returns no group for a report with nothing raid-wide", () => {
        expect(groupsOf({ id: "x" })).toEqual([]);
    });

    it("builds the Vorbereitung group from gear alone and calls it unauffällig", () => {
        const groups = groupsOf({ id: "x", players: [{ name: "A", type: "Mage", issues: [] }] });
        expect(groups.map((g) => [g.id, g.flagged])).toEqual([["prep", 0]]);
        expect(groups[0].html).toContain("<section class=\"gcard\" id=\"rg-prep\">");
        expect(groups[0].html).toContain("<span class=\"badge ok count\">unauffällig</span>");
        expect(card(groups, "gear")).toMatchObject({ tone: "ok", value: "0", unit: "keine" });
        expect(groups[0].html).toContain("<span class=\"badge ok\">alles verzaubert</span>");
        expect(groups[0].html).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-gear\">");
    });

    describe("a full CLA report (case01)", () => {
        const lead = groupsOf(fixture("case01-report"), LEAD);
        const reader = groupsOf(fixture("case01-report"), null);

        it("puts the findings first for the raid lead, with the send dialog, and leaves them out for a reader without approved ones", () => {
            expect(lead.map((g) => g.id)).toEqual(["recs", "prep", "perf", "err"]);
            expect(reader.map((g) => g.id)).toEqual(["prep", "perf", "err"]);
            const recs = byId(lead).recs;
            expect(recs.flagged).toBe(2);
            expect(recs.html).toContain("<section class=\"gcard\" id=\"rs-rec-raid\">");
            expect(recs.html).toContain("Raid › Empfehlungen · 2 offen · 0 freigegeben");
            expect(recs.html).toContain("data-dialog=\"dlg-rs-send\"");
            expect(recs.html).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-send\">");
        });

        it("counts the areas that stand out in each group head", () => {
            const g = byId(lead);
            expect([g.prep.flagged, g.perf.flagged, g.err.flagged]).toEqual([4, 3, 1]);
            expect(g.prep.html).toContain("<span class=\"badge mid count\">4 Bereiche auffällig</span>");
            expect(g.err.html).toContain("<span class=\"badge bad count\">1 Bereich auffällig</span>");
        });

        it("sums each area up in its card", () => {
            expect(card(lead, "raidbuffs")).toMatchObject({ tone: "mid", value: "50 %", unit: "durchgehend" });
            expect(card(lead, "consumables")).toMatchObject({ tone: "mid", value: "89 %", unit: "Flask / Elixiere" });
            expect(card(lead, "potions")).toMatchObject({ tone: "", value: "2", unit: "im Raid" });
            expect(card(lead, "potions").html).toContain("2 Raider ohne Trank</span>");
            expect(card(lead, "gear")).toMatchObject({ tone: "mid", value: "1", unit: "bei 1 Raider" });
            expect(card(lead, "activity")).toMatchObject({ value: "90 %", unit: "Ø aktiv" });
            expect(card(lead, "cooldowns")).toMatchObject({ tone: "mid", value: "75 %", unit: "genutzt" });
            expect(card(lead, "healers")).toMatchObject({ value: "1", unit: "Heiler" });
            expect(card(lead, "totems")).toMatchObject({ value: "87 %", unit: "Windfury Ø" });
            expect(card(lead, "mechanics")).toMatchObject({ tone: "bad", value: "4", unit: "Tode" });
            expect(card(lead, "mechanics").html).toContain("<div class=\"mcard wide\"");
            expect(card(lead, "mechanics").html).toContain("<div class=\"mc-table\"><table class=\"idx\"><tr><th>Mechanik</th>");
        });
    });

    describe("an RPB report (case02)", () => {
        const groups = groupsOf(fixture("case02-report"));

        it("fills the areas from the RPB where the CLA has nothing", () => {
            expect(groups.map((g) => g.id)).toEqual(["prep", "perf", "err"]);
            expect(card(groups, "drums")).toMatchObject({ value: "5", unit: "Einsätze" });
            expect(card(groups, "shadowresi")).toMatchObject({ value: "60", unit: "Ø aus Gear" });
            expect(card(groups, "gear")).toMatchObject({ tone: "bad", value: "1" });
            expect(card(groups, "gear").html).toContain("<span class=\"badge bad\">1 schwer</span>");
            expect(card(groups, "activity")).toMatchObject({ tone: "mid", value: "80 %", unit: "Ø Anteil Raidzeit" });
            expect(card(groups, "cooldowns")).toMatchObject({ value: "3", unit: "Klassen-Cooldowns" });
            expect(card(groups, "rpbspells")).toMatchObject({ tone: "mid", value: "1", unit: "Rang-Warnung" });
            expect(card(groups, "rpbinterrupts")).toMatchObject({ value: "4", unit: "Unterbrechungen" });
            expect(card(groups, "sunder")).toMatchObject({ value: "20", unit: "Sunder" });
            expect(card(groups, "bosses")).toMatchObject({ value: "2", unit: "Boss-Kämpfe" });
            expect(card(groups, "rpbdamage")).toMatchObject({ value: "2,0k", unit: "im Raid" });
            expect(card(groups, "rpbvalidate")).toMatchObject({ tone: "mid", value: "1", unit: "Anforderung offen" });
            const html = groups.map((g) => g.html).join("");
            expect(html).toContain("Raid › Leistung › Aktivität · RPB");
            expect(html).toContain("Raid › Fehler › Vermeidbarer erhaltener Schaden · RPB · alle Boss-Kämpfe");
            expect(html).toContain("Sortiert nach Rolle · Klick auf einen Raider öffnet seine Seite");
        });
    });

    it("sums raid buffs (case04) and raid debuffs with the bosses they were missing on (case09)", () => {
        const buffs = groupsOf(fixture("case04-report"));
        expect(card(buffs, "raidbuffs")).toMatchObject({ tone: "mid", value: "73 %" });
        const debuffs = groupsOf(fixture("case09-report"));
        expect(card(debuffs, "raiddebuffs")).toMatchObject({ tone: "bad", value: "1", unit: "von 3 fehlten" });
        expect(card(debuffs, "raiddebuffs").html).toContain("<span class=\"kicker\">Boss</span>");
    });

    describe("hand-built edges", () => {
        const pl = (name, type, over = {}) => ({ name, type, ...over });

        it("shows a reader only the approved raid findings, counted in the head", () => {
            const report = { id: "x", recommendations: { raid: [{ key: "a", impact: "high", title: "T", text: "t" }], players: [] }, recommendationReview: { raid: { a: { approved: true } } } };
            const groups = groupsOf(report);
            expect(groups.map((g) => [g.id, g.flagged])).toEqual([["recs", 0]]);
            expect(groups[0].html).toContain("Raid › Empfehlungen · 1 Punkt von der Raidleitung");
            expect(groups[0].html).toContain("<span class=\"badge count\">1</span>");
            expect(groups[0].html).not.toContain("dlg-rs-send");
        });

        it("puts the RPB tables under the CLA ones for activity and cooldowns", () => {
            const report = {
                id: "x",
                activity: { players: [pl("A", "Mage", { activeAvg: 97, fights: 1, gaps: 0, longestGap: 0, unexplainedMs: 0, mechanicMs: 0 })] },
                cooldowns: { players: [pl("A", "Mage", { uses: 0, possible: 0, usedPct: null, stacked: 0, unstacked: 0, fights: 1 })] },
                rpb: {
                    activity: { raidSeconds: 60, players: [pl("A", "Mage", { secondsActive: 50, relativeTotal: 83 })] },
                    usage: [pl("A", "Mage", { classCooldowns: [{ name: "Icy Veins", label: "IV", total: 1, possibleUses: 4 }] })],
                },
            };
            const groups = groupsOf(report);
            const act = card(groups, "activity");
            expect(act).toMatchObject({ tone: "ok", value: "97 %", unit: "Ø aktiv" });
            expect(act.html).toContain("<span class=\"badge ok\">alle über 85 %</span><span class=\"badge accent\">RPB</span>");
            const cd = card(groups, "cooldowns");
            // nothing possible: the raw count, no share
            expect(cd).toMatchObject({ tone: "", value: "0", unit: "Einsätze" });
            const html = groups[0].html;
            expect(html).toContain("<div class=\"dsub\"><span class=\"badge accent\">RPB</span>Aktivität</div>");
            expect(html).toContain("<div class=\"dsub\"><span class=\"badge accent\">RPB</span>Cooldowns &amp; Schmuckstücke</div>");
            expect(groups[0].flagged).toBe(0);
        });

        it("names RPB raiders under half their possible cooldowns, typed from the roster", () => {
            const report = {
                id: "x", roster: [pl("B", "Warrior")],
                rpb: { usage: [{ name: "B", classCooldowns: [{ name: "DW", label: "DW", total: 1, possibleUses: 6 }] }, { name: "C", classCooldowns: [{ total: 2 }] }] },
            };
            const cd = card(groupsOf(report), "cooldowns");
            expect(cd).toMatchObject({ value: "3", unit: "Klassen-Cooldowns" });
            expect(cd.html).toContain("<span class=\"badge mid\">1 unter der Hälfte</span>");
            expect(cd.html).toContain("<span class=\"cn\" style=\"--cc:#C79C6E\">B</span>");
            const none = card(groupsOf({ id: "x", rpb: { usage: [{ name: "C", classCooldowns: [{ total: 2 }] }] } }), "cooldowns");
            expect(none.html).toContain("<span class=\"badge ok\">keiner unter der Hälfte</span>");
        });

        it("flags healers with low mana or high overheal, and totems without Windfury counts shamans", () => {
            const report = {
                id: "x",
                healers: { players: [pl("E", "Priest", { healingTotal: 100, overhealTotal: 0, overhealPct: 40, manaLowFights: 2, fights: 1 })] },
                totems: { players: [pl("D", "Shaman", { wfUptimeAvg: null, twistingFights: 0, wfFights: 0, fights: 1 })] },
            };
            const groups = groupsOf(report);
            const heal = card(groups, "healers");
            expect(heal.html).toContain("<span class=\"badge mid\">Ø Overheal 40 %</span><span class=\"badge bad\">2× unter 10 % Mana</span>");
            expect(card(groups, "totems")).toMatchObject({ value: "1", unit: "Schamanen" });
            expect(groups[0].flagged).toBe(1);
        });

        it("counts every raider as having drunk when nobody is missing, and falls back without a roster", () => {
            const drank = card(groupsOf({ id: "x", roster: [pl("A", "Mage")], potions: { players: [pl("A", "Mage", { total: 2 })] } }), "potions");
            expect(drank.html).toContain("<span class=\"badge ok\">jeder hat getrunken</span>");
            expect(drank.html).toContain("<span class=\"kicker\">Meiste</span>");
            const noRoster = card(groupsOf({ id: "x", potions: { players: [pl("A", "Mage", { total: 2 })] } }), "potions");
            expect(noRoster.html).toContain("<span class=\"badge\">1 Raider</span>");
        });

        it("tones raid buffs without expected rows as unknown and debuffs all present as ok", () => {
            const buffs = card(groupsOf({ id: "x", raidBuffs: { players: [pl("A", "Mage")], rows: [{ key: "k", expected: false }] } }), "raidbuffs");
            expect(buffs).toMatchObject({ tone: "", value: "–" });
            expect(buffs.html).toContain("<span class=\"badge ok\">alle da</span>");
            const debuffs = card(groupsOf({ id: "x", raidDebuffs: { rows: [{ key: "s", expected: true, avgUptime: 99, missing: 0 }] } }), "raiddebuffs");
            expect(debuffs).toMatchObject({ tone: "ok", value: "1", unit: "erwartet, alle da" });
        });

        it("reads the mechanics card from the deaths alone and the boss uptimes from low rows", () => {
            const groups = groupsOf({
                id: "x",
                mechanics: { deaths: { total: 1, avoidable: 0, early: 1, nearEnd: 1 } },
                bossUptimes: { metrics: [{ key: "s", label: "S" }], rows: [{ boss: "A", s: 10 }, { boss: "B", s: 50 }] },
            });
            const mech = card(groups, "mechanics");
            expect(mech).toMatchObject({ tone: "", value: "1", unit: "Tod" });
            expect(mech.html).toContain("<span class=\"badge ok\">0 vermeidbar</span><span class=\"badge mid\">1 früh</span><span class=\"badge\">1 kurz vor dem Kill</span>");
            const bosses = card(groups, "bosses");
            expect(bosses).toMatchObject({ value: "2", unit: "Boss-Kämpfe" });
            expect(bosses.html).toContain("<span class=\"badge mid\">Ø 30 % Uptime</span>");
            expect(bosses.html).toContain("<span>A</span>");
            expect(byId(groups).perf.flagged).toBe(1);
        });

        it("lists RPB damage deaths and validation without open requirements", () => {
            const groups = groupsOf({
                id: "x",
                rpb: {
                    damage: { abilities: [], players: [pl("A", "Mage", { perAbility: [], avoidableTotal: 500, deaths: 2 })] },
                    validation: { bossesKilled: 1, bossesTotal: 1, requirements: [{ label: "T", ok: true }] },
                },
            });
            const dmg = card(groups, "rpbdamage");
            expect(dmg.html).toContain("<span class=\"badge bad\">2 Tode</span>");
            expect(byId(groups).err.html).toContain("<div class=\"kicker\">Raid › Fehler › Vermeidbarer Schaden · RPB · alle Boss-Kämpfe</div>");
            expect(card(groups, "rpbvalidate")).toMatchObject({ tone: "ok", value: "0", unit: "Anforderungen offen" });
        });
    });
});
