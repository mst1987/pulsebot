// Sicht Bosse (src/web/report/bossView.js): try pills, the boss table with
// its rows and the boss pages with their recommendations, and a raider's own slice of the timeline.
const { tryPills, bossFacts, renderBossView, playerFights, renderPlayerTimeline } = require("../../../src/web/report/bossView");

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

        it("notes the missing v2 access inside the boss index when no fight has a series", () => {
            const html = renderBossView({ fights: [fight()] }, null, [], false);
            expect(html).toMatch(/^<div class="boss-index" id="bossIndex"><p class="note">Raid-DPS\/HPS und Boss-Leben brauchen den Warcraft-Logs-v2-Zugang/);
            // a single wipe: its outcome as the badge, no tries note, no pills, no chips
            expect(html).toContain("<td><span class=\"badge bad\">Wipe bei 40 %</span></td>");
            expect(html).toContain("<td><span class=\"badge ok\">0 Tode</span></td>");
            expect(html).not.toContain("try-pills");
            expect(html).not.toContain("boss-card");
            expect(html).not.toContain("chip-x");
        });

        const html = renderBossView(timeline(), (n) => `/p/${n}`, [], false);

        it("renders a table with one row per boss, each opening its hidden page", () => {
            expect(html).not.toContain("<p class=\"note\">Raid-DPS");
            expect(html).toContain("<table class=\"idx boss-table\"><thead><tr><th>Boss</th><th>Kampf</th><th>Tode</th><th>Debuffs</th><th>Buffs</th><th>Dispel</th><th></th></tr></thead>");
            expect(html).toContain("<tr data-boss-open=\"e649\">");
            expect(html).toContain("<tr data-boss-open=\"e650\">");
            expect(html).toContain("<button type=\"button\" class=\"boss-open\" data-boss-open=\"e649\"><img class=\"boss-ico\" src=\"/bosses/649.jpg\" alt=\"\"><b>Maulgar</b></button>");
            expect(html.match(/<tr data-boss-open=/g)).toHaveLength(2);
            expect(html).toContain("<section class=\"boss-detail\" id=\"boss-e649\" data-boss=\"e649\" hidden>");
            expect(html).toContain("<section class=\"boss-detail\" id=\"boss-e650\" data-boss=\"e650\" hidden>");
            expect(html).toContain("<button type=\"button\" class=\"btn btn-ghost btn-sm btn-back\" data-boss-back>");
            expect(html).toContain("Alle Bosse</button>");
            expect(html).toContain("<span class=\"kicker\">Boss 1 von 2</span><h2>Maulgar</h2>");
            expect(html).toContain("<span class=\"kicker\">Boss 2 von 2</span><h2>Gruul</h2>");
            expect(html).toContain("<nav class=\"try-pills\">");
            expect(html).not.toContain("<details class=\"vcard boss-card\"");
        });

        it("sums the boss up in the row cells: outcome, tries, deaths", () => {
            const row = html.match(/<tr data-boss-open="e649">.*?<\/tr>/)[0];
            expect(row).toContain("<td><span class=\"badge ok\">Kill 3:00</span> <span class=\"mute\">2 Tries</span></td>");
            expect(row).toContain("<td><span class=\"badge bad\">2 Tode · 1 vermeidbar</span></td>");
            // Gruul: one kill, one death
            const gruul = html.match(/<tr data-boss-open="e650">.*?<\/tr>/)[0];
            expect(gruul).toContain("<td><span class=\"badge ok\">Kill 3:20</span></td>");
            expect(gruul).toContain("<td><span class=\"badge mid\">1 Tod</span></td>");
        });

        it("sums the boss up in the row cells: missing debuffs, raiders short of buffs, undispelled debuffs", () => {
            const row = html.match(/<tr data-boss-open="e649">.*?<\/tr>/)[0];
            expect(row).toContain("<td><span class=\"badge bad\">1 von 2 fehlten</span></td>");
            expect(row).toContain("<td><span class=\"badge mid\">1 Raider ohne</span></td>");
            expect(row).toContain("<td><span class=\"badge mid\">3 nie dispellt</span></td>");
            expect(row).toContain("<td class=\"boss-go\">Öffnen ›</td>");
            // Gruul has no such data: dashes
            const gruul = html.match(/<tr data-boss-open="e650">.*?<\/tr>/)[0];
            expect(gruul.match(/<span class="mute">–<\/span>/g)).toHaveLength(3);
        });

        it("tones clean cells ok and counts several wipes", () => {
            const clean = renderBossView({ fights: [fight({ debuffs: [{ key: "a", expected: true, uptimePct: 99 }], buffs: { players: [{ name: "A", buffs: [] }] }, healers: { healers: [], dispels: {} }, series: { dps: [500] } })] }, null, [], false);
            expect(clean).toContain("<td><span class=\"badge ok\">alle da</span></td><td><span class=\"badge ok\">alle da</span></td><td><span class=\"badge ok\">alles dispellt</span></td>");
            const wipes = renderBossView({ fights: [fight({ id: 1 }), fight({ id: 2 }), fight({ id: 3 })] }, null, [], false);
            expect(wipes).toContain("<span class=\"badge bad\">3 Wipes</span> <span class=\"mute\">3 Tries</span>");
            // a few undispelled debuffs stay neutral
            const few = renderBossView({ fights: [fight({ healers: { dispels: { missed: [{}] } } })] }, null, [], false);
            expect(few).toContain("<span class=\"badge\">1 nie dispellt</span>");
        });

        it("adds the raid findings that name the boss, the approved ones for a reader", () => {
            const recs = [
                { key: "a", impact: "high", title: "Maulgar: Tanks", text: "t", approved: null },
                { key: "b", impact: "low", title: "Allgemein", text: "t", approved: true, evidence: [{ label: "Boss", value: "MAULGAR" }] },
                { key: "c", impact: "low", title: "Anderes", text: "t", approved: true },
                { key: "d", impact: "low", title: "x", text: "t", custom: "bei maulgar", approved: true },
            ];
            const reader = renderBossView({ fights: [fight()] }, null, recs, false);
            expect(reader).toContain("<div class=\"boss-recs\"><h3>Empfehlungen zu diesem Boss</h3><ul class=\"rec-list\">");
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
            expect(trash).toContain("<tr data-boss-open=\"nTrash\">");
            expect(trash).toContain("<button type=\"button\" class=\"boss-open\" data-boss-open=\"nTrash\"><span class=\"boss-ico\"></span><b>Trash</b></button>");
            expect(trash).toContain("<section class=\"boss-detail\" id=\"boss-nTrash\" data-boss=\"nTrash\" hidden>");
            expect(trash).not.toContain("boss-head-ico");
        });

        it("heads a boss page with its facts: fight, activity when known, deaths", () => {
            expect(html).toContain("<div class=\"bfact\"><span class=\"kicker\">Kampf</span><b>Kill 3:00 <small>· 2 Tries</small></b></div>");
            expect(html).toContain("<div class=\"bfact\"><span class=\"kicker\">Tode</span><b class=\"bad\">2 Tode · 1 vermeidbar</b></div>");
            expect(html).not.toContain("<span class=\"kicker\">Aktivität</span>");
            const act = renderBossView({ fights: [fight({ activity: [{ name: "A", activePct: 80 }, { name: "B", activePct: 90 }] })] }, null, [], false);
            expect(act).toContain("<span class=\"kicker\">Aktivität</span><b class=\"warn\">Ø 85 %</b>");
        });
    });

    describe("bossFacts", () => {
        const groupOf = (...fights) => ({ fights });

        it("counts tries, wipes, deaths and avoidable deaths over all pulls and finds the kill", () => {
            const x = bossFacts(groupOf(fight({ id: 1, deaths: [{ name: "A", avoidable: true }, { name: "B" }] }), fight({ id: 2, kill: true, deaths: [{ name: "C", avoidable: true }] })));
            expect(x.tries).toBe(2);
            expect(x.wipes).toHaveLength(1);
            expect(x.kill.id).toBe(2);
            expect(x.deaths).toBe(3);
            expect(x.avoidable).toBe(2);
        });

        it("reports figures without a source as null", () => {
            const x = bossFacts(groupOf(fight()));
            expect(x.kill).toBeUndefined();
            expect(x.debuffs).toBeNull();
            expect(x.lacking).toBeNull();
            expect(x.undispelled).toBeNull();
            expect(x.activity).toBeNull();
        });

        it("counts expected debuffs once over the tries and missing ones when flagged or at 0 % uptime", () => {
            const x = bossFacts(groupOf(
                fight({ debuffs: [{ key: "coe", expected: true, missing: true }, { key: "sunder", expected: true, uptimePct: 90 }, { key: "x", expected: false, missing: true }] }),
                fight({ debuffs: [{ key: "coe", expected: true, uptimePct: 50 }, { key: "sunder", expected: true, uptimePct: 0 }] }),
            ));
            expect(x.debuffs).toEqual({ expected: 2, missing: 2 });
        });

        it("counts each raider short of buffs once, sums undispelled debuffs and rounds the mean activity", () => {
            const x = bossFacts(groupOf(
                fight({ buffs: { players: [{ name: "A", buffs: [], missing: ["kings"] }, { name: "B", buffs: [] }] }, healers: { dispels: { missed: [{}, {}] } }, activity: [{ activePct: 80 }, { activePct: 91 }] }),
                fight({ buffs: { players: [{ name: "A", buffs: [], missing: ["kings"] }] }, healers: { dispels: { missed: [{}] } }, activity: [{ activePct: "n/a" }] }),
            ));
            expect(x.lacking).toBe(1);
            expect(x.undispelled).toBe(3);
            expect(x.activity).toBe(86);
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
