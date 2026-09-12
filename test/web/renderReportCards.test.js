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
        expect(html).toContain("Raid<span class=\"n\">");
        expect(html).toContain("class=\"seg-btn active\" data-show=\"view-bosse\"");
        expect(html).toContain("Bosse<span class=\"n\">1</span>");
        expect(html).toContain("Raider<span class=\"n\">3</span>");
        expect(html).toContain("<div id=\"view-raid\" class=\"view\" hidden>");
        expect(html).toContain("<div id=\"view-bosse\" class=\"view\">");
        expect(html).toContain("<div id=\"view-raider\" class=\"view\" hidden>");
        expect(html).toContain("history.replaceState(null,\"\",\"#\"+id)");
        expect(html).toContain("/^raider-(.+)$/");
        expect(html.match(/window\.__ehShow=1/g)).toHaveLength(1);
        expect(html.match(/window\.__ehDlg=1/g)).toHaveLength(1);
    });

    it("hangs every raid-wide part into the Raid view as a foldable section, the raid recommendations open", () => {
        const html = renderReportPage(report(), admin);
        for (const id of ["rec-raid", "send", "raidbuffs", "healers", "cooldowns", "activity", "totems", "mechanics", "consumables", "potions", "gear"]) {
            expect(html).toContain(`<details class="rsec" id="rs-${id}"`);
        }
        expect(html).toContain("<details class=\"rsec\" id=\"rs-rec-raid\" open>");
        expect(html).toContain("<details class=\"rsec\" id=\"rs-healers\">");
        // the summaries that had no place before
        expect(html).toContain("<th>Spieler</th><th>Kämpfe</th><th>Einsätze / möglich</th>");
        expect(html).toContain("<td class=\"mono\">3 / 4</td>");
        expect(html).toContain("<th>Schamane</th><th>Kämpfe</th><th>Windfury Ø</th>");
        expect(html).toContain("<b>2</b> vermeidbar</span>");
        expect(html).toContain("Wirbelwind<div class=\"sritems\">Schaden</div>");
    });
});

