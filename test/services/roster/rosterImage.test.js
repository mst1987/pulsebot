// The roster as a drawn picture (services/roster/rosterImage.js): pure SVG.
const { rosterImageSvg, panelOf, shortDate, longDate, WIDTH } = require("../../../src/services/roster/rosterImage");
const { PALETTE } = require("../../../src/utils/image/svg");
const { iconDataUri, specIconDataUri } = require("../../../src/utils/image/specIcons");
const { renderPng } = require("../../../src/services/discord/discordImage");

const ROLE_OF = { Protection: "tank", Holy: "healer", Restoration: "healer", Fury: "melee", Combat: "melee", Fire: "ranged", Destruction: "ranged" };
const m = (name, spec, extra = {}) => ({
    name,
    status: "core",
    classId: spec ? spec.split("-")[0] : "",
    spec: spec || "",
    specRole: spec ? ROLE_OF[spec.split("-")[1]] : "",
    role: "",
    extraChars: [],
    ...extra,
});

function model(members, slots = { total: 10, tank: 2, healer: 3 }) {
    return { name: "Kern", versionLabel: "TBC", stand: Date.UTC(2026, 9, 30, 12), slots, members };
}

/** How often `part` stands in `svg`. */
const count = (svg, part) => svg.split(part).length - 1;
/** The name as drawn: bold, in `color`. */
const named = (color, name) => `fill="${color}" font-weight="700">${name}<`;

