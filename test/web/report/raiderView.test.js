// Sicht Raider (src/web/report/raiderView.js): one card per raider with its
// sections, the paperdoll, the send dialog and the role filter.
const cases = require("../../fixtures/reportGolden/cases.json");
const { reportContext } = require("../../../src/web/report/context");
const { sendDialog, raiderSections, renderRaiderView } = require("../../../src/web/report/raiderView");

const fixture = (name) => JSON.parse(JSON.stringify(cases.find((c) => c.name === name).args[0]));
const LEAD = { id: "u1", name: "Lead", isAdmin: true };
const sectionsOf = (ctx, name, items = []) => {
    const i = ctx.report.roster.findIndex((p) => p.name === name);
    return raiderSections(ctx, ctx.report.roster[i], i, items);
};
const sec = (secs, key) => secs.find((s) => s.key === key);

describe("web/report/raiderView", () => {
    describe("renderRaiderView", () => {
        it("says so without a roster", () => {
            expect(renderRaiderView(reportContext({ id: "x" }, null), null)).toBe("<div class=\"empty\">Keine Raider gefunden.</div>");
        });

        it("renders the tools and one card per raider, the named one open (case01, raid lead)", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const html = renderRaiderView(ctx, "Elun");
            expect(html).toContain("<input type=\"search\" id=\"raiderSearch\" placeholder=\"Raider suchen…\" aria-label=\"Raider suchen\">");
            expect(html).toContain("data-rolefilter=\"tank\">");
            // two raiders with open findings
            expect(html).toContain("Offen <span class=\"n mid\">2</span></button>");
            expect(html).toContain("data-cards=\"toggle\"");
            expect(html.match(/<details class="vcard raider-card"/g)).toHaveLength(3);
            expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Elun\" data-name=\"Elun\" data-role=\"healer\" data-open=\"1\" data-report=\"abc123def456\" style=\"--cc:#FFFFFF\" open>");
            expect(html).toContain("id=\"raider-Brokk\" data-name=\"Brokk\" data-role=\"tank\" data-open=\"0\"");
            expect(html).toContain("<div class=\"raider-empty\" id=\"raiderEmpty\" hidden>Kein Raider passt zu Suche und Filter.</div>");
        });

        it("gives a reader the approved count and no review tools", () => {
            const ctx = reportContext(fixture("case01-report"), null);
            const html = renderRaiderView(ctx, null);
            expect(html).toContain("Empfehlungen <span class=\"n mid\">1</span></button>");
            expect(html).toContain("id=\"raider-Elun\" data-name=\"Elun\" data-role=\"healer\" data-open=\"2\"");
            expect(html).not.toContain("raider-foot");
            expect(html).not.toContain("<dialog class=\"dlg send\"");
            // the card shows the raider's two worst findings, no review state for a reader
            expect(html).not.toContain("Empfehlung offen");
            expect(html).not.toContain("Empfehlungen offen");
        });

        it("shows at most two badges per raider, the talk findings first, then worst first", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const html = renderRaiderView(ctx, null);
            const chips = (name) => {
                const at = html.indexOf(`id="raider-${name}"`);
                const start = html.indexOf("<div class=\"vcard-chips\">", at);
                return html.slice(start, html.indexOf("</span></div>", start) + 13);
            };
            const brokk = chips("Brokk");
            expect(brokk.match(/<span class="badge /g)).toHaveLength(2);
            expect(brokk).toContain("1 vermeidbarer Tod</span>");
            expect(brokk).toContain("Buff fehlte 1×</span>");
            expect(brokk.indexOf("badge bad")).toBeLessThan(brokk.indexOf("badge mid"));
            // Elun has three findings (mana, gear, the open point) and shows only the first two
            const elun = chips("Elun");
            expect(elun.match(/<span class="badge /g)).toHaveLength(2);
            expect(elun.indexOf("2× unter 10 % Mana")).toBeLessThan(elun.indexOf("1 Gear-Problem"));
            expect(elun).not.toContain("Empfehlung");
        });

        it("puts the person's facts into a plain-text sub line, not into badges", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const html = renderRaiderView(ctx, null);
            expect(html).toContain("<div class=\"vcard-title cn\">Elun</div><div class=\"vcard-sub\">Priest · Heiler · 1 Kampf</div>");
            expect(html).not.toContain("vcard-meta\">Priest");
        });

        it("groups the raiders by how much there is to talk about, the heaviest first, and leaves out empty groups", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const html = renderRaiderView(ctx, null);
            expect(html.match(/<section class="raider-group" data-group="/g)).toHaveLength(2);
            expect(html).toContain("<div class=\"rg-head\"><span class=\"dot bad\"></span><b>Gespräch lohnt sich</b><span class=\"badge count\">2 Raider</span><span class=\"mute\">vermeidbare Tode, viele Gear-Probleme, wenig aktiv oder ohne Mana</span></div>");
            expect(html).toContain("<section class=\"raider-group\" data-group=\"minor\"><div class=\"rg-head\"><span class=\"dot mid\"></span><b>Kleinigkeiten</b><span class=\"badge count\">1 Raider</span>");
            expect(html).not.toContain("data-group=\"fine\"");
            const at = (s) => html.indexOf(s);
            // Brokk (avoidable death) and Elun (mana) talk, Dorn only has small things
            expect(at("data-group=\"talk\"")).toBeLessThan(at("id=\"raider-Brokk\""));
            expect(at("id=\"raider-Elun\"")).toBeLessThan(at("data-group=\"minor\""));
            expect(at("data-group=\"minor\"")).toBeLessThan(at("id=\"raider-Dorn\""));
        });

        describe("groups of synthetic raiders", () => {
            const mk = (players) => ({
                id: "x",
                roster: players.map((p) => ({ name: p.name, type: p.type || "Mage", issues: p.issues || [] })),
                consumables: { players: players.filter((p) => p.cons !== undefined).map((p) => ({ name: p.name, type: "Mage", buffed: p.cons, food: 100, weaponOiled: true })) },
                activity: { players: players.filter((p) => p.act !== undefined).map((p) => ({ name: p.name, type: "Mage", activeAvg: p.act, gaps: 0, longestGap: 0, unexplainedMs: 0 })) },
                mechanics: { players: players.filter((p) => p.avoid).map((p) => ({ name: p.name, type: "Mage", hits: 1, deaths: 1, avoidableDeaths: 1, byMechanic: {} })) },
            });
            const groupOf = (html, name) => {
                const at = html.indexOf(`id="raider-${name}"`);
                return html.slice(0, at).match(/data-group="(\w+)"/g).pop().replace(/data-group="|"/g, "");
            };
            const render = (players) => renderRaiderView(reportContext(mk(players), null), null);

            it("sorts talk, minor and fine by their strongest finding", () => {
                const html = render([
                    { name: "Fine" },
                    { name: "Death", avoid: true },
                    { name: "Lazy", act: 70 },
                    { name: "Okayish", act: 82 },
                    { name: "Food", cons: 60 },
                    { name: "NoFood", cons: 40 },
                    { name: "Gear5", issues: Array.from({ length: 5 }, (_, i) => ({ itemName: `i${i}`, label: "x", severity: "medium" })) },
                    { name: "Gear2", issues: [{ itemName: "a", label: "x", severity: "medium" }, { itemName: "b", label: "x", severity: "medium" }] },
                    { name: "Gear3High", issues: Array.from({ length: 3 }, (_, i) => ({ itemName: `i${i}`, label: "x", severity: "high" })) },
                ]);
                for (const talk of ["Death", "Lazy", "NoFood", "Gear5", "Gear3High"]) expect([talk, groupOf(html, talk)]).toEqual([talk, "talk"]);
                for (const minor of ["Okayish", "Food", "Gear2"]) expect([minor, groupOf(html, minor)]).toEqual([minor, "minor"]);
                expect(groupOf(html, "Fine")).toBe("fine");
                expect(html).toContain("<span class=\"dot ok\"></span><b>Alles in Ordnung</b><span class=\"badge count\">1 Raider</span><span class=\"mute\">nichts Auffälliges</span>");
                // the heaviest first within the talk group (ties keep the roster order): five medium gear problems weigh less than a red finding
                const order = ["Death", "Lazy", "NoFood", "Gear3High", "Gear5"].map((n) => html.indexOf(`id="raider-${n}"`));
                expect(order).toEqual([...order].sort((a, b) => a - b));
                // the group order: talk, minor, fine
                expect(html.indexOf("data-group=\"talk\"")).toBeLessThan(html.indexOf("data-group=\"minor\""));
                expect(html.indexOf("data-group=\"minor\"")).toBeLessThan(html.indexOf("data-group=\"fine\""));
            });

            it("shows a fine raider one green badge", () => {
                const html = render([{ name: "Fine", act: 99 }]);
                expect(html).toContain("<span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_misc_pocketwatch_02.jpg\" alt=\"\">99 % aktiv</span>");
            });

            const buffReport = (lacking, total) => ({
                ...mk(Array.from({ length: total }, (_, i) => ({ name: `R${i}` }))),
                raidBuffs: {
                    rows: [{ key: "kings", label: "Kings", provider: "Paladin", expected: true }],
                    players: Array.from({ length: total }, (_, i) => ({ name: `R${i}`, type: "Mage", buffs: {}, missing: i < lacking ? 1 : 0, partial: 0, late: 0, wrong: 0 })),
                },
            });

            it("says a buff gap that nearly everyone shares once, above the groups, and drops it from the rows", () => {
                const html = renderRaiderView(reportContext(buffReport(4, 5), null), null);
                expect(html).toContain("<div class=\"raid-note\">");
                expect(html).toContain("<b>Buffs fehlten bei 4 von 5 Raidern</b>");
                expect(html).toContain("<a class=\"btn btn-ghost btn-sm\" href=\"#raid\">Raid-Buffs ansehen</a>");
                expect(html.indexOf("raid-note")).toBeLessThan(html.indexOf("raider-group"));
                expect(html).not.toContain("Buff fehlte");
                // nobody is left with a finding: one group, all fine
                expect(html).toContain("data-group=\"fine\"");
                expect(html).not.toContain("data-group=\"minor\"");
            });

            it("keeps the buff badge per raider when fewer than three in four lacked one or there are fewer than five raiders", () => {
                const some = renderRaiderView(reportContext(buffReport(3, 5), null), null);
                expect(some).not.toContain("raid-note");
                expect(some.match(/Buff fehlte 1×/g)).toHaveLength(3);
                const few = renderRaiderView(reportContext(buffReport(4, 4), null), null);
                expect(few).not.toContain("raid-note");
                expect(few.match(/Buff fehlte 1×/g)).toHaveLength(4);
            });
        });

        it("counts the open points as a neutral badge for a reviewer", () => {
            const report = {
                id: "x", roster: [{ name: "A", type: "Mage" }],
                recommendations: { raid: [], players: [{ name: "A", items: [
                    { key: "k1", impact: "low", title: "t1", text: "x" },
                    { key: "k2", impact: "low", title: "t2", text: "x" },
                ] }] },
            };
            const html = renderRaiderView(reportContext(report, LEAD), null);
            expect(html).toContain("<span class=\"badge\" data-tip=\"Befunde, die noch niemand freigegeben oder verworfen hat\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_misc_note_01.jpg\" alt=\"\">2 Empfehlungen offen</span>");
            expect(html).not.toContain("<span class=\"badge mid\">2 offen");
            // an open review alone is no finding: the raider stays in the fine group
            expect(html).toContain("data-group=\"fine\"");
        });
        it("adds the timeline dialog, the page link and the send dialog to a raider card", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const html = renderRaiderView(ctx, null);
            expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-rt-1\">");
            expect(html).toContain("Kampfverlauf · Elun</div>");
            // the three links live in the body as labelled buttons, not as icon buttons in the summary
            expect(html).toContain("<div class=\"raider-links\"><button type=\"button\" class=\"btn btn-ghost btn-sm\" data-dialog=\"dlg-rt-1\"");
            expect(html).toContain("Kampfverlauf</button><a class=\"btn btn-ghost btn-sm\" href=\"https://classic-armory.org/character/eu/tbc-anniversary/thunderstrike/Elun\"");
            expect(html).toContain("<a class=\"btn btn-ghost btn-sm\" href=\"/r/abc123def456/p/1\" data-tip=\"Spielerseite öffnen\"");
            expect(html).not.toContain("class=\"ibtn\" href=\"/r/abc123def456/p/1\"");
            expect(html).toContain("<div class=\"raider-foot\"><span class=\"note\">2 freigegeben · 1 offen · zuletzt gesendet: ");
            expect(html).toContain("<dialog class=\"dlg send\" id=\"send-1\" data-report=\"abc123def456\" data-player=\"Elun\">");
            expect(html).toContain("zuletzt gesendet: nie</span>");
        });
    });

    describe("raiderSections", () => {
        it("fills Vorbereitung, Leistung and Fehler from the CLA summaries (case01)", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const { secs, dialogs } = sectionsOf(ctx, "Elun", ctx.recByName.get("Elun").items);
            expect(secs.map((s) => s.key)).toEqual(["recs", "prep", "perf"]);
            expect(sec(secs, "recs")).toMatchObject({ count: "3 · 1 offen", tone: "mid" });
            const prep = sec(secs, "prep");
            expect(prep.tone).toBe("mid");
            expect(prep.html).toContain("<b>Gear</b><span class=\"badge mid\">1 Problem</span>");
            expect(prep.html).toContain("<b>Consumables</b><span class=\"badge ok\">ok</span>");
            expect(prep.html).toContain("<span>Waffe geölt</span></span><span class=\"badge mid\">nein</span>");
            expect(prep.html).toContain("<b>Buffs</b><span class=\"badge ok\">alle da</span>");
            expect(dialogs).toBe("");
            const perf = sec(secs, "perf");
            expect(perf).toMatchObject({ count: "21 % Overheal", tone: "bad", crumb: "Heilung · Mana · Cooldowns" });
            expect(perf.html).toContain("<b>Heilung &amp; Mana</b><span class=\"badge bad\">2× unter 10 % Mana</span>");
            expect(perf.html).toContain("Ø Mana-Tiefstand</span></span><span class=\"mono\">7 %</span><span class=\"badge bad\">2× unter 10 %</span>");
            expect(perf.html).toContain("<span class=\"mono\">2</span><span class=\"badge mid\">1× spät</span>");
            expect(perf.html).toContain("<span class=\"mono\">3 · Ø 0,9 s</span>");
        });

        it("covers activity, cooldowns and totems for a shaman, and deaths for a tank (case01)", () => {
            const ctx = reportContext(fixture("case01-report"), null);
            const dorn = sectionsOf(ctx, "Dorn").secs;
            const perf = sec(dorn, "perf");
            expect(perf).toMatchObject({ count: "86 %", tone: "mid", crumb: "Aktivität · Cooldowns · Zauber" });
            expect(perf.badge).toBe("<span class=\"badge mid\">Cooldowns 75 %</span>");
            expect(perf.html).toContain("<b>Aktivität &amp; Cooldowns</b><span class=\"badge\">86 %</span>");
            expect(perf.html).toContain("data-tip-sub=\"unerklärt 0:12 · durch Mechanik 0:08\">4 · längste 0:09</span>");
            expect(perf.html).toContain("<span class=\"mono\">0:06</span><span class=\"badge\">2 im Lust</span>");
            expect(perf.html).toContain("<b>Totems</b><span class=\"badge mid\">4 Lücken</span>");
            expect(perf.html).toContain("<span class=\"mono\">1 von 2 Kämpfen</span>");
            const prep = sec(dorn, "prep");
            expect(prep.tone).toBe("bad");
            expect(prep.badge).toBe("<span class=\"badge mid\">Buff fehlte 2×</span>");
            expect(prep.html).toContain("<b>Buffs</b><span class=\"badge bad\">2 lückenhaft</span>");
            const brokk = sectionsOf(ctx, "Brokk").secs;
            const err = sec(brokk, "err");
            expect(err.tone).toBe("bad");
            expect(err.count).toBe("1 Tod");
            expect(err.badge).toBe("<span class=\"badge bad\">1 vermeidbarer Tod</span>");
            expect(err.html).toContain("<b>Mechaniken</b><span class=\"badge bad\">3 Treffer</span>");
            expect(err.html).toContain("<b>Tode</b><span class=\"badge bad\">1 · 1 vermeidbar</span>");
            // a reader gets no Empfehlungen section without approved points
            expect(sec(brokk, "recs")).toBeUndefined();
        });

        it("reads the RPB parts and the paperdoll (case02)", () => {
            const ctx = reportContext(fixture("case02-report"), null);
            const { secs, dialogs } = sectionsOf(ctx, "Alice");
            const prep = sec(secs, "prep");
            expect(prep.tone).toBe("bad");
            expect(prep.html).toContain("<span class=\"k mute\"><span>Ø Itemlevel 110 · 3 Slots</span></span><button type=\"button\" class=\"btn btn-ghost btn-sm\" data-dialog=\"dlg-pd-0\">");
            expect(prep.html).toContain("<span class=\"mono\" data-tip=\"Schattenwiderstand aus Gear\" data-tip-sub=\"Shadow Cloak (+20)\">60</span>");
            expect(prep.html).toContain("Super-Manatrank 5</span>");
            expect(dialogs).toContain("<dialog class=\"dlg detail\" id=\"dlg-pd-0\">");
            expect(dialogs).toContain("<div class=\"doll\" style=\"--cc:#69CCF0\">");
            expect(dialogs).toContain("<div class=\"ilvl-badge\"><b>110</b><span>Ø iLvl</span></div>");
            expect(dialogs).toContain("<div class=\"slot-ench ok\">verzaubert</div>");
            expect(dialogs).toContain("<div class=\"slot-ench miss\">keine Verzauberung</div>");
            expect(dialogs).toContain("<div class=\"slot-ench bad\">suboptimale Verzauberung · falsche Verzauberung</div>");
            expect(dialogs).toContain("<span class=\"gemicon gem-empty\" data-tip=\"leerer Sockel\"></span>");
            expect(dialogs).toContain("<a class=\"gemicon gem-bad\" href=\"https://www.wowhead.com/tbc/item=8\"");
            expect(dialogs).toContain("href=\"https://www.wowhead.com/tbc/item=9001?gems=7\"");
            expect(dialogs).toContain("<div class=\"slot empty-slot slot-left\"><div class=\"slot-ph\"></div></div>");
            const perf = sec(secs, "perf");
            expect(perf.html).toContain("<b>Zauber &amp; Cooldowns</b>");
            expect(perf.html).toContain("Aktiv (RPB)");
            const err = sec(secs, "err");
            expect(err.html).toContain("<b>Vermeidbarer Schaden</b><span class=\"badge accent\">RPB</span>");
            expect(err.html).toContain("<span class=\"mono\">1.200</span>");
            const bob = sectionsOf(ctx, "Bob").secs;
            expect(sec(bob, "err").html).toContain("Sunder Armor</span></span><span class=\"mono\">20</span><span class=\"badge\">2 bei &lt; 5 Stacks</span>");
            expect(sec(bob, "prep").html).toContain("<div class=\"kv mute\"><span class=\"k\"><span>Keine Ausrüstung im Log.</span></span></div>");
        });

        it("renders a paperdoll slot without an enchant entry as neutral, not a throw (#483)", () => {
            const report = {
                id: "x",
                roster: [{
                    name: "A",
                    type: "Mage",
                    issues: [],
                    armory: [{ slot: 0, itemId: 1, itemName: "Mystery Item", icon: "inv_misc_questionmark.jpg", quality: 1, itemLevel: 100, gems: [], emptySockets: 0 }],
                }],
            };
            const { dialogs } = sectionsOf(reportContext(report, null), "A");
            expect(dialogs).toContain("Mystery Item");
            expect(dialogs).not.toContain("slot-ench");
            expect(dialogs).not.toContain("slot-badge");
        });

        it("marks a raider without any analysis as prepared and leaves out the other sections", () => {
            const ctx = reportContext({ id: "x", roster: [{ name: "A", type: "Mage", issues: [] }] }, null);
            const { secs } = sectionsOf(ctx, "A");
            expect(secs.map((s) => s.key)).toEqual(["prep"]);
            expect(sec(secs, "prep")).toMatchObject({ count: "ok", tone: "ok", badge: "<span class=\"badge ok\">vorbereitet</span>" });
            expect(sec(secs, "prep").html).toContain("<span class=\"mute\" data-tip=\"Noch keine CLA-Auswertung für diesen Log\">nicht ausgewertet</span>");
            expect(renderRaiderView(ctx, null)).toContain("<span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_shield_06.jpg\" alt=\"\">Gear ok</span>");
        });

        it("reads buffs cell by cell: wrong role, not provable, not expected, partly provable", () => {
            const report = {
                id: "x", roster: [{ name: "A", type: "Mage" }],
                raidBuffs: {
                    rows: [
                        { key: "might", label: "Might", provider: "Paladin", expected: true },
                        { key: "fort", label: "Fort", provider: "Priest", expected: false, unknown: 1 },
                        { key: "salv", label: "Salv", provider: "Paladin", expected: false, seenPlayers: 1 },
                        { key: "kings", label: "Kings", provider: "Paladin", expected: true },
                        { key: "gone", label: "Gone", expected: true },
                    ],
                    players: [{ name: "A", type: "Mage", buffs: {
                        might: { wrong: 2 }, fort: { expected: false, unknown: 2 }, salv: { expected: false },
                        kings: { expected: true, pct: 80, full: 1, partial: 0, none: 0, unknown: 1 },
                    }, missing: 0, partial: 1, late: 1, wrong: 1 }],
                },
            };
            const prep = sec(sectionsOf(reportContext(report, null), "A").secs, "prep");
            expect(prep.html).toContain("<span class=\"badge mid\">2× falsche Rolle</span>");
            expect(prep.html).toContain("<span class=\"badge count\" data-tip=\"Fort: nicht nachweisbar\"");
            expect(prep.html).toContain("<span class=\"badge\">nicht erwartet</span>");
            expect(prep.html).toContain("<span class=\"badge count\" data-tip=\"1× nicht nachweisbar\"");
            expect(prep.html).toContain("<b>Buffs</b><span class=\"badge mid\">3 lückenhaft</span>");
        });

        it("covers healer shields, RPB-only deaths and interrupts", () => {
            const report = {
                id: "x", roster: [{ name: "H", type: "Druid" }, { name: "K", type: "Rogue" }],
                healers: { players: [{ name: "H", type: "Druid", fights: 1, healingTotal: 5000, overhealPct: 55, potions: 0, dispels: 0, shields: [{ label: "LB", icon: "inv_lb", uptimeAvg: 90 }] }] },
                consumables: { players: [{ name: "K", type: "Rogue", buffed: 40, food: 100, weaponOiled: false }] },
                rpb: {
                    damage: { abilities: [{ label: "Feuer", name: "Fire" }], players: [{ name: "K", type: "Rogue", perAbility: [0], avoidableTotal: 0, deaths: 2 }] },
                    interrupts: { players: [{ name: "K", type: "Rogue", count: 3, spells: [{ name: "Heal", icon: "spell_heal", count: 3 }] }] },
                },
            };
            const ctx = reportContext(report, null);
            const h = sectionsOf(ctx, "H").secs;
            expect(sec(h, "perf").html).toContain("LB auf dem Tank");
            expect(sec(h, "perf").badge).toBe("<span class=\"badge mid\">Overheal 55 %</span>");
            const k = sectionsOf(ctx, "K").secs;
            expect(sec(k, "prep")).toMatchObject({ tone: "bad", count: "1" });
            const err = sec(k, "err");
            expect(err).toMatchObject({ count: "2 Tode", tone: "mid" });
            expect(err.html).toContain("Unterbrechungen</span></span><span class=\"mono\">3</span><div class=\"iconrow\">");
            expect(err.html).toContain("<b>Summe vermeidbar</b></span></span><span class=\"mono\">0</span>");
            const cards = renderRaiderView(ctx, null);
            expect(cards).toContain("Consumables 40 %</span>");
            expect(cards).toContain("Overheal 55 %</span>");
        });
    });

    describe("sendDialog", () => {
        it("offers the text choice per approved point and previews the DM", () => {
            const ctx = reportContext(fixture("case01-report"), LEAD);
            const p = ctx.report.roster[1];
            const html = sendDialog(ctx, p, 1, ctx.recByName.get("Elun").items);
            expect(html).toContain("<dialog class=\"dlg send\" id=\"send-1\" data-report=\"abc123def456\" data-player=\"Elun\">");
            expect(html).toContain("An <span class=\"cn\" style=\"--cc:#FFFFFF\">Elun</span> senden");
            expect(html).toContain("<span class=\"badge ok\">2 freigegeben</span>");
            expect(html).toContain("data-tip=\"Der noch offene Punkt wird nicht gesendet.\">1 offen · wird nicht gesendet</span>");
            expect(html).toContain("<div class=\"send-item on\" data-key=\"healers.mana\"");
            expect(html).toContain("data-mode=\"ai\"");
            expect(html).toContain("data-mode=\"custom\"");
            expect(html).toContain("<textarea class=\"send-text\" rows=\"3\">Bitte die Glyphe auf die Kapuze.</textarea>");
            expect(html).toContain("<textarea class=\"send-text\" rows=\"3\" readonly>Dein Tiefstand");
            expect(html).toContain("<a href=\"/r/abc123def456/p/1\" target=\"_blank\" rel=\"noopener\">Report ansehen");
            expect(html).toContain("2 Punkte von der Raidleitung geprüft");
            expect(html).toMatch(/<span class="badge">gesendet \d+\.\d+\.\d{4}, \d\d:\d\d:\d\d<\/span>/);
            expect(html).toContain("data-sendact=\"send\"><img");
        });

        it("disables sending without approved points and shortens a long text in the preview", () => {
            const long = "x".repeat(200);
            const ctx = reportContext({ id: "r", title: "T", roster: [] }, LEAD);
            const empty = sendDialog(ctx, { name: "Z", type: "Bard" }, 0, [{ key: "a", approved: null, title: "t", text: "t" }, { key: "b", approved: null, title: "u", text: "u" }]);
            expect(empty).toContain("<div class=\"rec-empty\">Noch nichts freigegeben.</div>");
            expect(empty).toContain("data-sendact=\"send\" disabled>");
            expect(empty).toContain("Die 2 noch offenen Punkte werden nicht gesendet.");
            expect(empty).toContain("<a href=\"/r/r\" target=\"_blank\"");
            expect(empty).toContain("<span class=\"badge\">noch nie gesendet</span>");
            expect(empty).toContain("--cc:var(--text)");
            const one = sendDialog(ctx, { name: "Z", type: "Mage" }, 0, [{ key: "a", approved: true, impact: "low", title: "t", text: long }]);
            expect(one).toContain(`${"x".repeat(160)} …</div>`);
            expect(one).toContain("1 Punkt von der Raidleitung geprüft");
            expect(one).toContain("data-mode=\"rule\"");
        });
    });
});
