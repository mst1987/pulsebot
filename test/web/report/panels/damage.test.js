// RPB avoidable damage (src/web/report/panels/damage.js): the ability icon and
// the table in both orientations.
const { DMG_SCALE_HOW, abilityIcon, renderRpbDamagePanel } = require("../../../../src/web/report/panels/damage");

const ICON = (name) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`;

function damage() {
    return {
        abilities: [
            { name: "Whirlwind", label: "Wirbelwind", sources: ["Maulgar", "Blindeye"] },
            { name: "Unknown", label: "Shatter", icon: "spell_shatter" },
            { name: "Nothing", label: "Leer <x>" },
        ],
        players: [
            { name: "Brokk", type: "Warrior", perAbility: [1000, 0, 0], avoidableTotal: 1000, reflected: 0, hostile: 0, deaths: 0 },
            { name: "Elun", type: "Priest", perAbility: [400, 600], avoidableTotal: 1000, reflected: 50, hostile: 10, deaths: 2 },
            { name: "Tia", type: "Paladin", perAbility: [800, 0], avoidableTotal: 700, reflected: 100, hostile: 0 },
        ],
    };
}

describe("web/report/panels/damage", () => {
    describe("abilityIcon", () => {
        it("uses the ability's own icon, then the config icon by name, else nothing", () => {
            expect(abilityIcon({ icon: "spell_x", name: "Whirlwind" })).toBe(`<img class="hicon" src="${ICON("spell_x")}" alt="" loading="lazy">`);
            expect(abilityIcon({ name: "Whirlwind" })).toBe(`<img class="hicon" src="${ICON("ability_whirlwind")}" alt="" loading="lazy">`);
            expect(abilityIcon({ name: "Nothing-known" })).toBe("");
        });
    });

    it("says so without players", () => {
        expect(renderRpbDamagePanel(null, {}, () => null)).toBe("<div class=\"empty\">Keine Schadensdaten gefunden.</div>");
        expect(renderRpbDamagePanel({ players: [] }, {}, () => null)).toBe("<div class=\"empty\">Keine Schadensdaten gefunden.</div>");
    });

    describe("renderRpbDamagePanel", () => {
        const roles = { Tia: "Tank", Elun: "Healer" };
        const linkFor = (name) => (name === "Elun" ? "/r/x/p/1" : null);
        const html = renderRpbDamagePanel(damage(), roles, linkFor);
        const byPlayer = html.slice(html.indexOf("tview-p"), html.indexOf("tview-a"));
        const byAbility = html.slice(html.indexOf("tview-a"));

        it("wraps both orientations in one filter scope with the orientation buttons", () => {
            expect(html).toMatch(/^<div class="dscope"><div class="dtools">/);
            expect(html).toContain("data-orient=\"a\"");
            expect(html).toContain("<div class=\"tview tview-p\">");
            expect(html).toContain("<div class=\"tview tview-a\">");
        });

        it("orders raiders by role and scales each column to the raid-wide maximum", () => {
            const order = [...byPlayer.matchAll(/<tr data-role="(\w+)" data-name="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
            expect(order).toEqual(["Tank:Tia", "Healer:Elun", "Physical:Brokk"]);
            // Brokk's 1000 is the column maximum: a full, high bar; Tia's 800 is 80 %: high; Elun's 400: none
            expect(byPlayer).toContain("<i class=\"high\" style=\"width:100%\"></i><b class=\"high\">1.000</b>");
            expect(byPlayer).toContain("<i class=\"high\" style=\"width:80%\"></i><b class=\"high\">800</b>");
            expect(byPlayer).toContain("<i style=\"width:40%\"></i><b>400</b>");
            // reflected: Elun has half the maximum
            expect(byPlayer).toContain("<i class=\"medium\" style=\"width:50%\"></i><b class=\"medium\">50</b>");
            // zero and missing values are a dot
            expect(byPlayer).toContain("<span class=\"mute mono\">·</span>");
        });

        it("heads each ability with its icon, sources and the scale explanation", () => {
            expect(byPlayer).toContain(`<th class="n" data-tip="Wirbelwind" data-tip-sub="Quelle: Maulgar, Blindeye. ${DMG_SCALE_HOW}"><img class="hicon" src="${ICON("ability_whirlwind")}"`);
            expect(byPlayer).toContain(`<th class="n" data-tip="Leer &lt;x&gt;" data-tip-sub="${DMG_SCALE_HOW}">Leer &lt;x&gt;</th>`);
        });

        it("tones deaths as a count badge", () => {
            expect(byPlayer).toContain("<span class=\"badge bad count\">2</span>");
            expect(byPlayer).toContain("<span class=\"badge ok count\">0</span>");
        });

        it("transposes: one column per raider carrying the role, abilities and sums as rows", () => {
            expect(byAbility).toContain("<th class=\"rcol\" data-role=\"Healer\" data-name=\"Elun\" data-tip=\"Elun\" data-tip-sub=\"Priest\"><a href=\"/r/x/p/1\" style=\"text-decoration:none\"><span class=\"rcol-in\">");
            expect(byAbility).toContain("<th class=\"rcol\" data-role=\"Tank\" data-name=\"Tia\" data-tip=\"Tia\" data-tip-sub=\"Paladin\"><span class=\"rcol-in\">");
            expect(byAbility).toContain("<td class=\"pcol\" data-tip=\"Wirbelwind\" data-tip-sub=\"Maulgar, Blindeye\">");
            expect(byAbility).toContain("<td class=\"pcol\" data-tip=\"Shatter\"><img");
            for (const label of ["Summe", "Reflektiert", "Auf Spieler", "Tode"]) {
                expect(byAbility).toContain(`<td class="pcol"><strong>${label}</strong></td>`);
            }
            expect(byAbility).toContain("<td class=\"n\" data-role=\"Healer\" data-name=\"Elun\"><span class=\"badge bad count\">2</span></td>");
        });
    });

    it("handles a report without abilities", () => {
        const html = renderRpbDamagePanel({ players: [{ name: "A", type: "Mage", perAbility: [], avoidableTotal: 5 }] }, null, () => null);
        expect(html).toContain("<tr><th class=\"pcol\">Spieler</th><th class=\"n\" data-tip=\"Summe\"");
        expect(html).toContain("<i class=\"high\" style=\"width:100%\"></i><b class=\"high\">5</b>");
    });
});
