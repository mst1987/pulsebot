// The setup as a drawn picture (services/setup/setupImage.js): pure SVG.
const { setupImageSvg, classColor, columnsFor } = require("../../../src/services/setup/setupImage");
const { PALETTE } = require("../../../src/utils/image/svg");
const { renderPng } = require("../../../src/services/discord/discordImage");

const p = (userId, character, spec, role) => ({ userId, character, classId: spec.split("-")[0], spec, role });
const group = (index, slots) => ({ index, slots });

function approved() {
    return {
        version: 2,
        groups: [
            group(1, [p("1", "Brokk", "Warrior-Protection", "tank"), p("2", "Zibbo", "Priest-Holy", "healer")]),
            group(2, [p("3", "<b>&Kalümbra", "Mage-Arcane", "ranged"), p("4", "Averyveryverylongcharactername", "Rogue-Combat", "melee")]),
            group(3, []),
        ],
        bench: [p("5", "Thalia", "Priest-Shadow", "ranged")],
    };
}

describe("services/setup/setupImage", () => {
    it("draws one panel per group with people, its raiders in their class colour", () => {
        const out = setupImageSvg(approved(), { lang: "en" });
        expect(out.svg).toContain(">GROUP 1<");
        expect(out.svg).toContain(">GROUP 2<");
        expect(out.svg).not.toContain(">GROUP 3<");
        expect(out.svg).toContain("fill=\"#C79C6E\" font-weight=\"700\">Brokk<");
        expect(out.svg).toContain("fill=\"#FFFFFF\" font-weight=\"700\">Zibbo<");
        expect(out.svg).toContain(">Protection<");
        // two panels side by side
        expect(out.width).toBe(2 * 24 + 2 * 320 + 16);
    });

    it("escapes names and cuts a long one to its panel", () => {
        const { svg } = setupImageSvg(approved(), { lang: "en" });
        expect(svg).toContain("&lt;b&gt;&amp;Kalümbra");
        expect(svg).not.toContain("<b>");
        expect(svg).toMatch(/>Averyvery[^<]*…</);
        expect(svg).not.toContain("Averyveryverylongcharactername");
    });

    it("draws the confirm marks: a green tick, a red cross, nothing while unanswered", () => {
        const { svg } = setupImageSvg(approved(), { lang: "en", confirmations: { 1: "confirmed", 2: "declined" } });
        expect(svg).toContain(`stroke="${PALETTE.green}"`);
        expect(svg).toContain(`stroke="${PALETTE.red}"`);
        expect(setupImageSvg(approved(), { lang: "en" }).svg).not.toContain(`stroke="${PALETTE.green}"`);
    });

    it("adds the bench as the last panel only when it is posted, in the language", () => {
        expect(setupImageSvg(approved(), { lang: "en" }).svg).not.toContain("Thalia");
        const de = setupImageSvg(approved(), { lang: "de", bench: true }).svg;
        expect(de).toContain(">BANK (1)<");
        expect(de).toContain(">GRUPPE 1<");
        expect(de).toContain(">Thalia<");
        expect(de).toContain(">Schutz<");
        const many = { ...approved(), bench: Array.from({ length: 12 }, (_, i) => p(`b${i}`, `Bench${i}`, "Mage-Fire", "ranged")) };
        const svg = setupImageSvg(many, { lang: "en", bench: true }).svg;
        expect(svg).toContain(">BENCH (12)<");
        expect(svg).toContain(">+5 more<");
        expect(svg).toContain(">Bench6<");
        expect(svg).not.toContain(">Bench7<");
    });

    it("lays the panels out three to a row, two for two or four, four from seven on", () => {
        expect([1, 2, 3, 4, 5, 6, 7, 9].map(columnsFor)).toEqual([1, 2, 3, 2, 3, 3, 4, 4]);
        const fiveGroups = { groups: [1, 2, 3, 4, 5].map((i) => group(i, [p(`${i}`, `N${i}`, "Druid-Feral", "tank")])) };
        const out = setupImageSvg(fiveGroups);
        expect(out.width).toBe(2 * 24 + 3 * 320 + 2 * 16);
        expect(out.height).toBeGreaterThan(2 * 100);
    });

    it("takes the class colour from the class, else from the spec, white without either", () => {
        expect(classColor({ classId: "Hunter" })).toBe("#ABD473");
        expect(classColor({ spec: "Shaman-Restoration" })).toBe("#0070DE");
        expect(classColor({})).toBe(PALETTE.text);
        expect(classColor(null)).toBe(PALETTE.text);
    });

    it("draws nothing without a group that has anybody in it, and a nameless raider as 'Raider'", () => {
        expect(setupImageSvg({ groups: [group(1, [])] })).toBeNull();
        expect(setupImageSvg(null)).toBeNull();
        expect(setupImageSvg({ groups: [group(1, [{ userId: "9" }])] }).svg).toContain(">Raider<");
    });

    it("renders to a PNG of its size", () => {
        const out = setupImageSvg(approved(), { bench: true });
        const png = renderPng(out.svg);
        expect(png.readUInt32BE(16)).toBe(out.width);
        expect(png.readUInt32BE(20)).toBe(out.height);
    });
});
