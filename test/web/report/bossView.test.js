// Sicht Bosse (src/web/report/bossView.js): try pills, the boss cards with
// their chips and recommendations, and a raider's own slice of the timeline.
const { tryPills, renderBossView, playerFights, renderPlayerTimeline } = require("../../../src/web/report/bossView");

const fight = (over = {}) => ({ id: 1, boss: "Maulgar", encounterId: 649, kill: false, fightPercentage: 40, duration: 120000, deaths: [], ...over });

function timeline() {
    return {
        fights: [
            fight({ id: 2, deaths: [{ at: 30000, name: "Alice", type: "Mage", avoidable: true }, { at: 40000, name: "Bob", type: "Warrior" }],
                debuffs: [{ key: "coe", label: "CoE", expected: true, missing: true }, { key: "sunder", label: "Sunder", expected: true, uptimePct: 90 }],
                buffs: { players: [{ name: "Alice", buffs: [], missing: ["kings"] }, { name: "Bob", buffs: [] }] },
                healers: { healers: [{ name: "Elun", type: "Priest" }], dispels: { missed: [{}, {}, {}] } },
                series: { step: 5000, dps: [900, 1100] } }),
            fight({ id: 3, kill: true, duration: 180000, series: { step: 5000, dps: [2000, 2000], hps: [1] },
                debuffs: [{ key: "coe", label: "CoE", expected: true, uptimePct: 0 }],
                healers: { healers: [{ name: "Elun", type: "Priest" }], dispels: { missed: [] } } }),
            fight({ id: 4, boss: "Gruul", encounterId: 650, kill: true, duration: 200000, deaths: [{ at: 1000, name: "Bob", type: "Warrior" }] }),
        ],
    };
}

