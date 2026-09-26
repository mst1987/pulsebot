// Raid buffs (src/web/report/panels/buffs.js): a fight's buff topic and the
// raid-wide player × buff matrix.
const { INFERRED_HOW, buffIssues, buffParts, renderRaidBuffsPanel } = require("../../../../src/web/report/panels/buffs");

const common = { duration: 120000, deaths: [], classColor: () => "" };

function fight(players, over = {}) {
    return { id: 7, duration: 120000, buffs: { paladins: 1, expected: ["kings", "motw"], players, ...over } };
}

const cell = (key, label, over = {}) => ({ key, label, icon: `icon_${key}`, status: "full", uptimePct: 100, expected: true, bands: [[0, 120000]], ...over });

describe("web/report/panels/buffs", () => {
    it("counts missing, late, partial and wrong buffs, tolerating a stored report without them", () => {
        expect(buffIssues({ missing: ["a"], late: ["b"], partial: ["c", "d"], wrong: ["e"] })).toBe(5);
        expect(buffIssues({})).toBe(0);
    });

    describe("buffParts", () => {
        it("returns null without buff data or players", () => {
            expect(buffParts({}, null, common)).toBeNull();
            expect(buffParts({ buffs: { players: [] } }, null, common)).toBeNull();
        });

        it("says everyone had everything when nobody lacked a buff", () => {
            const parts = buffParts(fight([{ name: "Brokk", type: "Warrior", role: "tank", buffs: [cell("kings", "Kings"), cell("motw", "Mark")] }]), null, common);
            expect(parts.count).toBe(0);
            expect(parts.chart).toBeNull();
            expect(parts.table).toBe("<p class=\"note\">1 Paladin · erwartet: Kings, Mark</p><p class=\"note\">Alle erwarteten Buffs auf allen Spielern.</p>");
        });

        it("lists who lacked what on the raid page, with role, death time and one chip per problem", () => {
            const players = [
                { name: "Brokk", type: "Warrior", role: "tank", diedAt: 65000,
                    buffs: [cell("kings", "Kings"), cell("might", "Might", { wrong: true })],
                    missing: ["kings"], late: ["motw"], partial: ["kings"], wrong: ["might"] },
                { name: "Elun", type: "Priest", role: "odd", buffs: [], missing: ["kings"] },
                { name: "Dorn", type: "Shaman", role: "melee", buffs: [] },
            ];
            const parts = buffParts(fight(players, { paladins: 2, expected: ["kings", "unseen"] }), null, common);
            expect(parts.count).toBe(2);
            expect(parts.chart).toBeNull();
            expect(parts.table).toContain("<p class=\"note\">2 Paladine · erwartet: Kings, unseen</p>");
            expect(parts.table).toContain("<ul class=\"fight-deaths buff-lacking\">");
            expect(parts.table).toContain("<li style=\"--cc:#C79C6E\"><span class=\"cn\">Brokk</span><span class=\"sritems\">Tank · bis 1:05</span>");
            expect(parts.table).toContain("<span class=\"tag tag-high\"><img class=\"hicon\" src=\"https://wow.zamimg.com/images/wow/icons/large/icon_kings.jpg\" alt=\"\">Kings fehlt</span>");
            // a key without its cell falls back to the key and no icon
            expect(parts.table).toContain("<span class=\"tag tag-medium\">motw spät gesetzt</span>");
            expect(parts.table).toContain("Kings nicht durchgehend</span>");
            expect(parts.table).toContain("Might · falsche Rolle</span>");
            // an unknown role is shown as it is
            expect(parts.table).toContain("<span class=\"sritems\">odd</span>");
            expect(parts.table).not.toContain(">Dorn<");
        });

        it("names the inferred buffs and the open cells in the head", () => {
            const players = [{ name: "A", type: "Mage", role: "caster", buffs: [cell("fort", "Fortitude", { status: "unknown" }), cell("motw", "Mark", { status: "unknown" })] }];
            const parts = buffParts(fight(players, { paladins: 0, expected: [], inferred: ["fort", "gone"] }), null, common);
            expect(parts.table).toContain("<p class=\"note\">0 Paladine · erwartet: nichts · <span data-tip=\"");
            expect(parts.table).toContain("\">aus dem Verlauf abgeleitet: Fortitude, gone (2 ohne Nachweis)</span></p>");
            const closed = buffParts(fight([{ name: "A", type: "Mage", buffs: [] }], { inferred: ["fort"] }), null, common);
            expect(closed.table).toContain("aus dem Verlauf abgeleitet: fort</span>");
        });

        it("draws one raider's buffs as ribbons on the player page, toned by status", () => {
            const players = [{
                name: "Elun", type: "Priest", role: "healer",
                buffs: [
                    cell("kings", "Kings"),
                    cell("wisdom", "Wisdom", { status: "late", uptimePct: 80 }),
                    cell("motw", "Mark", { status: "partial", uptimePct: 60 }),
                    cell("fort", "Fort", { status: "none", uptimePct: 0 }),
                    cell("spirit", "Spirit", { status: "unknown", uptimePct: 0 }),
                    cell("might", "Might", { expected: false, wrong: true, uptimePct: 90 }),
                    cell("salv", "Salvation", { expected: false, uptimePct: 50, bands: undefined }),
                ],
                missing: ["fort"], late: ["wisdom"],
            }];
            const parts = buffParts(fight(players), "Elun", common);
            expect(parts.count).toBe(2);
            expect(parts.table).toContain("alt=\"\">Kings</td><td><span class=\"tv good\">100%</span></td><td>da</td>");
            expect(parts.table).toContain("Wisdom</td><td><span class=\"tv medium\">80%</span></td><td>spät gesetzt</td>");
            expect(parts.table).toContain("Mark</td><td><span class=\"tv medium\">60%</span></td><td>nicht durchgehend</td>");
            expect(parts.table).toContain("Fort</td><td><span class=\"tv high\">0%</span></td><td>fehlt</td>");
            expect(parts.table).toContain("Spirit</td><td><span class=\"tv\">0%</span></td><td>nicht nachweisbar</td>");
            expect(parts.table).toContain("Might (falsche Rolle)</td><td><span class=\"tv high\">90%</span></td><td>falsche Rolle</td>");
            expect(parts.table).toContain("Salvation</td><td><span class=\"tv\">50%</span></td><td>nicht erwartet</td>");
            expect(parts.chart).toContain("<figure");
            expect(buffParts(fight(players), "Nobody", common)).toBeNull();
        });
    });

    describe("renderRaidBuffsPanel", () => {
        it("says so without players or columns, keeping the untracked and inferred badges", () => {
            expect(renderRaidBuffsPanel({ players: [], rows: [] })).toBe("<div class=\"empty\">Keine Raid-Buffs im Log.</div>");
            const html = renderRaidBuffsPanel({
                players: [{ name: "A", type: "Mage", buffs: {} }],
                rows: [{ key: "fort", expected: true }],
                untracked: [{ key: "fort", label: "Fortitude", groupLabel: "Prayer", icon: "spell_fort" }],
                inferred: [{ label: "Mark", icon: "spell_motw" }],
                unknownCells: 1,
            });
            expect(html).toContain("<span class=\"badge\" data-tip=\"Im Log nicht nachweisbar: Fortitude / Prayer\"");
            expect(html).toContain("nicht nachweisbar</span>");
            expect(html).toContain("<span class=\"badge accent\" data-tip=\"Aus dem Verlauf abgeleitet: Mark\" data-tip-sub=\"");
            expect(html).toContain("1 Zelle bleibt ohne Nachweis.");
            expect(html).toContain("abgeleitet · 1 ?</span>");
            expect(html).toContain("<div class=\"empty\">Keine Raid-Buffs im Log.</div>");
        });

        it("renders the coverage row and one row per player, sorted by class and name", () => {
            const html = renderRaidBuffsPanel({
                paladins: 1,
                rows: [
                    { key: "kings", label: "Kings", icon: "spell_kings", provider: "Paladin", expected: true, coveragePct: 90, groupLabel: "Greater" },
                    { key: "motw", label: "Mark", icon: "spell_motw", provider: "Druid", expected: false, seenPlayers: 1, inferred: true },
                    { key: "unseen", label: "Nope", expected: false, seenPlayers: 0 },
                    { key: "fort", label: "Fort", provider: "Priest", expected: false, unknown: 2 },
                ],
                inferred: [{ label: "Fort", groupLabel: "Prayer", icon: "spell_fort" }],
                players: [
                    { name: "Zed", type: "Warrior", role: "melee", fights: 1, buffs: {
                        kings: { pct: 50, full: 1, late: 0, partial: 1, none: 0, expected: true, unknown: 1 },
                        motw: { pct: 100, present: 2, expected: false },
                        fort: { expected: false, unknown: 2 },
                    } },
                    { name: "Ann", type: "Warrior", role: "tank", fights: 2, buffs: {
                        kings: { pct: 100, wrong: 1 },
                    } },
                    { name: "Elun", type: "Priest", role: "healer", fights: 2 },
                ],
            }, (n) => (n === "Ann" ? "/r/x/p/0" : null));
            expect(html).toContain("<table class=\"idx heal-table buff-matrix\">");
            expect(html).not.toContain("Nope");
            expect(html).toContain("data-tip=\"Kings / Greater (Paladin)\"");
            expect(html).toContain("data-tip=\"Mark (Druid) · aus dem Verlauf abgeleitet\"");
            expect(html).toContain("<tr class=\"cov\"><td><b>Abdeckung</b><div class=\"sritems\">Raid</div></td><td class=\"bc\"><span class=\"pct pct-part\">90%</span></td><td class=\"bc\"><span class=\"pct pct-na\">–</span></td>");
            const order = [...html.matchAll(/class="cn"[^>]*>(\w+)</g)].map((m) => m[1]);
            expect(order).toEqual(["Elun", "Ann", "Zed"]);
            expect(html).toContain("<a class=\"cn\" href=\"/r/x/p/0\">Ann</a><div class=\"sritems\">Warrior · Tank · 2 Kämpfe</div>");
            expect(html).toContain("<span class=\"pct pct-wrong\" data-tip=\"Kings\" data-tip-sub=\"1× auf der falschen Rolle\">100%</span>");
            expect(html).toContain("<td class=\"bc\" data-tip=\"Kings\" data-tip-sub=\"1× da, 0× spät gesetzt, 1× nicht durchgehend, 0× gefehlt, 1× nicht nachweisbar\"><span class=\"pct pct-part\">50%</span></td>");
            expect(html).toContain("<span class=\"pct pct-na\" data-tip=\"Mark\" data-tip-sub=\"nicht erwartet, 2× da\">100%</span>");
            expect(html).toContain("<span class=\"pct pct-na\" data-tip=\"Fort\" data-tip-sub=\"2× nicht nachweisbar\">?</span>");
            expect(html).toContain("<span class=\"cn\">Zed</span><div class=\"sritems\">Warrior · Nahkampf · 1 Kampf</div>");
            // Elun has no buffs recorded: dashes
            expect(html).toMatch(/Elun<\/span><div class="sritems">Priest · Heiler · 2 Kämpfe<\/div><\/td><td class="bc"><span class="pct pct-na">–<\/span><\/td>/);
            expect(html).toContain("1 Paladin heißt ein Segen pro Spieler");
            expect(html).toContain("abgeleitet</span>");
        });

        it("explains several paladins in the head's tooltip", () => {
            const html = renderRaidBuffsPanel({ paladins: 3, rows: [{ key: "k", label: "K", expected: true, coveragePct: 100 }], players: [{ name: "A", type: "Mage", role: "caster", fights: 1, buffs: {} }] });
            expect(html).toContain("3 Paladine heißt 3 Segen pro Spieler");
            expect(html).not.toContain("<div class=\"badges\">");
        });
    });

    it("explains inferred buffs", () => {
        expect(INFERRED_HOW).toMatch(/^Der Client loggt diesen Buff beim Pull nicht\./);
    });
});
