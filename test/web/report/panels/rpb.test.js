// The RPB panels (src/web/report/panels/rpb.js): activity, spells, interrupts,
// log validation and cooldown usage.
const {
    RPB_ACTIVITY_HOW, renderRpbActivityPanel, spellTiles, SPELLS_HOW, renderRpbSpellsPanel,
    renderRpbInterruptsPanel, renderRpbValidationPanel, renderRpbUsagePanel,
} = require("../../../../src/web/report/panels/rpb");

const linkFor = (name) => (name === "Elun" ? "/r/x/p/1" : null);
const roles = { Elun: "Healer", Tia: "Tank" };

describe("web/report/panels/rpb", () => {
    describe("renderRpbActivityPanel", () => {
        it("says so without players", () => {
            expect(renderRpbActivityPanel(null, roles, linkFor)).toBe("<div class=\"empty\">Keine Aktivitätsdaten gefunden.</div>");
            expect(renderRpbActivityPanel({ players: [] }, roles, linkFor)).toBe("<div class=\"empty\">Keine Aktivitätsdaten gefunden.</div>");
        });

        it("renders active seconds per raider in role order, with the gear haste as tooltip", () => {
            const html = renderRpbActivityPanel({
                raidSeconds: 900,
                players: [
                    { name: "Brokk", type: "Warrior", secondsActive: 700, relativeTotal: 78, secondsActiveST: 600, secondsActiveAoe: 100, hasteSecondsSubtracted: 0 },
                    { name: "Elun", type: "Priest", secondsActive: 850, relativeTotal: 96, secondsActiveST: 800, secondsActiveAoe: 50, hasteSecondsSubtracted: 30, gearSpellHaste: 120 },
                ],
            }, roles, linkFor);
            expect(html.indexOf("data-name=\"Elun\"")).toBeLessThan(html.indexOf("data-name=\"Brokk\""));
            expect(html).toContain("<td class=\"pcol\" data-tip=\"Elun\" data-tip-sub=\"Zaubertempo aus Ausrüstung: 120\">");
            expect(html).toContain("<td class=\"n\"><strong>850s</strong></td>");
            expect(html).toContain("<b class=\"good\">96 %</b>");
            expect(html).toContain("<b class=\"medium\">78 %</b>");
            expect(html).toContain("<td class=\"n\">30s</td>");
            expect(html).toContain("Kampfzeit des Raids (900s)");
            expect(html).toContain(`data-tip-sub="${RPB_ACTIVITY_HOW}"`);
            expect(html).toMatch(/^<div class="dscope"><div class="dtools">/);
        });
    });

    describe("spellTiles", () => {
        it("drops spells never cast and notes uptime and lower ranks", () => {
            const tiles = spellTiles([
                { name: "Frostbolt", label: "Frostbolt", icon: "spell_frost", spellId: 116, amount: 40, uptimePercent: 0, lowerRankPercent: 25, lowerRankCasts: 10, mostlyLowerRank: false },
                { name: "Blizzard", icon: "spell_bliz", amount: 0 },
                { name: "Whirlwind", amount: 3, mostlyLowerRank: true },
            ]);
            expect(tiles).toHaveLength(2);
            expect(tiles[0]).toContain("data-tip=\"Frostbolt ×40\" data-tip-sub=\"Uptime 0% · 25% niedriger Rang (10×)\"");
            expect(tiles[0]).toContain("href=\"https://www.wowhead.com/tbc/spell=116\"");
            // label falls back to the name, the icon to the config lookup, the tone to warn
            expect(tiles[1]).toContain("<span class=\"itile warn\" data-tip=\"Whirlwind ×3\"");
            expect(tiles[1]).toContain("ability_whirlwind.jpg");
        });
    });

    describe("renderRpbSpellsPanel", () => {
        it("says so when nobody cast a tracked spell", () => {
            expect(renderRpbSpellsPanel({ players: [{ name: "A" }] }, roles, linkFor)).toBe("<div class=\"empty\">Keine getrackten Zauber gefunden.</div>");
            expect(renderRpbSpellsPanel(null, roles, linkFor)).toBe("<div class=\"empty\">Keine getrackten Zauber gefunden.</div>");
        });

        it("renders single target and area spells and counts the downranked ones", () => {
            const html = renderRpbSpellsPanel({
                players: [
                    { name: "Zed", type: "Mage", singleTargetCasts: [{ name: "Fireball", label: "Feuerball", icon: "spell_fb", amount: 20, mostlyLowerRank: true }], aoeCasts: [{ name: "Flamestrike", icon: "spell_fs", amount: 5, mostlyLowerRank: true }] },
                    { name: "Elun", type: "Priest", aoeCasts: [{ name: "Holy Nova", icon: "spell_hn", amount: 2 }] },
                    { name: "Nox", type: "Rogue" },
                ],
            }, roles, linkFor);
            expect(html).not.toContain("data-name=\"Nox\"");
            expect(html).toContain("<span class=\"badge bad count\" data-tip=\"Nicht im höchsten Rang\" data-tip-sub=\"Feuerball, Flamestrike\">2</span>");
            expect(html).toContain("<span class=\"badge ok count\">0</span>");
            // Elun has no single-target casts: a dash
            expect(html).toContain("<td><span class=\"sritems\">–</span></td>");
            expect(html).toContain(`data-tip-sub="${SPELLS_HOW}"`);
        });
    });

    describe("renderRpbInterruptsPanel", () => {
        it("says so without players", () => {
            expect(renderRpbInterruptsPanel(null, linkFor)).toBe("<div class=\"empty\">Keine Unterbrechungen gefunden.</div>");
        });

        it("renders the count as a bar, the interrupted spells as tiles and the kicks used", () => {
            const html = renderRpbInterruptsPanel({
                players: [
                    { name: "Nox", type: "Rogue", count: 8, spells: [{ name: "Heal", icon: "spell_heal", spellId: 2054, count: 5 }], kicks: [{ name: "Kick", count: 8 }] },
                    { name: "Elun", type: "Priest", count: 2 },
                ],
            }, linkFor);
            expect(html).toContain("<i style=\"width:100%\"></i><b>8</b>");
            expect(html).toContain("<i style=\"width:25%\"></i><b>2</b>");
            expect(html).toContain("data-tip=\"Heal ×5\"");
            expect(html).toContain("<td class=\"sritems\">Kick ×8</td>");
            expect(html).toContain("<td class=\"sritems\">–</td>");
            expect(html).toContain("href=\"/r/x/p/1\"");
        });
    });

    describe("renderRpbValidationPanel", () => {
        it("says so without validation data", () => {
            expect(renderRpbValidationPanel(null)).toBe("<div class=\"empty\">Keine Validierungsdaten.</div>");
        });

        it("shows zone and bosses and the note when no requirements are stored", () => {
            const html = renderRpbValidationPanel({ bossesKilled: 2, bossesTotal: 2, note: "Keine <Anforderungen>" });
            expect(html).toContain("<span class=\"badge\">Zone: unbekannt</span>");
            expect(html).toContain("2 / 2 Bosse gelegt</span>");
            expect(html).toContain("<span class=\"badge ok\">");
            expect(html).toContain("<div class=\"empty\">Keine &lt;Anforderungen&gt;</div>");
            expect(renderRpbValidationPanel({ zones: ["BT"], requirements: [], bossesKilled: 0, bossesTotal: 9 })).toContain("Keine Trash-Anforderungen hinterlegt.");
        });

        it("lists the requirements and the verdict", () => {
            const v = { zones: ["Black Temple", "Hyjal"], bossesKilled: 3, bossesTotal: 9, valid: false, requirements: [
                { label: "Ashtongue", zone: "BT", killed: 10, minimum: 12, ok: false },
                { label: "Illidari", zone: "BT", killed: 20, minimum: 15, ok: true },
            ] };
            const html = renderRpbValidationPanel(v);
            expect(html).toContain("Zone: Black Temple, Hyjal");
            expect(html).toContain("<span class=\"badge mid\">");
            expect(html).toContain("<span class=\"badge bad\">1 Anforderung nicht erfüllt</span>");
            expect(html).toContain("<td class=\"pcol\">Ashtongue</td>\n      <td>BT</td>\n      <td class=\"n\"><strong>10</strong></td>\n      <td class=\"n\">12</td>\n      <td class=\"n\"><span class=\"badge bad\">zu wenig</span></td>");
            expect(html).toContain("<span class=\"badge ok\">ok</span>");
            const ok = renderRpbValidationPanel({ ...v, valid: true, requirements: [v.requirements[1]] });
            expect(ok).toContain("<span class=\"badge ok\">Trash-Anforderungen erfüllt</span>");
            const two = renderRpbValidationPanel({ ...v, requirements: [v.requirements[0], v.requirements[0]] });
            expect(two).toContain("2 Anforderungen nicht erfüllt");
        });
    });

    describe("renderRpbUsagePanel", () => {
        it("says so without usage or without any tracked use", () => {
            expect(renderRpbUsagePanel(null, roles, linkFor)).toBe("<div class=\"empty\">Keine Nutzungsdaten gefunden.</div>");
            expect(renderRpbUsagePanel([], roles, linkFor)).toBe("<div class=\"empty\">Keine Nutzungsdaten gefunden.</div>");
            expect(renderRpbUsagePanel([{ name: "A" }], roles, linkFor)).toBe("<div class=\"empty\">Keine Cooldowns oder Schmuckstücke erfasst.</div>");
        });

        it("tiles class cooldowns (warn under half the possible uses), trinkets and engineering", () => {
            const html = renderRpbUsagePanel([
                { name: "Brokk", type: "Warrior",
                    classCooldowns: [{ name: "Death Wish", label: "Todeswunsch", icon: "spell_dw", spellId: 12292, total: 1, possibleUses: 4 }, { name: "Recklessness", label: "Tollkühnheit", icon: "spell_reck", total: 2 }],
                    trinketsAndRacials: [{ name: "Blood Fury", label: "Blutrausch", icon: "racial_bf", total: 3 }],
                    engineering: [{ name: "Sapper", label: "Sapper", icon: "inv_sapper", total: 1 }],
                    absorbs: [{ name: "Shield", label: "Schild", icon: "inv_shield", total: 2 }] },
                { name: "Tia", type: "Paladin", absorbs: [{ name: "X", label: "X", icon: "inv_x", total: 1 }] },
            ], roles, linkFor);
            expect(html.indexOf("data-name=\"Tia\"")).toBeLessThan(html.indexOf("data-name=\"Brokk\""));
            expect(html).toContain("<a class=\"itile warn\" href=\"https://www.wowhead.com/tbc/spell=12292\" target=\"_blank\" rel=\"noopener\" data-tip=\"Todeswunsch ×1\" data-tip-sub=\"1 von ~4 möglichen\"");
            expect(html).toContain("<span class=\"itile good\" data-tip=\"Tollkühnheit ×2\" data-disable-wowhead-tooltip=\"true\">");
            expect(html).toContain("data-tip=\"Blutrausch ×3\"");
            expect(html).toContain("data-tip=\"Sapper ×1\"");
            expect(html).toContain("data-tip=\"Schild ×2\"");
            // Tia has only an absorb: two dashes before the tile row
            expect(html).toMatch(/data-name="Tia">[\s\S]*?<td><span class="sritems">–<\/span><\/td>\s*<td><span class="sritems">–<\/span><\/td>\s*<td><div class="iconrow">/);
        });
    });
});