describe("web/report/bossView", () => {
    describe("tryPills", () => {
        it("renders nothing for a single pull", () => {
            expect(tryPills({ fights: [fight()] }, "")).toBe("");
        });

        it("renders one pill per pull with outcome and duration, the first active", () => {
            const html = tryPills({ fights: [fight({ id: 2 }), fight({ id: 3, kill: true, duration: 65000 })] }, "p-");
            expect(html).toBe("<nav class=\"try-pills\"><button type=\"button\" class=\"try-pill active try-wipe\" data-show=\"p-fight-2\">Try 1<span class=\"s\">Wipe bei 40 % · 2:00</span></button>"
                + "<button type=\"button\" class=\"try-pill try-kill\" data-show=\"p-fight-3\">Try 2<span class=\"s\">Kill · 1:05</span></button></nav>");
        });
    });

    describe("renderBossView", () => {
        it("says so without fights", () => {
            expect(renderBossView(null, null, [], false)).toBe("<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>");
            expect(renderBossView({ fights: [] }, null, [], false)).toBe("<div class=\"empty\">Keine Boss-Kämpfe im Log.</div>");
        });

        it("notes the missing v2 access when no fight has a series", () => {
            const html = renderBossView({ fights: [fight()] }, null, [], false);
            expect(html).toMatch(/^<p class="note">Raid-DPS\/HPS und Boss-Leben brauchen den Warcraft-Logs-v2-Zugang/);
            // a single wipe: its outcome as the badge, no chips, no pills
            expect(html).toContain("<span class=\"badge count\">1 Try</span><span class=\"badge bad\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg\" alt=\"\">Wipe bei 40 %</span>");
            expect(html).toContain("<span class=\"badge\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_creature_cursed_05.jpg\" alt=\"\">0 Tode</span>");
            expect(html).toContain("<div class=\"vcard-chips\"></div>");
            expect(html).not.toContain("try-pills");
        });

        const html = renderBossView(timeline(), (n) => `/p/${n}`, [], false);

        it("renders one card per boss, the first open, with its icon", () => {
            expect(html).not.toMatch(/^<p class="note">/);
            expect(html).toContain("<details class=\"vcard boss-card\" id=\"boss-e649\" open>");
            expect(html).toContain("<details class=\"vcard boss-card\" id=\"boss-e650\">");
            expect(html).toContain("<summary><img class=\"vcard-icon\" src=\"/bosses/649.jpg\" alt=\"\"><div class=\"vcard-main\"><div class=\"vcard-title\">Maulgar</div>");
            expect(html).toContain("<nav class=\"try-pills\">");
        });

        it("sums the boss up in the meta line: tries, wipes, kill time and deaths", () => {
            expect(html).toContain("<span class=\"badge count\">2 Tries</span>");
            expect(html).toContain("alt=\"\">Wipe bei 40 %</span>");
            expect(html).toContain("<span class=\"badge ok\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/achievement_boss_illidan.jpg\" alt=\"\">Kill 3:00</span>");
            expect(html).toContain("alt=\"\">2 Tode · 1 vermeidbar</span>");
            // Gruul: one kill, one death
            expect(html).toContain("<span class=\"badge mid\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/ability_creature_cursed_05.jpg\" alt=\"\">1 Tod</span>");
        });

        it("sums the boss up in chips: missing debuffs, players short of buffs, undispelled debuffs, the kill's DPS", () => {
            expect(html).toMatch(/<span class="chip chip-x bad"[^>]*><img[^>]*><b>1<\/b> Debuff fehlte<\/span>/);
            expect(html).toMatch(/<span class="chip chip-x warn"[^>]*><img[^>]*><b>1<\/b> Buffs fehlten<\/span>/);
            expect(html).toMatch(/<span class="chip chip-x warn"[^>]*><img[^>]*><b>3<\/b> nie dispellt<\/span>/);
            expect(html).toMatch(/<span class="chip chip-x ok" data-tip="Schaden des ganzen Raids pro Sekunde im Kill-Try, im Mittel über den Kampf"[^>]*><img[^>]*><b>2,0k<\/b> Raid-DPS<\/span>/);
        });

        it("tones clean chips ok and takes the last try's DPS without a kill", () => {
            const clean = renderBossView({ fights: [fight({ debuffs: [{ key: "a", expected: true, uptimePct: 99 }], buffs: { players: [{ name: "A", buffs: [] }] }, healers: { healers: [], dispels: {} }, series: { dps: [500] } })] }, null, [], false);
            expect(clean).toMatch(/<span class="chip chip-x ok"[^>]*><img[^>]*><b>0<\/b> Debuffs fehlten<\/span>/);
            expect(clean).toMatch(/<span class="chip chip-x ok"[^>]*><img[^>]*><b>0<\/b> Buffs fehlten<\/span>/);
            expect(clean).toMatch(/<span class="chip chip-x"[^>]*><img[^>]*><b>0<\/b> nie dispellt<\/span>/);
            expect(clean).toContain("im letzten Try");
        });

        it("adds the raid findings that name the boss, the approved ones for a reader", () => {
            const recs = [
                { key: "a", impact: "high", title: "Maulgar: Tanks", text: "t", approved: null },
                { key: "b", impact: "low", title: "Allgemein", text: "t", approved: true, evidence: [{ label: "Boss", value: "MAULGAR" }] },
                { key: "c", impact: "low", title: "Anderes", text: "t", approved: true },
                { key: "d", impact: "low", title: "x", text: "t", custom: "bei maulgar", approved: true },
            ];
            const reader = renderBossView({ fights: [fight()] }, null, recs, false);
            expect(reader).toContain("<div class=\"boss-recs\"><div class=\"kicker icons\">");
            expect(reader).toContain("Empfehlungen zu diesem Boss</div><ul class=\"rec-list\">");
            expect(reader).not.toContain("data-key=\"a\"");
            expect(reader).toContain("data-key=\"b\"");
            expect(reader).not.toContain("data-key=\"c\"");
            expect(reader).toContain("data-key=\"d\"");
            expect(renderBossView({ fights: [fight()] }, null, recs, true)).toContain("data-key=\"a\"");
            expect(renderBossView({ fights: [fight()] }, null, [recs[2]], true)).not.toContain("boss-recs");
            // a boss without a name matches nothing
            expect(renderBossView({ fights: [fight({ boss: "" })] }, null, recs, true)).not.toContain("boss-recs");
        });

        it("renders a boss without an encounter icon with an empty icon slot", () => {
            const trash = renderBossView({ fights: [fight({ boss: "Trash", encounterId: 0 })] }, null, [], false);
            expect(trash).toContain("<details class=\"vcard boss-card\" id=\"boss-nTrash\" open>");
            expect(trash).toContain("<summary><span class=\"vcard-icon\"></span>");
        });
    });

    describe("playerFights", () => {
        it("finds the fights a raider shows up in, through any of the topics", () => {
            const fights = [
                { id: 1, deaths: [{ name: "A" }] },
                { id: 2, totems: [{ name: "A" }] },
                { id: 3, cooldowns: { players: [{ name: "A" }] } },
                { id: 4, activity: [{ name: "A" }] },
                { id: 5, mechanics: { players: [{ name: "A" }] } },
                { id: 6, healers: { healers: [{ name: "A" }] } },
                { id: 7, healers: { shields: [{ source: "A" }] } },
                { id: 8, healers: { tank: { name: "A" } } },
                { id: 9, buffs: { players: [{ name: "A" }] } },
                { id: 10, series: { players: [null, { name: "A" }] } },
                { id: 11, deaths: [{ name: "B" }], healers: { tank: { name: "B" } } },
            ];
            expect(playerFights({ fights }, "A").map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            expect(playerFights(null, "A")).toEqual([]);
            expect(playerFights({ fights }, "Z")).toEqual([]);
        });
    });

    describe("renderPlayerTimeline", () => {
        it("renders nothing for a raider without fights", () => {
            expect(renderPlayerTimeline(timeline(), "Nobody")).toBe("");
        });

        it("renders boss tabs with icon and tries, the first boss shown, sections inline under ns", () => {
            const html = renderPlayerTimeline(timeline(), "Bob", "r1-");
            expect(html).toMatch(/^<h2>Kampfverlauf<\/h2><nav class="boss-tabs">/);
            expect(html).toContain("<button type=\"button\" class=\"boss-tab active\" data-show=\"r1-fb-e649\"><img src=\"/bosses/649.jpg\" alt=\"\"><span class=\"boss-name\">Maulgar</span><span class=\"boss-tries boss-wipe\">1 Try</span></button>");
            expect(html).toContain("<span class=\"boss-tries boss-kill\">1 Try</span>");
            expect(html).toContain("<div id=\"r1-fb-e649\" class=\"fight-boss\">");
            expect(html).toContain("<div id=\"r1-fb-e650\" class=\"fight-boss\" hidden>");
            expect(html).toContain("<section class=\"fight fight-wipe\" id=\"r1-fight-2\">");
            expect(html).toContain("<div class=\"fight-head\"><h3>Maulgar</h3>");
        });

        it("defaults the namespace to p- and shows the try pills of a boss pulled twice", () => {
            const html = renderPlayerTimeline(timeline(), "Elun");
            expect(html).toContain("data-show=\"p-fb-e649\"><img src=\"/bosses/649.jpg\" alt=\"\"><span class=\"boss-name\">Maulgar</span><span class=\"boss-tries boss-kill\">2 Tries</span>");
            expect(html).toContain("data-show=\"p-fight-3\">Try 2");
            // a boss without icon: no image in the tab
            const noIcon = renderPlayerTimeline({ fights: [fight({ encounterId: 0, deaths: [{ name: "X", at: 0 }] })] }, "X");
            expect(noIcon).toContain("data-show=\"p-fb-nMaulgar\"><span class=\"boss-name\">");
        });
    });
});