describe("web/render — boss cards", () => {
    it("draws one card per boss with icon, meta line and the chips, the first open", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<details class=\"vcard boss-card\" id=\"boss-e649\" open>");
        expect(html).toContain("<img class=\"vcard-icon\" src=\"/bosses/649.jpg\" alt=\"\">");
        expect(html).toContain("<div class=\"vcard-meta\">2 Tries · Wipe bei 32 % · Kill 3:24 · 1 Tod</div>");
        // every chip explains itself in the page's tooltip box
        expect(html).toMatch(/<span class="chip chip-x bad" data-tip="Erwartete Debuffs, die in mindestens einem Try kein einziges Mal auf dem Boss lagen" data-tip-sub="[^"]+"><b>1<\/b> Debuff fehlte<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x warn" data-tip="Spieler, denen[^"]*" data-tip-sub="[^"]+"><b>1<\/b> Buffs fehlten<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x" data-tip="Dispelbare Debuffs[^"]*" data-tip-sub="[^"]+"><b>1<\/b> nie dispellt<\/span>/);
        expect(html).toMatch(/<span class="chip chip-x ok" data-tip="Schaden des ganzen Raids pro Sekunde im Kill-Try, im Mittel über den Kampf" data-tip-sub="[^"]+"><b>11,9k<\/b> Raid-DPS<\/span>/); // the kill's mean, not the wipe's
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
        expect(html).toContain("<span class=\"dot bad\"></span>Debuffs<span class=\"n\">2 · 1 fehlt</span>");
        expect(html).toContain("<span class=\"dot mid\"></span>Cooldowns<span class=\"n\">1 · 100 % genutzt</span>".replace("dot mid", "dot "));
        expect(html).toContain("Heilung<span class=\"n\">1 · 1 Heiler</span>");
        expect(html).toContain("Buffs<span class=\"n\">1 · 1 fehlten</span>");
        expect(html).toContain("Kampfverlauf</button>");
        expect(html).toContain("Tode<span class=\"n\">1</span>");
    });

    it("shows the compact table first and the chart behind a dialog button", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<div class=\"part-title\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_shadow_chilltouch.jpg\" alt=\"\">Debuffs · auf High King Maulgar<span class=\"kicker\">Bosse › High King Maulgar › Try 1 › Debuffs</span></div>");
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
    it("draws one closed card per raider with class icon, role, fight count and chips", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Elun\" data-name=\"Elun\" data-role=\"healer\" data-open=\"1\" data-report=\"abc123def456\" style=\"--cc:#FFFFFF\">");
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Brokk\" data-name=\"Brokk\" data-role=\"tank\" data-open=\"0\"");
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Dorn\" data-name=\"Dorn\" data-role=\"dps\" data-open=\"1\"");
        expect(html).toContain("<div class=\"vcard-title cn\">Elun</div><div class=\"vcard-meta\">Priest · Heiler · 1 Kampf</div>");
        expect(html).toContain("<div class=\"vcard-meta\">Warrior · Tank · 1 Kampf</div>");
        // chips: gear, consumables, buffs, overheal or activity, recommendations
        expect(html).toContain("<b>1</b> Gear</span>");
        expect(html).toContain("<span class=\"chip chip-x warn\" data-tip=\"Anteil der Boss-Kämpfe mit Flask oder beiden Elixieren\" data-tip-sub=\"Ab 90 % grün, unter 50 % rot. Food, Tränke und Drums stehen unter „Consumables &amp; Tränke“.\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/inv_alchemy_endlessflask_05.jpg\" alt=\"\"><b>67 %</b> Consumables</span>");
        expect(html).toContain("<b>2</b> Buffs fehlten</span>");
        expect(html).toContain("<b>1</b> Buff fehlte</span>");
        expect(html).toContain("<b>21 %</b> Overheal</span>");
        expect(html).toContain("<b>2×</b> unter 10 % Mana</span>");
        expect(html).toContain("<b>94 %</b> aktiv</span>");
        expect(html).toContain("<b>3</b> Empfehlungen · 1 offen</span>");
    });

    it("offers the sections behind buttons: recommendations, gear, consumables, buffs, healing, activity, damage, timeline", () => {
        const html = renderReportPage(report(), admin);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        for (const key of ["recs", "gear", "cons", "buffs", "heal", "tl"]) expect(elun).toContain(`data-show="rc1-${key}"`);
        expect(elun).not.toContain("data-show=\"rc1-act\""); // no activity/cooldown/totem row for her
        expect(elun).not.toContain("data-show=\"rc1-dmg\""); // and no hit, no death, no RPB row
        expect(elun).toContain("Empfehlungen<span class=\"n\">3 · 1 offen</span>");
        expect(elun).toContain("Gear<span class=\"n\">1 Problem</span>");
        expect(elun).toContain("Heilung &amp; Mana<span class=\"n\">2 Kämpfe</span>");
        expect(elun).toContain("<div id=\"rc1-recs\" class=\"part\">");
        expect(elun).toContain("<div id=\"rc1-gear\" class=\"part\" hidden>");
        expect(elun).toContain("data-scope=\"player\" data-player=\"Elun\" data-key=\"healers.mana\"");
        expect(elun).toContain("<span class=\"rec-source\" data-tip=\"Von Claude formuliert\" data-tip-sub=\"Der Regeltext dahinter steht im Tooltip des Textes.\">KI</span>");
        expect(elun).toContain("Keine Ausrüstung im Log.");
        expect(elun).toContain("<b>300k</b> Heilung in 2 Kämpfen");
        expect(elun).toContain("<th>Buff</th><th>Anteil</th>");
        // the timeline opens as a dialog with the raider's own slice, namespaced ids
        expect(elun).toContain("data-dialog=\"dlg-rt-1\"");
        expect(elun).toContain("<dialog class=\"dlg chart\" id=\"dlg-rt-1\">");
        expect(elun).toContain("data-show=\"r1-fb-e649\"");
        expect(elun).toContain("id=\"r1-fight-2\">");
        expect(elun).toContain("<a class=\"btn btn-ghost btn-sm\" href=\"/r/abc123def456/p/1\">Spielerseite ↗</a>");
        // a tank sees the healers' auras on them; a shaman his totems
        const brokk = html.slice(html.indexOf("id=\"raider-Brokk\""), html.indexOf("id=\"raider-Elun\""));
        expect(brokk).toContain("data-show=\"rc0-act\"");
        expect(brokk).toContain("Aktivität &amp; Cooldowns<span class=\"n\">94 %</span>");
        expect(brokk).toContain("<b>3</b> vermeidbare Treffer</span>");
        expect(brokk).toContain("<b>1</b> Tode · 1 vermeidbar");
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).toContain("Totems</td>");
        expect(dorn).toContain("Twisting in 1 von 2 Kämpfen");
        expect(dorn).toContain("class=\"potions\"");
        expect(dorn).toContain("inv_potion_137.jpg");
    });

    it("gives reviewers the footer with the phrasing job and the send dialog, only approved points inside", () => {
        const html = renderReportPage(report(), admin);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        expect(elun).toContain("<span class=\"note\">2 freigegeben · 1 offen · zuletzt gesendet: ");
        expect(elun).toContain("<button type=\"button\" class=\"btn btn-ghost btn-sm\" data-phrase=\"player\"");
        expect(elun).toContain("<button type=\"button\" class=\"btn btn-sm\" data-dialog=\"send-1\">Vorschau &amp; senden</button>");
        expect(elun).toContain("<dialog class=\"dlg send\" id=\"send-1\" data-report=\"abc123def456\" data-player=\"Elun\">");
        expect(elun).toContain("An Elun senden</div>");
        expect(elun).toContain("2 freigegebene Punkte · Vorschau der Nachricht · zuletzt gesendet ");
        // the two approved points, the open one only mentioned
        expect(elun).toContain("data-key=\"healers.mana\" data-title=\"In 2 Kämpfen unter 10 % Mana\" data-ai=\"Dein Tiefstand lag im Schnitt bei 7 %. Nimm den ersten Manatrank schon bei 50 %.\" data-rule=\"Manatrank früher nehmen.\" data-custom=\"\" data-mode=\"ai\"");
        expect(elun).toContain("data-key=\"gear\" data-title=\"Kopf ohne Verzauberung\" data-ai=\"\" data-rule=\"Hood verzaubern.\" data-custom=\"Bitte die Glyphe auf die Kapuze.\" data-mode=\"custom\"");
        expect(elun).not.toContain("data-key=\"healers.overheal\" data-title");
        expect(elun).toContain("Der noch offene Punkt wird nicht gesendet.");
        // text choice: KI-Text only where Claude phrased, the own text editable
        expect(elun).toContain("<button type=\"button\" class=\"seg-btn active\" data-txt=\"ai\">KI-Text</button><button type=\"button\" class=\"seg-btn\" data-txt=\"rule\">Regeltext</button><button type=\"button\" class=\"seg-btn\" data-txt=\"custom\">Eigener</button>");
        expect(elun).toContain("<textarea class=\"send-text\" rows=\"3\" readonly>Dein Tiefstand lag im Schnitt bei 7 %. Nimm den ersten Manatrank schon bei 50 %.</textarea>");
        expect(elun).toContain("<textarea class=\"send-text\" rows=\"3\">Bitte die Glyphe auf die Kapuze.</textarea>");
        // the DM preview and the three buttons
        expect(elun).toContain("<b>Montagsraid Gruul · Deine Auswertung</b>");
        expect(elun).toContain("2 Punkte von der Raidleitung geprüft");
        expect(elun).toContain("Report ansehen ↗ /r/abc123def456/p/1");
        expect(elun).toContain("data-sendact=\"save\">Nur speichern</button>");
        expect(elun).toContain("data-sendact=\"send\">Per Bot senden</button>");
        expect(html).toContain("window.__ehSendDlg");
        expect(html).toContain("/api/cla/recommendations/send");
        expect(html).toContain("players:[who]");
        // a raider without approved points gets the button disabled
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).toContain("data-dialog=\"send-2\" disabled>Vorschau &amp; senden</button>");
        expect(dorn).toContain("Noch nichts freigegeben.");
    });

    it("carries the role filter, the search and the open-count attributes for the inline script", () => {
        const html = renderReportPage(report(), admin);
        expect(html).toContain("<input type=\"search\" id=\"raiderSearch\" placeholder=\"Raider suchen…\"");
        expect(html).toContain("data-rolefilter=\"all\">Alle</button>");
        expect(html).toContain("data-rolefilter=\"tank\">Tank</button>");
        expect(html).toContain("data-rolefilter=\"healer\">Heiler</button>");
        expect(html).toContain("data-rolefilter=\"dps\">DPS</button>");
        expect(html).toContain("data-rolefilter=\"open\">Offen <span class=\"n\">2</span></button>");
        expect(html).toContain("window.__ehFilter");
        expect(html).toContain("<div class=\"raider-empty\" id=\"raiderEmpty\" hidden>");
    });

    it("shows a non-reviewer only the approved points, no controls, no footer, no send dialog", () => {
        const html = renderReportPage(report(), reader);
        const elun = html.slice(html.indexOf("id=\"raider-Elun\""), html.indexOf("id=\"raider-Dorn\""));
        expect(elun).toContain("data-open=\"2\"");
        expect(elun).toContain("<b>2</b> Empfehlungen</span>");
        expect(elun).toContain("Empfehlungen<span class=\"n\">2</span>");
        expect(elun).toContain("In 2 Kämpfen unter 10 % Mana");
        expect(elun).not.toContain("21 % Overheal</b>");
        expect(elun).not.toContain("data-review=");
        expect(elun).not.toContain("class=\"raider-foot\"");
        expect(elun).not.toContain("<dialog class=\"dlg send\"");
        expect(html).toContain("data-rolefilter=\"open\">Empfehlungen <span class=\"n\">1</span></button>");
        expect(html).not.toContain("window.__ehReview");
        expect(html).not.toContain("window.__ehSendDlg");
        expect(html).not.toContain("id=\"rs-send\"");
        // a raider with nothing approved gets no recommendations section at all
        const dorn = html.slice(html.indexOf("id=\"raider-Dorn\""), html.indexOf("id=\"raiderEmpty\""));
        expect(dorn).not.toContain("data-show=\"rc2-recs\"");
    });
});

