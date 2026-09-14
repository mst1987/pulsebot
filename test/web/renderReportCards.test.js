// The report page's three views (Raid · Bosse · Raider), the KPI cards, the
// boss and raider cards with their chips and sections, the chart dialogs, the
// send dialog and the role filter — for a reviewer and for everyone else.
const { renderReportPage, renderPlayerPage } = require("../../src/web/render.js");

function report(extra = {}) {
    return {
        id: "abc123def456",
        title: "Montagsraid Gruul",
        zone: "Gruul's Lair",
        date: "7.9.2026",
        players: [
            { name: "Brokk", type: "Warrior", issues: [] },
            { name: "Elun", type: "Priest", issues: [{ itemName: "Hood", itemId: 1, icon: "inv_helmet", severity: "medium", label: "keine Verzauberung" }] },
            { name: "Dorn", type: "Shaman", issues: [] },
        ],
        roster: [
            { name: "Brokk", type: "Warrior", issues: [], potions: { destruction: 0, haste: 1, mana: 0 }, armory: [] },
            { name: "Elun", type: "Priest", issues: [{ itemName: "Hood", itemId: 1, icon: "inv_helmet", severity: "medium", label: "keine Verzauberung" }], potions: { destruction: 0, haste: 0, mana: 3 }, armory: [] },
            { name: "Dorn", type: "Shaman", issues: [], potions: { destruction: 1, haste: 0, mana: 1 }, armory: [] },
        ],
        icons: {},
        consumables: { players: [
            { name: "Brokk", type: "Warrior", flask: 100, elixir: 0, buffed: 100, food: 100, weaponOiled: true },
            { name: "Elun", type: "Priest", flask: 100, elixir: 0, buffed: 100, food: 50, weaponOiled: false },
            { name: "Dorn", type: "Shaman", flask: 67, elixir: 0, buffed: 67, food: 100, weaponOiled: true },
        ], icons: {} },
        potions: { players: [{ name: "Dorn", type: "Shaman", destruction: 1, haste: 0, mana: 1, total: 2, byType: { destruction: 1, superMana: 1 } }], types: [{ key: "superMana", group: "mana", label: "Super-Manatrank", icon: "inv_potion_137", itemId: 22832 }], icons: {} },
        mechanics: { players: [{ name: "Brokk", type: "Warrior", hits: 3, amount: 9000, deaths: 1, avoidableDeaths: 1, earlyDeaths: 0, byMechanic: { "damage:Whirlwind": { label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", hits: 3, amount: 9000 } }, topMechanic: { key: "damage:Whirlwind", label: "Wirbelwind", icon: "ability_whirlwind", hits: 3 } }],
            mechanics: [{ key: "damage:Whirlwind", label: "Wirbelwind", icon: "ability_whirlwind", kind: "damage", hits: 3, amount: 9000, fights: 2 }], deaths: { total: 4, avoidable: 2, early: 1, nearEnd: 0, repeat: 0 } },
        healers: { players: [{ name: "Elun", type: "Priest", fights: 2, healingTotal: 300000, overhealPct: 21, topOverheal: { name: "Greater Heal", icon: "spell_holy_greaterheal", overhealPct: 42 }, manaMinAvg: 7, manaLowFights: 2, potions: 2, potionPcts: [50, 8], potionMissingFights: 0, dispels: 3, avgReactionMs: 900, shields: [] }], raid: { dispelsMissed: 2, missedByAbility: [{ ability: "Stille", icon: "spell_holy_silence", count: 2 }], tanks: ["Brokk"] } },
        activity: { players: [{ name: "Brokk", type: "Warrior", fights: 2, activeAvg: 94, gaps: 2, gapMs: 8000, unexplainedMs: 8000, mechanicMs: 0, longestGap: 5000 }, { name: "Dorn", type: "Shaman", fights: 2, activeAvg: 86, gaps: 4, gapMs: 20000, unexplainedMs: 12000, mechanicMs: 8000, longestGap: 9000 }] },
        cooldowns: { players: [{ name: "Dorn", type: "Shaman", fights: 2, uses: 3, possible: 4, missed: 1, usedPct: 75, avgFirstAtMs: 6000, stacked: 2, unstacked: 1 }] },
        totems: { players: [{ name: "Dorn", type: "Shaman", role: "melee", fights: 2, wfFights: 2, wfUptimeAvg: 87, twistingFights: 1, downtimeMs: 12000, gapCount: 4, slotDowntimeMs: { air: 12000 } }] },
        raidBuffs: { fights: 2, paladins: 1, players: [
            { name: "Brokk", type: "Warrior", role: "tank", fights: 2, buffs: { kings: { expected: 2, full: 1, late: 0, partial: 0, none: 1, present: 1, wrong: 0, pct: 50 } }, missing: 1, late: 0, partial: 0, wrong: 0 },
            { name: "Elun", type: "Priest", role: "healer", fights: 2, buffs: { kings: { expected: 2, full: 2, late: 0, partial: 0, none: 0, present: 2, wrong: 0, pct: 100 } }, missing: 0, late: 0, partial: 0, wrong: 0 },
            { name: "Dorn", type: "Shaman", role: "melee", fights: 2, buffs: { kings: { expected: 2, full: 0, late: 0, partial: 0, none: 2, present: 0, wrong: 0, pct: 0 } }, missing: 2, late: 0, partial: 0, wrong: 0 },
        ], rows: [{ key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", provider: "Paladin", group: "blessing", expect: "blessing", expected: true, fights: 2, slots: 6, full: 3, late: 0, partial: 0, none: 3, present: 3, wrong: 0, coveragePct: 50, missingPlayers: 2, seenPlayers: 2 }] },
        timeline: { fights: [
            {
                id: 2, boss: "High King Maulgar", encounterId: 649, kill: false, fightPercentage: 32, startTime: 0, endTime: 120000, duration: 120000,
                deaths: [{ at: 40000, name: "Brokk", type: "Warrior", ability: "Whirlwind", avoidable: true }],
                debuffs: [{ key: "sunder", label: "Sunder Armor", icon: "ability_warrior_sunder", expected: true, bands: [[5000, 120000]], maxStacks: 5, uptimePct: 96, gapCount: 1, longestGap: 5000, firstAt: 5000 }, { key: "misery", label: "Misery", icon: "spell_shadow_misery", expected: true, missing: true, bands: [], uptimePct: 0 }],
                cooldowns: { windows: [{ label: "Bloodlust", from: 3000, to: 43000 }], lust: { casts: 2, firstAt: 3000, spreadMs: 12000 }, players: [{ name: "Dorn", type: "Shaman", rows: [{ label: "Bloodlust", icon: "spell_nature_bloodlust", markers: [{ at: 3000 }], possibleUses: 1, missed: 0 }] }] },
                activity: [{ name: "Brokk", type: "Warrior", bands: [[0, 100000]], gaps: [{ from: 100000, to: 120000 }], activePct: 83 }, { name: "Dorn", type: "Shaman", bands: [[0, 120000]], gaps: [], activePct: 100 }],
                healers: { healers: [{ name: "Elun", type: "Priest", id: 1, judgedUntil: 120000, diedAt: null, healing: { total: 100000, overheal: 25000, absorbs: 0, overhealPct: 20, spells: [] }, mana: { available: false }, potions: 0, potionMissing: false, dispels: { count: 0, avgReactionMs: null, list: [] } }], tank: { id: 2, name: "Brokk", type: "Warrior", judgedUntil: 40000 }, shields: [], dispels: { total: 0, missed: [{ at: 50000, ability: "Stille", icon: "spell_holy_silence", target: "Dorn", targetType: "Shaman", durationMs: 8000 }], others: [] } },
                buffs: { paladins: 1, expected: ["kings"], players: [{ name: "Dorn", type: "Shaman", role: "melee", judgedUntil: 120000, diedAt: null, buffs: [{ key: "kings", label: "Segen der Könige", icon: "spell_magic_greaterblessingofkings", status: "none", uptimePct: 0, expected: true, wrong: false, bands: [] }], missing: ["kings"], late: [], partial: [], wrong: [] }], coverage: [] },
                series: { step: 60000, dps: [12000, 13000, 12200], hps: [3000, 3200, 3100], bossHp: [100, 60, 32] },
            },
            {
                id: 3, boss: "High King Maulgar", encounterId: 649, kill: true, fightPercentage: 0, startTime: 200000, endTime: 404000, duration: 204000,
                deaths: [], debuffs: [{ key: "sunder", label: "Sunder Armor", icon: "ability_warrior_sunder", expected: true, bands: [[2000, 204000]], maxStacks: 5, uptimePct: 99 }],
                series: { step: 60000, dps: [11000, 12000, 12500, 12300], hps: [3000, 3000, 3100, 3000], bossHp: [100, 70, 35, 0] },
            },
        ] },
        recommendations: {
            generatedAt: 1,
            raid: [
                { key: "raid.debuff.misery", impact: "high", title: "Misery: Ø 0 %, fehlte in 1 Kampf", text: "Wer Misery liefert, hält es dauerhaft auf dem Boss.", evidence: [{ label: "Boss", value: "High King Maulgar" }] },
                { key: "raid.avoidableDeaths", impact: "high", title: "2 vermeidbare Tode", text: "Mechaniken vor dem Pull noch einmal ansagen.", evidence: [] },
            ],
            players: [
                { name: "Brokk", type: "Warrior", items: [] },
                { name: "Elun", type: "Priest", items: [
                    { key: "healers.mana", impact: "high", title: "In 2 Kämpfen unter 10 % Mana", text: "Manatrank früher nehmen.", ai: "Dein Tiefstand lag im Schnitt bei 7 %. Nimm den ersten Manatrank schon bei 50 %.", evidence: [{ label: "Kämpfe unter 10 %", value: "2" }] },
                    { key: "healers.overheal", impact: "medium", title: "21 % Overheal", text: "Greater Heal später ansetzen.", evidence: [] },
                    { key: "gear", impact: "low", title: "Kopf ohne Verzauberung", text: "Hood verzaubern.", evidence: [] },
                ] },
                { name: "Dorn", type: "Shaman", items: [{ key: "totems.twisting", impact: "medium", title: "Twisting nur in 1 von 2 Kämpfen", text: "Windfury durchgehend twisten.", evidence: [] }] },
            ],
        },
        recommendationReview: { raid: {}, players: { Elun: { "healers.mana": { approved: true }, gear: { approved: true, text: "Bitte die Glyphe auf die Kapuze." } } } },
        recommendationSent: { Elun: { at: 1757600000000, by: "Lead", keys: ["healers.mana"], signature: "x" } },
        ...extra,
    };
}

const admin = { id: "u1", name: "Lead", isAdmin: true };
const reader = { id: "u3", name: "Member", isAdmin: false, access: { cla: { read: true } } };

describe("web/render — report page: head and views", () => {
    it("renders the four KPI cards from the report's own numbers", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<div class=\"kicker\">Log-Auswertung · Zone: Gruul&#39;s Lair · 7.9.2026</div>");
        expect(html).toContain("Bosse</div>");
        expect(html).toContain("<div class=\"kpi-v\">1 <small>· 1 Kill, 1 Wipe</small></div>");
        expect(html).toContain("Tode</div>");
        expect(html).toContain("<div class=\"kpi-v bad\">4 <small class=\"bad\">· 2 vermeidbar</small></div>");
        expect(html).toContain("Offene Empfehlungen</div>");
        expect(html).toContain("<div class=\"kpi-v\">4 <small>· bei 2 von 3 Raidern</small></div>"); // raid 2 + Elun 1 + Dorn 1
        expect(html).toContain("Flask / Elixiere</div>");
        expect(html).toContain("<div class=\"kpi-v warn\">89 % <small>· Ø Food 83 %</small></div>");
    });

    it("switches between Raid, Bosse and Raider with the data-show mechanism and keeps the view in the hash", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<nav class=\"seg views\">");
        expect(html).toContain("data-show=\"view-raid\"");
        expect(html).toMatch(/Raid<span class="n(?: mid| bad)?">/);
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-bosse\"");
        expect(html).toMatch(/Bosse<span class="n(?: mid| bad)?">1<\/span>/);
        expect(html).toMatch(/Raider<span class="n(?: mid| bad)?">3<\/span>/);
        expect(html).toContain("<div id=\"view-raid\" class=\"view\" hidden>");
        expect(html).toContain("<div id=\"view-bosse\" class=\"view\">");
        expect(html).toContain("<div id=\"view-raider\" class=\"view\" hidden>");
        expect(html).toContain("history.replaceState(null,\"\",\"#\"+id)");
        expect(html).toContain("/^raider-(.+)$/");
        expect(html.match(/window\.__ehShow=1/g)).toHaveLength(1);
        expect(html.match(/window\.__ehDlg=1/g)).toHaveLength(1);
    });

    it("groups the raid-wide parts into four areas with metric cards, each opening its table as a dialog", () => {
        const html = renderReportPage(report(), admin);
        // Empfehlungen · Vorbereitung · Leistung · Fehler, in this order
        const at = (s) => html.indexOf(s);
        expect(at("id=\"rs-rec-raid\"")).toBeGreaterThan(0);
        expect(at("id=\"rg-prep\"")).toBeGreaterThan(at("id=\"rs-rec-raid\""));
        expect(at("id=\"rg-perf\"")).toBeGreaterThan(at("id=\"rg-prep\""));
        expect(at("id=\"rg-err\"")).toBeGreaterThan(at("id=\"rg-perf\""));
        expect(html).toMatch(/Raid<span class="n mid">4<\/span>/);
        // the area head: tile, title, breadcrumb, one count badge
        expect(html).toMatch(/<section class="gcard" id="rg-prep"><div class="part-head gh"><span class="tile mid"><img class="hicon"[^>]*trade_alchemy\.jpg" alt=""><\/span><div class="gh-title"><b>Vorbereitung<\/b><span class="kicker">Raid › Buffs · Debuffs · Consumables · Gear<\/span><\/div><span class="grow"><\/span><span class="badge mid count">\d Bereiche? auffällig<\/span><\/div>/);
        for (const [group, ids] of [["prep", ["raidbuffs", "consumables", "potions", "gear"]], ["perf", ["activity", "cooldowns", "healers", "totems"]], ["err", ["mechanics"]]]) {
            const g = html.slice(at(`id="rg-${group}"`), html.indexOf("</section>", at(`id="rg-${group}"`)));
            for (const id of ids) {
                expect(g).toContain(`<div class="mcard${id === "mechanics" ? " wide" : ""}" id="rs-${id}" role="button" tabindex="0" data-dialog="dlg-rs-${id}">`);
                expect(g).toContain(`<dialog class="dlg detail" id="dlg-rs-${id}">`);
            }
        }
        // a card: icon, the title with its explanation in the tooltip, one value, badges, who stands out
        expect(html).toMatch(/<span class="mc-label" data-tip="Aktivität" data-tip-sub="Anteil der Kampfzeit[^"]*">Aktivität<\/span>/);
        expect(html).toContain("<div class=\"mc-val\">90 %<small>Ø aktiv</small></div>");
        expect(html).toMatch(/<div class="mc-who"><span class="kicker">Niedrigste<\/span><span class="who"><img class="cls"[^>]*classicon_shaman\.jpg" alt=""><span class="cn" style="--cc:#0070DE">Dorn<\/span><\/span><span class="mono mute">86 %<\/span>/);
        // the wide mechanics card carries its top mechanics as bars
        expect(html).toContain("<div class=\"mc-val bad\">4<small>Tode</small></div>");
        expect(html).toMatch(/<div class="mc-table"><table class="idx"><tr><th>Mechanik<\/th><th>Treffer<\/th><th>Getroffen<\/th><\/tr><tr><td><img class="hicon"[^>]*>Wirbelwind<\/td><td><span class="bar"><i class="high" style="width:100%"><\/i><b class="high">3<\/b><\/span><\/td><td class="mute">1 Raider<\/td><\/tr>/);
        // the old summaries are the dialog bodies now
        expect(html).toContain("<th>Spieler</th><th>Kämpfe</th><th>Einsätze / möglich</th>");
        expect(html).toContain("<td class=\"mono\">3 / 4</td>");
        expect(html).toContain("<th>Schamane</th><th>Kämpfe</th>");
        expect(html).toContain("2 vermeidbar</span>");
        expect(html).toContain("Wirbelwind<div class=\"sritems\">Schaden</div>");
        expect(html).not.toContain("class=\"rsec\"");
    });

    it("draws the raid's findings as one row each, with the one send action in the area head", () => {
        const html = renderReportPage(report(), admin);
        const recs = html.slice(html.indexOf("id=\"rs-rec-raid\""), html.indexOf("</section>", html.indexOf("id=\"rs-rec-raid\"")));
        expect(recs).toContain("<b>Empfehlungen an den Raid</b><span class=\"kicker\">Raid › Empfehlungen · 2 offen · 0 freigegeben</span>");
        expect(recs).toMatch(/<button type="button" class="btn btn-sm" data-dialog="dlg-rs-send"><img[^>]*inv_letter_15\.jpg" alt="">Alle senden …<\/button>/);
        expect(recs).toContain("<details class=\"rec rrow-d rec-high rec-state-open\" data-key=\"raid.debuff.misery\">");
        expect(recs).toMatch(/<summary class="rrow"><span><span class="badge bad">hoch<\/span><\/span><span class="t rec-title" data-tip="Misery: Ø 0 %, fehlte in 1 Kampf">Misery: Ø 0 %, fehlte in 1 Kampf<\/span><span class="ev"><span class="badge ev-b" data-tip="Boss" data-tip-sub="High King Maulgar">Boss <b>High King Maulgar<\/b><\/span><\/span><span class="st"><span class="badge rec-state mid">offen<\/span><\/span><span class="acts rec-review"/);
        expect(recs.match(/class="ibtn"[^>]*data-review="(?:approve|reject|edit)"/g)).toHaveLength(6); // three per finding
        expect(recs).toContain("<dialog class=\"dlg detail\" id=\"dlg-rs-send\">");
    });

    it("ships only inline scripts that parse", () => {
        for (const html of [renderReportPage(report(), admin), renderReportPage(report(), reader), renderPlayerPage(report(), 1, admin)]) {
            const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
            expect(scripts.length).toBeGreaterThan(3);
            for (const src of scripts) expect(() => new Function(src)).not.toThrow();
        }
    });

    it("renders no explanatory paragraphs and no text glyphs on the report pages", () => {
        for (const html of [renderReportPage(report(), admin), renderReportPage(report(), reader), renderPlayerPage(report(), 1, admin), renderPlayerPage(report(), 1, reader)]) {
            const body = html.slice(html.indexOf("<body"));
            // the raid view and the raider view resp. the player page up to its dialogs: the explanations sit in tooltips
            const raidView = html.includes("id=\"view-raid\"") ? html.slice(html.indexOf("id=\"view-raid\""), html.indexOf("id=\"view-bosse\"")) : "";
            const raiderView = html.includes("id=\"view-raider\"") ? html.slice(html.indexOf("id=\"view-raider\"")).replace(/<dialog[\s\S]*?<\/dialog>/g, "") : "";
            const page = html.includes("id=\"p-points\"") ? html.slice(html.indexOf("id=\"p-points\""), html.indexOf("<dialog", html.indexOf("id=\"p-points\""))) : "";
            for (const part of [raidView.replace(/<dialog class="dlg chart"[\s\S]*?<\/dialog>/g, ""), raiderView, page]) expect(part).not.toMatch(/<p class="note">/);
            expect(body).not.toMatch(/[✓✗○⤢←↗⌀]/);
            expect(body).not.toContain("→ Warcraft Logs");
            expect(body).not.toContain("class=\"legend\"");
            expect(body).not.toContain("class=\"tblswitch\"");
            expect(body).not.toMatch(/\bdv-[1-4]\b/);
            expect(body).not.toMatch(/\stitle="/);
        }
    });
});

describe("web/render — boss cards", () => {
    it("draws one card per boss with icon, meta line and the chips, the first open", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<details class=\"vcard boss-card\" id=\"boss-e649\" open>");
        expect(html).toContain("<img class=\"vcard-icon\" src=\"/bosses/649.jpg\" alt=\"\">");
        // the meta line is badges now: tries, the wipe, the kill, the deaths (with the avoidable ones)
        expect(html).toContain("<div class=\"vcard-meta\"><span class=\"badge count\">2 Tries</span><span class=\"badge bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg\" alt=\"\">Wipe bei 32 %</span><span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg\" alt=\"\">Kill 3:24</span><span class=\"badge bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_creature_cursed_05.jpg\" alt=\"\">1 Tod · 1 vermeidbar</span></div>");
        expect(html).toContain("<span class=\"exp-lbl\"><span class=\"exp-w\">Details</span><span class=\"exp\"><svg");
        // every chip explains itself in the page's tooltip box
        expect(html).toMatch(/<span class="chip chip-x bad" data-tip="Erwartete Debuffs, die in mindestens einem Try kein einziges Mal auf dem Boss lagen" data-tip-sub="[^"]+">(?:<img[^>]*>)?<b>1<\/b> Debuff fehlte<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x warn" data-tip="Spieler, denen[^"]*" data-tip-sub="[^"]+">(?:<img[^>]*>)?<b>1<\/b> Buffs fehlten<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x" data-tip="Dispelbare Debuffs[^"]*" data-tip-sub="[^"]+">(?:<img[^>]*>)?<b>1<\/b> nie dispellt<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x ok" data-tip="Schaden des ganzen Raids pro Sekunde im Kill-Try, im Mittel über den Kampf" data-tip-sub="[^"]+">(?:<img[^>]*>)?<b>11,9k<\/b> Raid-DPS<\/span>/); // the kill's mean, not the wipe's
    });

    it("puts the try pills, the stats row and the section buttons into the open card", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("class=\"try-pill active try-wipe\" data-show=\"fight-2\">Try 1<span class=\"s\">Wipe bei 32 % · 2:00</span>");
        expect(html).toContain("Raid-DPS</div><div class=\"stat-v\">12,4k</div>");
        expect(html).not.toContain("Bloodlust</div><div class=\"stat-v\">"); // dropped from the stats row on request; the windows stay in the Cooldowns chart
        expect(html).toContain("Aktivität Ø</div><div class=\"stat-v warn\">92 %</div>");
        expect(html).toContain("Debuffs erwartet</div><div class=\"stat-v\">2 <small class=\"bad\">· 1 fehlte</small></div>");
        expect(html).toContain("Tode</div><div class=\"stat-v bad\">1 <small>· Brokk 0:40</small></div>");
        expect(html).toContain("class=\"sec active\" data-show=\"fp-2-debuffs\">");
        expect(html).toContain("Debuffs<span class=\"n bad\">2 · 1 fehlt</span>");
        expect(html).toMatch(/Cooldowns<span class="n(?: mid| bad)?">1 · 100 % genutzt<\/span>/);
        expect(html).toMatch(/Heilung<span class="n(?: mid| bad)?">1 · 1 Heiler<\/span>/);
        expect(html).toMatch(/Buffs<span class="n(?: mid| bad)?">1 · 1 fehlten<\/span>/);
        expect(html).toContain("Kampfverlauf</button>");
        expect(html).toMatch(/Tode<span class="n(?: mid| bad)?">1<\/span>/);
    });

    it("shows the compact table first and the chart behind a dialog button", () => {
        const html = renderReportPage(report(), admin);
        // the part head: a tile in the topic's tone, the title, the breadcrumb under it
        expect(html).toContain("<div class=\"part-title\"><span class=\"tile bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_shadow_chilltouch.jpg\" alt=\"\"></span><div>Debuffs · auf High King Maulgar<span class=\"kicker\">Bosse › High King Maulgar › Try 1 › Debuffs</span></div></div>");
        expect(html).toContain("<button type=\"button\" class=\"btn btn-ghost btn-sm\" data-dialog=\"dlg-fp-2-debuffs\">");
        expect(html).toContain("Misery</td><td><span class=\"tv high\">fehlte</span></td><td>fehlt</td>");
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-2-debuffs\">");
        expect(html).toContain("<div class=\"dlg-title\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_shadow_chilltouch.jpg\" alt=\"\">High King Maulgar · Debuffs</div>");
        expect(html).toContain("Wipe bei 32 % · 2:00 · 6 px pro Sekunde, seitlich scrollen");
        // the chart lives in the dialog, the table in the card
        const dialog = html.slice(html.indexOf("<dialog class=\"dlg chart\" id=\"dlg-fp-2-debuffs\">"), html.indexOf("</dialog>", html.indexOf("id=\"dlg-fp-2-debuffs\"")));
        expect(dialog).toContain("<svg class=\"fchart");
        expect(dialog).toContain("data-close");
        const card = html.slice(html.indexOf("<div id=\"fp-2-debuffs\""), html.indexOf("<dialog class=\"dlg chart\" id=\"dlg-fp-2-debuffs\">"));
        expect(card).not.toContain("<svg class=\"fchart");
        // list-only topics (deaths, raid buffs) get no dialog
        expect(html).not.toContain("id=\"dlg-fp-2-deaths\"");
        expect(html).not.toContain("id=\"dlg-fp-2-buffs\"");
        // the healing topic keeps the numbers in the card and the mana curves in the dialog
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-fp-2-healing\">");
        expect(html).toContain("Nie entfernte Debuffs<span class=\"meta\">1</span>");
    });

    it("lists the raid recommendations that name the boss under the card, with controls for a reviewer", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("Empfehlungen zu diesem Boss</div><ul class=\"rec-list\">");
        const block = html.slice(html.indexOf("Empfehlungen zu diesem Boss"), html.indexOf("</details>", html.indexOf("Empfehlungen zu diesem Boss")));
        expect(block).toContain("Misery: Ø 0 %, fehlte in 1 Kampf");
        expect(block).not.toContain("2 vermeidbare Tode");
        expect(block).toContain("data-scope=\"raid\" data-player=\"\" data-key=\"raid.debuff.misery\"");
        // for a reader only approved ones, so nothing here yet
        expect(renderReportPage(report(), reader)).not.toContain("Empfehlungen zu diesem Boss");
    });
});