describe("services/roster/rosterImage", () => {
    it("draws the four role panels with the people in their class colour", () => {
        const { svg, width } = rosterImageSvg(model([
            m("Brokk", "Warrior-Protection"),
            m("Nera", "Priest-Holy"),
            m("Zibbo", "Rogue-Combat"),
            m("Kalu", "Mage-Fire"),
        ]), { lang: "de" });
        for (const head of [">TANK<", ">HEILER<", ">NAHKAMPF<", ">FERNKAMPF<"]) expect(svg).toContain(head);
        expect(svg).toContain(named("#C79C6E", "Brokk"));
        expect(svg).toContain(named("#FFFFFF", "Nera"));
        expect(svg).toContain(named("#FFF569", "Zibbo"));
        expect(svg).toContain(named("#69CCF0", "Kalu"));
        expect(svg).toContain(`href="${specIconDataUri("Warrior-Protection", "Warrior")}"`);
        expect(width).toBe(WIDTH);
        expect(WIDTH).toBeGreaterThan(1200);
        expect(svg).not.toMatch(/Main/);
    });

    it("counts tanks and healers against their targets, orange while short", () => {
        const { svg } = rosterImageSvg(model([m("Brokk", "Warrior-Protection"), m("Nera", "Priest-Holy"), m("Ilsa", "Priest-Holy"), m("Mo", "Priest-Holy")]), { lang: "en" });
        expect(svg).toContain(`fill="${PALETTE.orange}" font-weight="700" text-anchor="end">1/2<`);
        expect(svg).toContain(`fill="${PALETTE.text}" font-weight="700" text-anchor="end">3/3<`);
        // the head counts all placed people against the total
        expect(svg).toContain(">4/10<");
        expect(svg).toContain(">slots<");
    });

    it("shows free places as a dashed box: per tank/healer target, the dps share once", () => {
        const { svg } = rosterImageSvg(model([m("Brokk", "Warrior-Protection"), m("Zibbo", "Rogue-Combat")]), { lang: "de" });
        expect(svg).toContain(">1 Platz frei<");
        expect(svg).toContain(">3 Plätze frei<");
        // 10 - 2 - 3 = 5 dps, one there: 4 free, in the shorter dps panel (ranged)
        expect(svg).toContain(">4 DD-Plätze frei<");
        expect(count(svg, "stroke-dasharray")).toBe(3);
    });

    it("has no counts against a target nor free places when the roster has no slots", () => {
        const { svg } = rosterImageSvg(model([m("Brokk", "Warrior-Protection")], {}), { lang: "en" });
        expect(svg).not.toContain("free<");
        expect(svg).not.toContain("stroke-dasharray");
        expect(svg).toContain(">players<");
        expect(svg).toContain("text-anchor=\"end\">1<");
    });

    it("puts trial members under a Probe subhead with the end of their trial", () => {
        const { svg } = rosterImageSvg(model([
            m("Brokk", "Warrior-Protection"),
            m("Ilsa", "Warrior-Protection", { status: "trial", trialUntil: "2026-11-14T10:00:00.000Z" }),
        ]), { lang: "de" });
        expect(count(svg, ">PROBE<")).toBe(1);
        expect(svg).toContain(">bis 14.11.<");
        expect(svg.indexOf(">Brokk<")).toBeLessThan(svg.indexOf(">PROBE<"));
        expect(svg.indexOf(">PROBE<")).toBeLessThan(svg.indexOf(">Ilsa<"));
    });

    it("leaves the date out for a trial without one (the slim view)", () => {
        const { svg } = rosterImageSvg(model([m("Ilsa", "Mage-Fire", { status: "trial", trialUntil: null })]), { lang: "en" });
        expect(svg).toContain(">TRIAL<");
        expect(svg).not.toContain("until");
    });

    it("keeps bench and pause out unless asked, then as a dashed box at the bottom", () => {
        const people = [m("Brokk", "Warrior-Protection"), m("Vex", "Mage-Fire", { status: "bench" }), m("Morn", "Rogue-Combat", { status: "pause" })];
        const off = rosterImageSvg(model(people, {}), { lang: "de" });
        expect(off.svg).not.toContain(">Vex<");
        expect(off.svg).not.toContain("ERSATZ");
        const on = rosterImageSvg(model(people, {}), { lang: "de", showReserve: true });
        expect(on.svg).toContain(">ERSATZ (1)<");
        expect(on.svg).toContain(">PAUSE (1)<");
        expect(on.svg).toContain(">Vex<");
        expect(on.svg).toContain("stroke-dasharray");
        expect(on.height).toBeGreaterThan(off.height);
        // bench and pause do not count as placed
        expect(on.svg).toContain("text-anchor=\"end\">1<");
    });

    it("draws no reserve box when nobody is on bench or pause", () => {
        const { svg } = rosterImageSvg(model([m("Brokk", "Warrior-Protection")], {}), { lang: "de", showReserve: true });
        expect(svg).not.toContain("ERSATZ");
        expect(svg).not.toContain("stroke-dasharray");
    });

    it("shows further chars only when asked, as small icons; with many, three and +n", () => {
        const extraChars = ["Mage-Fire", "Priest-Holy", "Warlock-Destruction", "Rogue-Combat", "Druid-Restoration"]
            .map((spec) => ({ spec, classId: spec.split("-")[0] }));
        const people = [m("Brokk", "Warrior-Protection", { extraChars: extraChars.slice(0, 2) }), m("Zibbo", "Rogue-Combat", { extraChars })];
        const off = rosterImageSvg(model(people), { lang: "en" });
        expect(off.svg).not.toContain(`href="${specIconDataUri("Mage-Fire", "Mage")}"`);
        const on = rosterImageSvg(model(people), { lang: "en", showMoreChars: true });
        expect(count(on.svg, `href="${specIconDataUri("Mage-Fire", "Mage")}"`)).toBe(2);
        expect(on.svg).not.toContain(`href="${specIconDataUri("Druid-Restoration", "Druid")}"`);
        expect(on.svg).toContain(">+2<");
        // only the first char is a row
        expect(on.svg).not.toContain(">MAGE");
    });

    it("cuts long names with an ellipsis to their room", () => {
        const { svg } = rosterImageSvg(model([m("Averyveryveryveryverylongcharactername", "Warrior-Protection")]), { lang: "en" });
        expect(svg).toMatch(/>Avery[a-z]*…</);
        expect(svg).not.toContain(">Averyveryveryveryverylongcharactername<");
    });

    it("gives a person without a spec the class icon, without a class a colour square", () => {
        const { svg } = rosterImageSvg(model([
            m("Thalia", "", { classId: "Priest", role: "healer" }),
            m("Nobody", "", { classId: "", role: "tank", color: "#123456" }),
        ]), { lang: "en" });
        expect(svg).toContain(`href="${iconDataUri("classicon_priest")}"`);
        expect(svg).toContain("fill=\"#123456\"");
        expect(svg).toContain(">Thalia<");
        expect(svg).toContain(">Nobody<");
    });

    it("loses nobody: a person whose role cannot be told stands under Role open", () => {
        const { svg } = rosterImageSvg(model([m("Ilsa", "", { classId: "Druid", role: "dps" }), m("Grim", "", { classId: "Warrior", role: "dps" })]), { lang: "de" });
        expect(svg).toContain(">ROLLE OFFEN (1)<");
        expect(svg).toContain(">Ilsa<");
        // a pure-damage class goes to its panel
        expect(svg).toContain(">Grim<");
    });

    it("draws an empty roster with a head and free places", () => {
        const { svg, height } = rosterImageSvg(model([]), { lang: "de" });
        expect(svg).toContain(">Kern<");
        expect(svg).toContain(">0/10<");
        expect(svg).toContain(">TBC  ·  Stand 30.10.2026<");
        expect(svg).toContain(">2 Plätze frei<");
        expect(svg).toContain(">5 DD-Plätze frei<");
        expect(svg).toContain(">Noch niemand<");
        expect(height).toBeGreaterThan(150);
        expect(rosterImageSvg(null).svg).toContain(">Roster<");
    });

    it("escapes names", () => {
        const { svg } = rosterImageSvg({ ...model([m("<b>&Kalümbra", "Mage-Fire")]), name: "A & <B>" }, { lang: "en" });
        expect(svg).toContain("&lt;b&gt;&amp;Kalümbra");
        expect(svg).toContain(">A &amp; &lt;B&gt;<");
        expect(svg).not.toContain("<b>");
    });

    it("renders to a PNG", () => {
        const { svg } = rosterImageSvg(model([m("Brokk", "Warrior-Protection", { status: "trial", trialUntil: "2026-11-14" })]), { showReserve: true, showMoreChars: true });
        const png = renderPng(svg);
        expect(png.subarray(1, 4).toString()).toBe("PNG");
    });

    describe("panelOf", () => {
        it("takes the spec role, then the roster role, then the class of a pure damage dealer", () => {
            expect(panelOf({ specRole: "ranged", role: "tank" })).toBe("ranged");
            expect(panelOf({ role: "healer", classId: "Priest" })).toBe("healer");
            expect(panelOf({ role: "dps", classId: "Mage" })).toBe("ranged");
            expect(panelOf({ role: "", classId: "Rogue" })).toBe("melee");
            expect(panelOf({ role: "dps", classId: "Druid" })).toBe("");
            expect(panelOf({ role: "other" })).toBe("");
        });
    });

    describe("dates", () => {
        it("formats in server time, German and English", () => {
            expect(shortDate("2026-11-14T23:30:00.000Z", "de")).toBe("15.11.");
            expect(shortDate("2026-11-14T10:00:00.000Z", "en")).toBe("14 Nov");
            expect(shortDate("", "de")).toBe("");
            expect(shortDate("nonsense", "de")).toBe("");
            expect(longDate(Date.UTC(2026, 9, 30, 12), "de")).toBe("30.10.2026");
            expect(longDate(Date.UTC(2026, 9, 30, 12), "en")).toBe("30 Oct 2026");
            expect(longDate("nonsense", "de")).toBe("");
        });
    });
});