describe("web/render — player page", () => {
    it("is the same raider card, opened, with the timeline inline instead of a dialog", () => {
        const html = renderPlayerPage(report(), 1, admin); // Elun
        expect(html).toContain("<title>Elun — Montagsraid Gruul</title>");
        expect(html).toContain("Stufe 70 · Priest");
        expect(html).toContain("<details class=\"vcard raider-card\" id=\"raider-Elun\" data-name=\"Elun\" data-role=\"healer\" data-open=\"1\" data-report=\"abc123def456\" style=\"--cc:#FFFFFF\" open>");
        expect(html).toContain("data-show=\"rc1-recs\"");
        expect(html).not.toContain("data-show=\"rc1-tl\"");
        expect(html).not.toContain("id=\"dlg-rt-1\"");
        expect(html).toContain("<h2>Kampfverlauf</h2>");
        expect(html).toContain("data-show=\"p-fb-e649\"");
        expect(html).toContain("<div class=\"part-chart\">");
        expect(html).toContain("href=\"/r/abc123def456#raider\">← zurück zum Report</a>");
        // the send dialog is there for the reviewer, with the review script
        expect(html).toContain("<dialog class=\"dlg send\" id=\"send-1\"");
        expect(html).toContain("window.__ehReview");
        expect(html).toContain("window.__ehSendDlg");
    });
});