describe("web/render — raider cards", () => {
    it("draws one closed card per raider with class icon, role, fight count and at most three badges", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Elun\" data-name=\"Elun\" data-role=\"healer\" data-open=\"1\" data-report=\"abc123def456\" style=\"--cc:#FFFFFF\">");
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Brokk\" data-name=\"Brokk\" data-role=\"tank\" data-open=\"0\"");
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Dorn\" data-name=\"Dorn\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("<div class=\"vcard-title cn\">Elun</div><div class=\"vcard-meta\"><span class=\"badge\">Priest</span><span class=\"badge accent\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_holy_flashheal.jpg\" alt=\"\">Heiler</span><span class=\"badge count\">1 Kampf</span></div>");
        const head = (name) => { const at = html.indexOf(`id="raider-${name}"`); return html.slice(at, html.indexOf("</summary>", at)); };
        const chips = (name) => { const h = head(name); return h.slice(h.indexOf("<div class=\"vcard-chips\">"), h.indexOf("</div>", h.indexOf("<div class=\"vcard-chips\">"))); };
        for (const name of ["Brokk", "Elun", "Dorn"]) expect((chips(name).match(/<span class="badge/g) || []).length).toBeLessThanOrEqual(3);
        // worst first: Brokk's avoidable death, Elun's mana, Dorn's consumables
        expect(chips("Brokk")).toMatch(/^<div class="vcard-chips"><span class="badge bad"[^>]*><img[^>]*ability_creature_cursed_05\.jpg" alt="">1 vermeidbarer Tod<\/span>/);
        expect(chips("Elun")).toContain("inv_potion_137.jpg\" alt=\"\">2× unter 10 % Mana</span>");
        expect(chips("Elun")).toContain("inv_shield_06.jpg\" alt=\"\">1 Gear-Problem</span>");
        expect(chips("Dorn")).toContain("inv_alchemy_endlessflask_05.jpg\" alt=\"\">Consumables 67 %</span>");
        // the timeline and the player page are icon buttons in the head
        expect(head("Elun")).toMatch(/<button type="button" class="ibtn" data-tip="Kampfverlauf öffnen" data-tip-sub="1 Kampf mit eigenen Zeilen[^"]*" aria-label="Kampfverlauf öffnen" data-dialog="dlg-rt-1"><img class="hicon"[^>]*inv_misc_pocketwatch_01\.jpg" alt=""><\/button>/);
        expect(head("Elun")).toMatch(/<a class="ibtn" href="\/r\/abc123def456\/p\/1" data-tip="Spielerseite öffnen"/);
    });

    it("offers four sections: recommendations, preparation, performance, mistakes", () => {
        const html = renderReportPage(report(), admin);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        const card = elun.slice(0, elun.indexOf("</details>\n    </details>") > 0 ? elun.length : elun.length);
        expect(card.match(/class="sec( active)?" data-show="rc1-/g)).toHaveLength(3); // Elun: no hits, no deaths
        for (const key of ["recs", "prep", "perf"]) expect(card).toContain(`data-show="rc1-${key}"`);
        expect(card).not.toContain("data-show=\"rc1-err\"");
        expect(card).not.toContain("data-show=\"rc1-tl\"");
        expect(card).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">3 · 1 offen<\/span>/);
        expect(card).toContain("<div id=\"rc1-recs\" class=\"part\">");
        expect(card).toContain("<div id=\"rc1-prep\" class=\"part\" hidden>");
        expect(card).toContain("data-scope=\"player\" data-player=\"Elun\" data-key=\"healers.mana\"");
        expect(card).toContain("<span class=\"rec-source\" data-tip=\"Von Claude formuliert\" data-tip-sub=\"Der Regeltext dahinter steht im Tooltip des Textes.\">KI</span>");
        // Vorbereitung: gear, consumables and buffs as three boxes; only the problem items in the gear box
        expect(card).toContain("<div class=\"cols3\"><div class=\"box\"><div class=\"box-head\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_shield_06.jpg\" alt=\"\"><b>Gear</b><span class=\"badge mid\">1 Problem</span></div>");
        expect(card).toContain("<span>Hood</span></a></span><span class=\"badge mid\">keine Verzauberung</span>");
        expect(card).toContain("Keine Ausrüstung im Log.");
        expect(card).toContain("<b>Consumables</b>");
        expect(card).toContain("<b>Buffs</b>");
        // Leistung: healing and mana for the healer
        expect(card).toContain("<b>Heilung &amp; Mana</b>");
        expect(card).toContain("<span class=\"mono\">300k</span>");
        // the timeline dialog with the raider's own slice, namespaced ids
        expect(card).toContain("<dialog class=\"dlg chart\" id=\"dlg-rt-1\">");
        expect(card).toContain("data-show=\"r1-fb-e649\"");
        expect(card).toContain("id=\"r1-fight-2\">");
        expect(card).toMatch(/<a class="btn btn-ghost btn-sm" href="\/r\/abc123def456\/p\/1">Spielerseite<svg/);
        // a tank's mistakes, a shaman's totems
        const brokk = html.slice(html.indexOf("id=\"raider-Brokk\""), html.indexOf("id=\"raider-Elun\""));
        expect(brokk).toContain("data-show=\"rc0-err\"");
        expect(brokk).toMatch(/Fehler<span class="n bad">1 Tod<\/span>/);
        expect(brokk).toMatch(/<b>Mechaniken<\/b><span class="badge bad">3 Treffer<\/span>/);
        expect(brokk).toMatch(/<b>Tode<\/b><span class="badge bad">1 · 1 vermeidbar<\/span>/);
        expect(brokk).toContain("High King Maulgar <span class=\"mono mute\">0:40</span>");
        expect(brokk).toMatch(/Leistung<span class="n(?: mid| bad)?">94 %<\/span>/);
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).toContain("<b>Totems</b>");
        expect(dorn).toContain("<span class=\"mono\">1 von 2 Kämpfen</span>");
        expect(dorn).toContain("class=\"potions\"");
        expect(dorn).toContain("inv_potion_137.jpg");
    });

    it("puts the paperdoll behind \"Ausrüstung\" as a dialog", () => {
        const r = report();
        r.roster[0].armory = [{ slot: 0, itemId: 5, itemName: "Helm", icon: "inv_helmet_98", quality: 4, itemLevel: 141, enchant: { status: "ok" }, gems: [], emptySockets: 0 }];
        const html = renderReportPage(r, admin);
        expect(html).toMatch(/<span>Ø Itemlevel 141 · 1 Slots<\/span><\/span><button type="button" class="btn btn-ghost btn-sm" data-dialog="dlg-pd-0">/);
        expect(html).toContain("<dialog class=\"dlg detail\" id=\"dlg-pd-0\">");
        const dlg = html.slice(html.indexOf("id=\"dlg-pd-0\""), html.indexOf("</dialog>", html.indexOf("id=\"dlg-pd-0\"")));
        expect(dlg).toContain("<div class=\"doll\"");
        expect(dlg).toContain("<b>141</b><span>Ø iLvl</span>");
    });

    it("gives reviewers the footer with the phrasing job and the send dialog, only approved points inside", () => {
        const html = renderReportPage(report(), admin);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        expect(elun).toContain("<span class=\"note\">2 freigegeben · 1 offen · zuletzt gesendet: ");
        expect(elun).toMatch(/<button type="button" class="btn btn-run btn-sm" data-phrase="player"[^>]*><img class="hicon"[^>]*inv_scroll_03\.jpg" alt="">KI-Formulierung<\/button>/);
        expect(elun).toMatch(/<button type="button" class="btn btn-sm" data-dialog="send-1"><img class="hicon"[^>]*inv_letter_15\.jpg" alt="">Vorschau &amp; senden<\/button>/);
        expect(elun).toContain("<dialog class=\"dlg send\" id=\"send-1\" data-report=\"abc123def456\" data-player=\"Elun\">");
        // head: tile, the name in class colour, the counts as badges
        expect(elun).toContain("<div class=\"dlg-title\">An <span class=\"cn\" style=\"--cc:#FFFFFF\">Elun</span> senden</div><div class=\"kicker\">Elun › Empfehlungen › Versand · Discord-DM</div></div><span class=\"badge ok\">2 freigegeben</span><span class=\"badge mid\" data-tip=\"Der noch offene Punkt wird nicht gesendet.\">1 offen · wird nicht gesendet</span>");
        // the two approved points, the open one only counted
        expect(elun).toContain("data-key=\"healers.mana\" data-title=\"In 2 Kämpfen unter 10 % Mana\" data-ai=\"Dein Tiefstand lag im Schnitt bei 7 %. Nimm den ersten Manatrank schon bei 50 %.\" data-rule=\"Manatrank früher nehmen.\" data-custom=\"\" data-mode=\"ai\"");
        expect(elun).toContain("data-key=\"gear\" data-title=\"Kopf ohne Verzauberung\" data-ai=\"\" data-rule=\"Hood verzaubern.\" data-custom=\"Bitte die Glyphe auf die Kapuze.\" data-mode=\"custom\"");
        expect(elun).not.toContain("data-key=\"healers.overheal\" data-title");
        // text choice KI / Regel / Eigener with icons, the precedence in the tooltip
        expect(elun).toMatch(/<nav class="seg sm" data-tip="Welcher Text geht raus\?" data-tip-sub="Der eigene Text geht vor dem KI-Text[^"]*"><button type="button" class="seg-btn active" data-txt="ai"><img class="hicon"[^>]*inv_scroll_03\.jpg" alt="">KI<\/button><button type="button" class="seg-btn" data-txt="rule">Regel<\/button><button type="button" class="seg-btn" data-txt="custom"><svg/);
        expect(elun).toContain("<textarea class=\"send-text\" rows=\"3\" readonly>Dein Tiefstand lag im Schnitt bei 7 %. Nimm den ersten Manatrank schon bei 50 %.</textarea>");
        expect(elun).toContain("<textarea class=\"send-text\" rows=\"3\">Bitte die Glyphe auf die Kapuze.</textarea>");
        // the DM preview in the Discord look, the mapping badge filled from the send endpoint
        expect(elun).toContain("<b>EventHelper</b><span class=\"badge accent\">BOT</span>");
        expect(elun).toContain("<b>Montagsraid Gruul · Deine Auswertung</b>");
        expect(elun).toContain("2 Punkte von der Raidleitung geprüft");
        expect(elun).toContain("href=\"/r/abc123def456/p/1\" target=\"_blank\" rel=\"noopener\">Report ansehen<svg");
        expect(elun).toContain("<span class=\"badge map-badge\">Zuordnung wird geprüft …</span>");
        expect(elun).toContain("data-sendact=\"save\">Nur speichern</button>");
        expect(elun).toMatch(/data-sendact="send"><img class="hicon"[^>]*>Per Bot senden<\/button>/);
        expect(html).toContain("window.__ehSendDlg");
        expect(html).toContain("/api/cla/recommendations/send");
        expect(html).toContain("players:[who]");
        // a raider without approved points gets the button disabled
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).toContain("data-dialog=\"send-2\" disabled>");
        expect(dorn).toContain("Noch nichts freigegeben.");
        expect(dorn).toContain("noch nie gesendet</span>");
    });

    it("carries the role filter with WoW icons, the search and the open-count attributes for the inline script", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<input type=\"search\" id=\"raiderSearch\" placeholder=\"Raider suchen…\"");
        expect(html).toContain("data-rolefilter=\"all\">Alle</button>");
        expect(html).toMatch(/data-rolefilter="tank"><img class="hicon"[^>]*inv_shield_06\.jpg" alt="">Tank<\/button>/);
        expect(html).toMatch(/data-rolefilter="healer"><img class="hicon"[^>]*spell_holy_flashheal\.jpg" alt="">Heiler<\/button>/);
        expect(html).toMatch(/data-rolefilter="dps"><img class="hicon"[^>]*ability_dualwield\.jpg" alt="">DPS<\/button>/);
        expect(html).toMatch(/data-rolefilter="open"><img class="hicon"[^>]*>Offen <span class="n mid">2<\/span><\/button>/);
        expect(html).toContain("window.__ehFilter");
        expect(html).toContain("<div class=\"raider-empty\" id=\"raiderEmpty\" hidden>");
    });

    it("shows a non-reviewer only the approved points, no controls, no footer, no send dialog", () => {
        const html = renderReportPage(report(), reader);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        expect(elun).toContain("data-open=\"2\"");
        expect(elun).toMatch(/Empfehlungen<span class="n(?: mid| bad)?">2<\/span>/);
        expect(elun).toContain("In 2 Kämpfen unter 10 % Mana");
        expect(elun).not.toContain("21 % Overheal</span><span class=\"ev\"");
        expect(elun).not.toContain("data-review=");
        expect(elun).not.toContain("class=\"raider-foot\"");
        expect(elun).not.toContain("<dialog class=\"dlg send\"");
        expect(html).toMatch(/data-rolefilter="open"><img class="hicon"[^>]*>Empfehlungen <span class="n mid">1<\/span><\/button>/);
        expect(html).not.toContain("window.__ehReview");
        expect(html).not.toContain("window.__ehSendDlg");
        expect(html).not.toContain("dlg-rs-send");
        // a raider with nothing approved gets no recommendations section at all
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).not.toContain("data-show=\"rc2-recs\"");
    });
});

