// Healers (src/web/report/panels/healers.js): a fight's healing topic and the
// raid-wide healer table.
const { healingParts, renderHealersPanel } = require("../../../../src/web/report/panels/healers");

const common = { duration: 120000, deaths: [], classColor: () => "" };

function healer(over = {}) {
    return {
        name: "Elun", type: "Priest",
        healing: { total: 60000, overheal: 20000, absorbs: 5000, overhealPct: 25, spells: [
            { name: "Greater Heal", icon: "spell_gh", total: 40000, overheal: 15000, overhealPct: 27, share: 67, casts: 20 },
            { name: "Renew", icon: "", total: 20000, overheal: 5000, overhealPct: 20, share: 33 },
        ] },
        mana: { available: true, step: 5000, values: [100, 60, 30], min: 30, minAt: 60000, regen: [{ at: 30000, icon: "inv_potion_137", label: "Super-Manatrank", pct: 40 }, { at: 90000, icon: "spell_x", label: "Shadowfiend" }] },
        dispels: { count: 4, avgReactionMs: 1500 },
        ...over,
    };
}

function fight(healers, over = {}) {
    return { id: 3, duration: 120000, deaths: [], healers: { healers, ...over } };
}

describe("web/report/panels/healers", () => {
    describe("healingParts", () => {
        it("returns null without healers, or when the raider neither healed nor got a shield", () => {
            expect(healingParts({}, null, common, "p")).toBeNull();
            expect(healingParts(fight([]), null, common, "p")).toBeNull();
            expect(healingParts(fight([healer()]), "Brokk", common, "p")).toBeNull();
        });

        it("ranks the healers on the raid page, the strongest open, and opens the mana chart by dialog", () => {
            const weak = healer({ name: "Dorn", type: "Shaman", healing: { total: 10000, overheal: 9000, overhealPct: 47, spells: [] }, mana: { available: false }, dispels: null, diedAt: 70000, potionMissing: true });
            const parts = healingParts(fight([weak, healer()]), null, common, "fp-3-healing");
            expect(parts.count).toBe(2);
            expect(parts.sub).toBe("2 Heiler");
            expect(parts.tone).toBe("mid"); // Dorn overheals 47 %
            const t = parts.table;
            expect(t).toMatch(/^<div class="hlist"><div class="hcols">/);
            expect(t.indexOf(">Elun<")).toBeLessThan(t.indexOf(">Dorn<"));
            expect(t).toContain("<details class=\"hrow\" style=\"--cc:#FFFFFF\" open>");
            expect(t).toContain("<span class=\"rank top\">1</span>");
            expect(t).toContain("<details class=\"hrow\" style=\"--cc:#0070DE\">");
            // mana low point and dispels as badges
            expect(t).toContain("30 % bei 1:00</span>");
            expect(t).toContain("<span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/spell_holy_dispelmagic.jpg\" alt=\"\">4 · Ø 1,5 s</span>");
            expect(t).toContain("kein Verlauf</span>");
            expect(t).toContain("gestorben 1:10</span>");
            expect(t).toContain("kein Manatrank</span>");
            expect(t).toContain("5,0k Absorb</span>");
            expect(t).toContain("data-dialog=\"dlg-fp-3-healing\"");
            // the spell table, strongest first
            expect(t).toContain("<table class=\"idx fc-table heal-spells\">");
            expect(t).toContain("<td class=\"rank\">1</td><td><img class=\"hicon\"");
            expect(t).toContain("<td class=\"rank\">2</td><td>Renew</td>");
            expect(t).toContain("40.000 effektive Heilung, 15.000 Overheal (27 %) · 20 Casts");
            // chips of the block
            expect(t).toContain("<b>60,0k</b> Heilung</span>");
            expect(t).toContain("<span class=\"chip chip-good\"");
            expect(t).toContain("<b>30 %</b> Mana-Tiefstand bei 1:00</span>");
            expect(t).toContain("<b>4</b> Dispels · Ø 1,5 s</span>");
            expect(t).toContain("<span class=\"chip chip-medium\" data-tip=\"Kein Manatrank");
            // the chart half: a mana curve per healer, a note for one without
            expect(parts.chart).toContain("<h4 class=\"heal-h\"><span class=\"cn\">Elun</span><span class=\"meta\">Priest</span></h4>");
            expect(parts.chart).toContain("<span class=\"meta\">Shaman · gestorben 1:10</span>");
            expect(parts.chart).toContain("<div class=\"fc-empty\">Kein Manaverlauf im Log (keine Ressourcen-Events).</div>");
        });

        it("marks a fight bad for very low mana or three undispelled debuffs, and lists those debuffs", () => {
            const low = healer({ mana: { available: true, min: 5, minAt: 1000, values: [5], step: 5000 } });
            expect(healingParts(fight([low]), null, common, "p").tone).toBe("bad");
            const missed = [1, 2, 3].map((n) => ({ at: n * 1000, ability: `Curse ${n}`, icon: n === 1 ? "spell_curse" : "", target: "Brokk", targetType: "Warrior", durationMs: 8000 }));
            const parts = healingParts(fight([healer({ healing: { total: 1, overheal: 0, overhealPct: 10 } })], { dispels: { missed } }), null, common, "p");
            expect(parts.tone).toBe("bad");
            expect(parts.table).toContain("<h4 class=\"heal-h\">Nie entfernte Debuffs<span class=\"meta\">3</span></h4>");
            expect(parts.table).toContain("<li style=\"--cc:#C79C6E\"><b>0:01</b><span class=\"cn\">Brokk</span><span class=\"sritems\">· <img class=\"hicon\"");
            expect(parts.table).toContain("Curse 2 · 0:08 lang</span></li>");
            const calm = healingParts(fight([healer({ healing: { total: 1, overheal: 0, overhealPct: 10 } })]), null, common, "p");
            expect(calm.tone).toBe("ok");
            // a healer without a healing record renders as zero
            expect(healingParts(fight([{ name: "Nil", type: "Druid" }]), null, common, "p").table).toContain("<b>0</b> Heilung");
        });

        it("shows the tank's shields and HoTs with their stacks and gaps", () => {
            const shields = [
                { key: "lifebloom", label: "Lifebloom", icon: "inv_lb", source: "Rain", stacks: [{ from: 0, to: 60000, stacks: 3 }], maxStacks: 3, uptimePct: 90, fullStacksPct: 70 },
                { key: "renew", label: "Renew", icon: "spell_renew", source: "Elun", bands: [[0, 30000]], uptimePct: 25, gapCount: 1 },
                { key: "pws", label: "PW:S", icon: "spell_pws", source: "Elun", bands: [], uptimePct: 0, gapCount: 3 },
                { key: "unknown", label: "Odd", source: "X", bands: [], uptimePct: 5 },
            ];
            const f = fight([healer()], { tank: { name: "Brokk", type: "Warrior" }, shields });
            const raid = healingParts(f, null, common, "p");
            expect(raid.table).toContain("<h4 class=\"heal-h\">Schilde &amp; HoTs auf Brokk<span class=\"meta\">Tank · Warrior</span></h4>");
            expect(raid.table).toContain("Lifebloom (Rain)</td><td><span class=\"tv medium\">90%</span></td><td>3/3: 70 %</td>");
            expect(raid.table).toContain("Renew (Elun)</td><td><span class=\"tv\">25%</span></td><td>1 Lücke</td>");
            expect(raid.table).toContain("PW:S (Elun)</td><td><span class=\"tv\">0%</span></td><td>3 Lücken</td>");
            expect(raid.table).toContain("Odd (X)</td><td><span class=\"tv\">5%</span></td><td>–</td>");
            expect(raid.chart).toContain("Schilde &amp; HoTs auf Brokk");

            // the tank sees every aura on them, but no healer rows
            const tank = healingParts(f, "Brokk", common, "p");
            expect(tank.count).toBe(0);
            expect(tank.sub).toBe("");
            expect(tank.table).toContain("Lifebloom (Rain)");
            expect(tank.table).toContain("Odd (X)");
            expect(tank.table).not.toContain("hlist");

            // a healer sees their own block and only their own auras
            const own = healingParts(f, "Elun", common, "p");
            expect(own.count).toBe(1);
            expect(own.table).toMatch(/^<div class="heal-block" style="--cc:#FFFFFF"><h4 class="heal-h">/);
            expect(own.table).toContain("Renew (Elun)");
            expect(own.table).not.toContain("Lifebloom (Rain)");
        });
    });

    describe("renderHealersPanel", () => {
        it("ranks the healers over the raid with overheal, mana, potions, dispels and tank shields", () => {
            const html = renderHealersPanel({
                players: [
                    { name: "Dorn", type: "Shaman", fights: 1, healingTotal: 100000, overhealTotal: 20000, overhealPct: 17, potions: 0, dispels: 0, manaMinAvg: null },
                    { name: "Elun", type: "Priest", fights: 3, healingTotal: 300000, overhealTotal: 100000, overhealPct: 25,
                        topOverheal: { name: "Renew", icon: "spell_renew", overhealPct: 60 }, manaMinAvg: 12, manaLowFights: 2,
                        potions: 3, potionPcts: [10, 50, 5], potionMissingFights: 1, dispels: 7, avgReactionMs: 2000,
                        shields: [{ label: "PW:S", icon: "spell_pws", uptimeAvg: 40, fights: 3 }] },
                ],
                raid: { dispelsMissed: 5, missedByAbility: [{ ability: "Curse", count: 3 }, { ability: "Poison", count: 2 }], tanks: ["Brokk", "Tia"] },
            }, (n) => (n === "Elun" ? "/r/x/p/1" : null));
            expect(html).toContain("<div class=\"badges\"><span class=\"badge\" data-tip=\"Schild- und HoT-Uptimes");
            expect(html).toContain("Tank: Brokk, Tia</span>");
            expect(html).toContain("<span class=\"badge mid\" data-tip=\"5 dispelbare Debuffs hat niemand entfernt\" data-tip-sub=\"Curse (3×), Poison (2×)\">");
            expect(html.indexOf(">Elun<")).toBeLessThan(html.indexOf(">Dorn<"));
            expect(html).toContain("<td class=\"rank\">1</td><td><a class=\"cn\" href=\"/r/x/p/1\">Elun</a><div class=\"sritems\">Priest · 3 Kämpfe</div></td>");
            expect(html).toContain("<span class=\"cn\">Dorn</span><div class=\"sritems\">Shaman · 1 Kampf</div>");
            expect(html).toContain("Renew <span class=\"sritems\">60 %</span></td>");
            expect(html).toContain("<td>12 % <span class=\"tag tag-high\">2× &lt; 10 %</span></td>");
            expect(html).toContain("<td>3 <span class=\"tag tag-medium\">2× spät</span> <span class=\"tag tag-medium\">1× keiner</span></td>");
            expect(html).toContain("<td>7 <span class=\"sritems\">Ø 2,0 s</span></td>");
            expect(html).toContain("<span class=\"sh\" data-tip=\"PW:S\" data-tip-sub=\"Ø 40 % Uptime auf dem aktiven Tank in 3 Kämpfen\">");
            // Dorn: no top overheal, no mana data, no shields
            expect(html).toMatch(/Shaman · 1 Kampf<\/div><\/td><td>.*?<\/td><td>–<\/td><td>–<\/td><td>0<\/td><td>0<\/td><td>–<\/td><\/tr>/);
        });

        it("renders only the table for a raid without tank or missed dispels", () => {
            const html = renderHealersPanel({ players: [] });
            expect(html).toMatch(/^<div class="tbox scrollx"><table class="idx heal-table">/);
        });
    });
});
