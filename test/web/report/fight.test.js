// One boss fight on the report page (src/web/report/fight.js): the topic list
// and panels, the chart dialogs and the player's own strip.
const { renderFightSection } = require("../../../src/web/report/fight");

/** A kill with every topic the analyzers fill. */
function fullFight(over = {}) {
    return {
        id: 3, boss: "Gruul <the Dragonkiller>", encounterId: 650, kill: true, duration: 180000,
        deaths: [{ at: 30000, name: "Alice", type: "Mage", ability: "Shatter", avoidable: true }, { at: 90000, name: "Bob", type: "Warrior" }],
        debuffs: [
            { key: "sunder", label: "Sunder Armor", icon: "ability_sunder", stacks: [{ from: 0, to: 180000, stacks: 5 }], maxStacks: 5, uptimePct: 100, timeToMax: 8000, expected: true },
            { key: "coe", label: "Curse of Elements", icon: "spell_coe", missing: true, expected: true },
            { key: "ff", label: "Faerie Fire", bands: [[0, 90000]], uptimePct: 50, expected: true },
        ],
        totems: [
            { name: "Dorn", type: "Shaman", twisting: { detected: true }, rows: [{ label: "Windfury", icon: "spell_windfury", markers: [{ at: 1000 }], downtimes: [], uptimePct: 99 }] },
            { name: "Rain", type: "Shaman", rows: [
                { label: "Grace of Air", icon: "spell_goa", markers: [{ at: 2000 }], downtimes: [{ from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 6 }], uptimePct: 60 },
                { label: "Mana Spring", markers: [], value: "–", sub: "eigene Zeile", tone: "medium" },
            ] },
        ],
        cooldowns: {
            windows: [{ label: "Bloodlust", from: 10000, to: 50000 }],
            players: [
                { name: "Alice", type: "Mage", rows: [{ label: "Icy Veins", icon: "spell_iv", markers: [{ at: 12000 }], possibleUses: 2, missed: 1 }] },
                { name: "Bob", type: "Warrior", rows: [{ label: "Death Wish", markers: [{ at: 11000 }, { at: 100000 }], possibleUses: 2, missed: 0 }] },
                { name: "Cid", type: "Rogue", rows: [{ label: "Blade Flurry", markers: [{ at: 15000 }] }] },
                { name: "Dee", type: "Priest", rows: [{ label: "Power Infusion", markers: [], possibleUses: 4, missed: 4, value: "0/4" }] },
            ],
        },
        activity: [
            { name: "Alice", type: "Mage", bands: [[0, 170000]], gaps: [{ from: 170000, to: 180000 }], activePct: 94 },
            { name: "Bob", type: "Warrior", icon: "ability_warrior", bands: [[0, 100000]], gaps: [], activePct: 60 },
        ],
        mechanics: {
            mechanics: [{ key: "shatter", label: "Shatter", icon: "spell_shatter", hits: 4, players: 2, amount: 20000 }],
            players: [
                { name: "Alice", type: "Mage", byMechanic: { shatter: { label: "Shatter", icon: "spell_shatter", hits: 3, amount: 15000 } }, hits: [{ key: "shatter", at: 30000 }, { key: "shatter", at: 60000 }, { key: "shatter", at: 90000, amount: 5000 }] },
                { name: "Bob", type: "Warrior", byMechanic: { shatter: { label: "Shatter", icon: "spell_shatter", hits: 1 } }, hits: [{ key: "shatter", at: 45000 }] },
                { name: "Cid", type: "Rogue", byMechanic: {}, hits: [] },
            ],
        },
        healers: { healers: [{ name: "Elun", type: "Priest", healing: { total: 50000, overheal: 10000, overhealPct: 17, spells: [] }, mana: { available: false } }] },
        buffs: { paladins: 1, expected: ["kings"], players: [{ name: "Alice", type: "Mage", role: "caster", buffs: [{ key: "kings", label: "Kings", status: "none", expected: true, uptimePct: 0, bands: [] }], missing: ["kings"] }] },
        series: {
            step: 60000, dps: [1000, 1200, 800], hps: [300, 400, 200], bossHp: [100, 60, null, 10],
            players: [
                { name: "Alice", dps: [400, 100, 500], hps: [0, 0, 0] },
                { name: "Bob", dps: [600, 700, 300] },
                null,
            ],
        },
        ...over,
    };
}