describe("web/render — player page", () => {
    it("puts the raider's points first, then the fights per boss, the details folded under them", () => {
        const html = renderPlayerPage(report(), 1, admin); // Elun
        expect(html).toContain("<title>Elun — Montagsraid Gruul</title>");
        // head: 64-px class icon, name in class colour, badges, back to the report and send
        expect(html).toContain("<img class=\"phead-icon\" src=\"https://wow.zamimg.com/images/wow/icons/large/classicon_priest.jpg\" alt=\"Priest\">");
        expect(html).toMatch(/<h1 class="page-title ptitle-cn">Elun<\/h1>\s*<div class="vcard-meta"><span class="badge">Priest<\/span><span class="badge accent">/);
        expect(html).toMatch(/<a class="btn btn-ghost btn-sm" href="\/r\/abc123def456#raider"><svg[^>]*>[\s\S]*?<\/svg>Zum Report<\/a><button type="button" class="btn btn-sm" data-dialog="send-1">/);
        // four personal KPIs, as far as the report has the data
        expect(html).toContain("Overheal</div>");
        expect(html).toContain("Vorbereitung</div>");
        // the order: points, fights, then Vorbereitung / Leistung / Fehler closed
        const at = (s) => html.indexOf(s);
        expect(at("id=\"p-points\"")).toBeGreaterThan(at("class=\"kpis\""));
        expect(at("id=\"p-fights\"")).toBeGreaterThan(at("id=\"p-points\""));
        expect(at("<details class=\"pgrp\" id=\"p-prep\">")).toBeGreaterThan(at("id=\"p-fights\""));
        expect(html).toContain("<details class=\"pgrp\" id=\"p-perf\">");
        expect(html).toContain("<b>Punkte für den nächsten Raid</b><span class=\"kicker\">Elun › Empfehlungen · 2 freigegeben · 1 offen</span>");
        expect(html).toContain("<details class=\"rec rrow-d rec-high rec-state-approved\" data-key=\"healers.mana\" open>");
        // the fight table: WCL boss icon, tries, activity bar, hint badge, the chart in a dialog
        expect(html).toMatch(/<td><span class="who"><img class="hicon" src="\/bosses\/649\.jpg" alt=""><span>High King Maulgar<\/span><\/span><\/td>\s*<td><span class="badge count">1<\/span><\/td>/);
        expect(html).toMatch(/data-dialog="dlg-pf-0"><svg[^>]*>[\s\S]*?<\/svg>Verlauf<\/button>/);
        expect(html).toContain("<dialog class=\"dlg chart\" id=\"dlg-pf-0\">");
        expect(html).toContain("data-show=\"p-fp-2-healing\"");
        expect(html).toContain("<div class=\"part-chart\">");
        // the send dialog is there for the reviewer, with the review script
        expect(html).toContain("<dialog class=\"dlg send\" id=\"send-1\"");
        expect(html).toContain("window.__ehReview");
        expect(html).toContain("window.__ehSendDlg");
    });

    it("shows a reader only the approved points, under their own words", () => {
        const html = renderPlayerPage(report(), 1, reader);
        expect(html).toContain("<b>Deine Punkte für den nächsten Raid</b><span class=\"kicker\">Elun › Empfehlungen · von der Raidleitung geprüft</span>");
        expect(html).toContain("Kopf ohne Verzauberung");
        expect(html).not.toContain("21 % Overheal</span>");
        expect(html).not.toContain("data-review=");
        expect(html).not.toContain("data-dialog=\"send-1\"");
    });

    it("filters the fight table to the notable bosses when some are and some are not", () => {
        const r = report();
        r.timeline.fights.push({ id: 9, boss: "Gruul the Dragonkiller", encounterId: 650, kill: true, duration: 60000, deaths: [], activity: [{ name: "Dorn", type: "Shaman", bands: [[0, 60000]], gaps: [], activePct: 70 }] });
        const html = renderPlayerPage(r, 2, admin); // Dorn: Maulgar with a hint, Gruul without
        expect(html).toMatch(/<nav class="seg sm pf-seg"><button type="button" class="seg-btn active" data-pfilter="flag">Auffällige<span class="n mid">1<\/span><\/button><button type="button" class="seg-btn" data-pfilter="all">Alle 2<\/button><\/nav>/);
        expect(html).toContain("Dorn › Kampfverlauf · 1 von 2 Bossen gezeigt");
        expect(html).toContain("<tr data-flag=\"0\" hidden>");
        expect(html).toContain("window.__ehPf");
    });
});