const section = (html, id) => {
    const start = html.indexOf(`<div id="${id}" class="fight-part part"`);
    if (start < 0) return "";
    const next = html.indexOf("<div id=\"", start + 10);
    return html.slice(start, next < 0 ? undefined : next);
};

describe("web/report/fight", () => {
    describe("the raid view (card mode)", () => {
        const html = renderFightSection(fullFight(), (n) => (n === "Alice" ? "/r/x/p/0" : null), null, 2, 3, true, "card", "", { iconUrl: "/bosses/650.jpg", crumb: "Bosse › Gruul", subject: "auf Gruul" });

        it("has no stats row any more: the section opens with the topic list", () => {
            expect(html).toMatch(/^<section class="fight" id="fight-3">\s*<div class="topic-grid"><nav class="topic-nav" aria-label="Bereiche">/);
            expect(html).not.toContain("class=\"stats\"");
            expect(html).not.toContain("Raid-DPS</div>");
            expect(html).not.toContain("Debuffs erwartet");
            expect(html).not.toContain("<nav class=\"secs\">");
        });

        it("offers one button per topic with its brief line and tone dot, worst first, the first active", () => {
            const nav = html.slice(html.indexOf("<nav class=\"topic-nav\""), html.indexOf("</nav>"));
            expect(nav).toContain("<button type=\"button\" class=\"topic active\" data-show=\"fp-3-debuffs\">");
            expect(nav).toContain("<span class=\"tn\"><b>Debuffs</b><small>1 von 3 fehlten</small></span><span class=\"dot bad\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Totems</b><small>2 Schamanen · Twisting</small></span><span class=\"dot bad\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Cooldowns</b><small>38 % genutzt</small></span><span class=\"dot bad\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Aktivität</b><small>Ø 77 % aktiv</small></span><span class=\"dot bad\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Mechaniken</b><small>4 Treffer</small></span><span class=\"dot mid\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Heilung</b><small>1 Heiler</small></span><span class=\"dot ok\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Buffs</b><small>1 fehlten</small></span><span class=\"dot bad\"></span>");
            expect(nav).toContain("<span class=\"tn\"><b>Tode</b><small>2 Tode · 1 vermeidbar</small></span><span class=\"dot bad\"></span>");
            // the series is neutral: no verdict, last
            expect(nav).toContain("<span class=\"tn\"><b>Kampfverlauf</b><small>DPS und HPS</small></span><span class=\"dot none\"></span>");
            expect(nav.match(/class="topic active"/g)).toHaveLength(1);
            // worst first: every bad topic, then mid, then ok, then neutral
            const dots = [...nav.matchAll(/<span class="dot (\w+)"><\/span>/g)].map((m) => m[1]);
            expect(dots).toEqual(["bad", "bad", "bad", "bad", "bad", "bad", "mid", "ok", "none"]);
            expect(nav.indexOf("<b>Mechaniken</b>")).toBeLessThan(nav.indexOf("<b>Heilung</b>"));
            expect(nav.indexOf("<b>Heilung</b>")).toBeLessThan(nav.indexOf("<b>Kampfverlauf</b>"));
            expect(html).toContain("<div class=\"topic-panels\"><div id=\"fp-3-debuffs\" class=\"fight-part part\">");
            expect(html).toContain("<div id=\"fp-3-totems\" class=\"fight-part part\" hidden>");
        });

        it("heads each part with its label, the chart behind a dialog, worst debuffs first and the good ones folded", () => {
            const debuffs = section(html, "fp-3-debuffs");
            expect(debuffs).toContain("<div class=\"topic-head\"><h3>Debuffs</h3><button type=\"button\" class=\"btn btn-ghost btn-sm\" data-dialog=\"dlg-fp-3-debuffs\">");
            expect(debuffs).not.toContain("part-title");
            expect(debuffs).not.toContain("auf Gruul");
            expect(debuffs).not.toContain("class=\"kicker\"");
            expect(debuffs).toContain("<th>Debuff</th><th>Uptime</th>");
            expect(debuffs).toContain("Curse of Elements</td><td><span class=\"tv high\">fehlte</span></td><td>fehlt</td>");
            expect(debuffs).toContain("Faerie Fire</td><td><span class=\"tv high\">50%</span>");
            expect(debuffs).toContain("<tr class=\"fold-row\" hidden><td><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_sunder.jpg\" alt=\"\">Sunder Armor</td><td><span class=\"tv good\">100%</span></td><td>5/5 ab 0:08</td>");
            expect(debuffs).toContain("<tr class=\"fold-btn-row\"><td colspan=\"5\"><button type=\"button\" class=\"fold-btn\" data-unfold data-more=\"1 weitere ab 100 % Uptime anzeigen\" data-less=\"Weniger anzeigen\">");
            expect(debuffs.indexOf("Curse of Elements")).toBeLessThan(debuffs.indexOf("Faerie Fire"));
            expect(debuffs.indexOf("Faerie Fire")).toBeLessThan(debuffs.indexOf("Sunder Armor"));
            expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-3-debuffs\">");
            expect(html).toContain("<img class=\"vcard-icon\" src=\"/bosses/650.jpg\" alt=\"\">");
            expect(html).toContain("Gruul &lt;the Dragonkiller&gt; · Debuffs</div><div class=\"vcard-meta\">Kill · 3:00 · 6 px pro Sekunde, seitlich scrollen</div>");
        });
        it("groups totems per shaman, the one with gaps first, and draws one chart per shaman", () => {
            const totems = section(html, "fp-3-totems");
            expect(totems.indexOf(">Rain<")).toBeLessThan(totems.indexOf(">Dorn<"));
            expect(totems).toContain("<details class=\"grp\" style=\"--cc:#0070DE\" open>");
            expect(totems).toContain("<span class=\"badge bad\">3 Lücken</span>");
            expect(totems).toContain("<span class=\"badge ok\">Twisting</span>");
            expect(totems).toContain("Grace of Air</td><td><span class=\"tv high\">60%</span></td><td>3 Lücken</td>");
            expect(totems).toContain("Mana Spring</td><td><span class=\"tv medium\">–</span></td><td>eigene Zeile</td>");
            expect(html).toContain("<div class=\"dscope\" data-frole=\"all\"><div class=\"dtools\"><nav class=\"seg sm\"><button type=\"button\" class=\"seg-btn active\" data-frole=\"all\">Alle<span class=\"n\">2</span></button>");
            expect(html).toContain("<section class=\"fc-block\" data-role=\"Rain\" data-name=\"Rain\" style=\"--cc:#0070DE\">");
            expect(html).toContain("placeholder=\"Schamane suchen …\"");
        });

        it("groups cooldowns per player, the one who missed most first", () => {
            const cds = section(html, "fp-3-cooldowns");
            const order = [...cds.matchAll(/<span class="cn">(\w+)<\/span>/g)].map((m) => m[1]);
            expect(order).toEqual(["Dee", "Alice", "Bob", "Cid"]);
            expect(cds).toContain("<span class=\"badge bad\">0 von 4 genutzt</span>");
            expect(cds).toContain("<span class=\"badge mid\">1 von 2 genutzt</span>");
            expect(cds).toContain("<span class=\"badge ok\">2 von 2 genutzt</span>");
            expect(cds).toContain("<span class=\"badge\">1 Einsatz</span>");
            expect(cds).toContain("Power Infusion</td><td><span class=\"tv\">0/4</span></td>");
        });

        it("lists activity rows, toned, and mechanics per raider, the most hit first", () => {
            const act = section(html, "fp-3-activity");
            expect(act).toContain("Alice</td><td><span class=\"tv medium\">94%</span></td><td>1 Lücke</td>");
            expect(act).toContain("ability_warrior.jpg");
            const mech = section(html, "fp-3-mechanics");
            expect(mech.indexOf(">Alice<")).toBeLessThan(mech.indexOf(">Bob<"));
            expect(mech).not.toContain(">Cid<");
            expect(mech).toContain("<span class=\"badge bad\">3 Treffer</span><span class=\"badge bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_creature_cursed_05.jpg\" alt=\"\">1 vermeidbarer Tod</span>");
            expect(mech).toContain("<span class=\"badge\">1 Treffer</span><span class=\"badge\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_creature_cursed_05.jpg\" alt=\"\">1 Tod</span>");
        });

        it("summarises the series in a table and lists the deaths with links", () => {
            const series = section(html, "fp-3-series");
            expect(series).toContain("Raid-DPS</td><td class=\"mono\">Ø 1,0k</td><td class=\"mono\">max 1,2k</td>");
            expect(series).toContain("Raid-HPS</td><td class=\"mono\">Ø 300</td><td class=\"mono\">max 400</td>");
            expect(series).toContain("<tr><td>Boss-Leben</td><td class=\"mono\">Ende 10 %</td><td class=\"mono\">3 Messpunkte</td></tr>");
            expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-3-series\">");
            const deaths = section(html, "fp-3-deaths");
            expect(deaths).toContain("<a class=\"cn\" href=\"/r/x/p/0\">Alice</a>");
            expect(deaths).not.toContain("data-dialog=");
        });
    });

    describe("the player view (inline mode)", () => {
        it("shows the fight head and only the raider's own rows, charts inline", () => {
            const html = renderFightSection(fullFight(), null, "Alice", 1, 2, false, "inline", "p-", { crumb: "" });
            expect(html).toMatch(/^<section class="fight" id="p-fight-3" hidden>/);
            expect(html).toContain("<div class=\"fight-head\"><h3>Gruul &lt;the Dragonkiller&gt;</h3><span class=\"meta\">Try 1/2 · Kill · 3:00 · 2 Tode</span></div>");
            expect(html).not.toContain("class=\"stats\"");
            expect(html).not.toContain("data-show=\"p-fp-3-debuffs\"");
            expect(html).not.toContain("data-show=\"p-fp-3-totems\"");
            expect(html).toContain("data-show=\"p-fp-3-cooldowns\"");
            expect(html).toContain("Icy Veins</td>");
            expect(html).not.toContain("Death Wish");
            expect(html).not.toContain("<details class=\"grp\"");
            expect(html).toContain("<div class=\"part-chart\">");
            expect(html).not.toContain("<dialog");
            expect(html).not.toContain("Verlauf öffnen");
            // no healing part: Alice is no healer
            expect(html).not.toContain("data-show=\"p-fp-3-healing\"");
            // buffs as ribbons, own deaths only
            expect(html).toContain("Buffs<span class=\"n bad\">1 · 1 fehlten</span>");
            expect(html).toContain("Tode<span class=\"n bad\">1</span>");
        });

        it("draws the raider's own DPS against the raid mean with dip chips and Bloodlust marks", () => {
            const html = renderFightSection(fullFight(), null, "Alice", 1, 1, true, "inline", "p-", {});
            expect(html).toContain("<span class=\"meta\">Kill · 3:00 · 2 Tode</span>");
            expect(html).toContain("data-show=\"p-fp-3-series\"");
            // Alice dies at 0:30, so only the first bucket counts: mean 400, no dip
            expect(html).toContain("<span class=\"chip chip-good\"");
            expect(html).toContain("<b>0 %</b> der Zeit DPS-Einbrüche</span>");
            expect(html).toContain("<span class=\"chip\"><b>Ø 400</b> DPS</span>");
            expect(html).toContain("<span class=\"chip\"><b>Ø 500</b> Raid-Mittel pro Spieler</span>");
            expect(html).toContain("<div class=\"fight-series player-series\">");
        });

        it("picks HPS for a healer and leaves out the strip for a raider without a curve", () => {
            const f = fullFight({ series: { step: 60000, hps: [600, 600], players: [{ name: "Elun", hps: [300, 50], dps: [10, 10] }] } });
            const html = renderFightSection(f, null, "Elun", 1, 1, true, "inline", "p-", {});
            expect(html).toContain("<b>50 %</b> der Zeit HPS-Einbrüche</span>");
            expect(html).toContain("<span class=\"chip chip-high\"");
            expect(html).toContain("<b>Ø 600</b> Raid-Mittel pro Spieler");
            expect(html).toContain("Heilung<span class=\"n\">1</span>");
            const none = renderFightSection(fullFight(), null, "Nobody", 1, 1, true, "inline", "p-", {});
            expect(none).not.toContain("data-show=\"p-fp-3-series\"");
            expect(none).toContain("data-show=\"p-fp-3-fight\"");
        });

        it("tones dips from 25 % medium and leaves out the raid mean without a raid curve", () => {
            const f = fullFight({ deaths: [], cooldowns: null, series: { step: 60000, players: [{ name: "Bob", dps: [100, 100, 10, 100] }] } });
            const html = renderFightSection(f, null, "Bob", 1, 1, true, "inline", "p-", {});
            expect(html).toContain("<span class=\"chip chip-medium\"");
            expect(html).toContain("<b>25 %</b> der Zeit DPS-Einbrüche");
            expect(html).not.toContain("Raid-Mittel pro Spieler</span>");
        });
    });

    describe("a fight with nothing but the skeleton", () => {
        it("draws the fight itself as the one band, and a wipe with its health", () => {
            const html = renderFightSection({ id: 9, boss: "Maulgar", kill: false, fightPercentage: 32.5, duration: 120000, deaths: [] }, null, null, 1, 1, true, "card", "", null);
            expect(html).toMatch(/^<section class="fight fight-wipe" id="fight-9">/);
            expect(html).not.toContain("class=\"stats\"");
            // the deaths topic is ok, the fight itself neutral: ok comes first
            expect(html).toContain("<button type=\"button\" class=\"topic active\" data-show=\"fp-9-deaths\">");
            expect(html).toContain("<span class=\"tn\"><b>Kampf</b><small>2:00</small></span><span class=\"dot none\"></span>");
            expect(html).toContain("Kampf (Wipe)</td><td><span class=\"tv high\">2:00</span></td>");
            expect(html).toContain("<span class=\"tn\"><b>Tode</b><small>niemand gestorben</small></span><span class=\"dot ok\"></span>");
            expect(html).toContain("<div class=\"fc-empty\">Niemand ist gestorben.</div>");
            expect(html).toContain("Wipe bei 33 % · 2:00");
            expect(html).not.toContain("class=\"kicker\">");
        });

        it("says Kill for a bare kill and leaves out the debuff and DPS stats", () => {
            const html = renderFightSection({ id: 10, boss: "X", kill: true, duration: 60000 }, null, null, 1, 1, true, "card", "", { crumb: "Bosse › X" });
            expect(html).toContain("Kampf (Kill)</td><td><span class=\"tv good\">1:00</span></td>");
            expect(html).not.toContain("Raid-DPS");
            expect(html).not.toContain("Debuffs erwartet");
            // no crumb kicker in the part head any more
            expect(html).not.toContain("class=\"kicker\"");
            expect(html).toContain("<div class=\"topic-head\"><h3>Kampf</h3>");
        });
    });

    it("shows a single totem shaman as one flat chart and cooldowns without possible uses as ok", () => {
        const f = fullFight({
            debuffs: [{ key: "sunder", label: "Sunder", uptimePct: 100, expected: true }],
            totems: [{ name: "Dorn", type: "Shaman", rows: [{ label: "Windfury", markers: [], downtimes: [{}], uptimePct: 90 }] }],
            cooldowns: { players: [{ name: "Cid", type: "Rogue", rows: [{ label: "Blade Flurry", markers: [] }] }] },
            activity: [{ name: "Cid", type: "Rogue", bands: [[0, 1000]], activePct: 99 }],
            mechanics: null, healers: null, buffs: { players: [{ name: "Cid", type: "Rogue", buffs: [] }] }, series: null, deaths: [],
        });
        const html = renderFightSection(f, null, null, 1, 1, true, "card", "", {});
        // a single debuff row that is good enough to fold has nothing to fold it away from
        expect(html).toContain("<small>1 erwartet, alle da</small>");
        expect(html).not.toContain("fold-btn");
        expect(html).not.toContain("fold-row");
        expect(html).toContain("<small>Ø 99 % aktiv</small>");
        expect(html).toContain("<b>Totems</b><small>1 Schamane</small></span><span class=\"dot mid\"></span>");
        // the worst topic opens first
        expect(html).toContain("<button type=\"button\" class=\"topic active\" data-show=\"fp-3-totems\">");
        expect(html).toContain("<span class=\"badge mid\">1 Lücke</span>");
        expect(html).not.toContain("data-frole=\"Dorn\"");
        expect(html).toContain("<b>Cooldowns</b><small>1 Cooldown</small></span><span class=\"dot ok\"></span>");
        expect(html).toContain("<span class=\"badge\">0 Einsätze</span>");
        expect(html).toContain("<b>Buffs</b><small>alle da</small></span><span class=\"dot ok\"></span>");
        expect(html).toContain("<b>Tode</b><small>niemand gestorben</small></span><span class=\"dot ok\"></span>");
    });
});
