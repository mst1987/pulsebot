// The drawn week strip of the raid overview (services/events/raidWeekStrip.js): pure SVG.
const { DateTime } = require("luxon");
const { raidWeekStripSvg, dayIndex, raidTag, fillState, WIDTH, HEIGHT } = require("../../../src/services/events/raidWeekStrip");
const { raidIdOf } = require("../../../src/utils/time/raidId");
const { PALETTE } = require("../../../src/utils/image/svg");
const { renderPng } = require("../../../src/services/discord/discordImage");

const zone = { zone: "Europe/Berlin" };
const at = (iso) => Math.floor(DateTime.fromISO(iso, zone).toSeconds());
// Friday 16 Oct 2026, 12:00 - the running ID is Wed 14.10. - Tue 20.10.
const NOW = DateTime.fromISO("2026-10-16T12:00:00", zone).toMillis();
const ID = raidIdOf(NOW);
const raid = (iso, over = {}) => ({ title: "Raid", startTime: at(iso), size: 25, signUps: [], ...over });
const attending = (e) => (e.signUps || []).length;
const people = (n) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));
const strip = (events, over = {}) => raidWeekStripSvg({ id: ID, events, title: "This ID", range: "Wed 14.10. – Tue 20.10.", now: NOW, lang: "en", attending, ...over });

describe("services/events/raidWeekStrip", () => {
    it("puts a raid on its day of the ID, one before the reset hour on the day before", () => {
        expect(dayIndex(at("2026-10-14T20:00:00") * 1000, ID)).toBe(0);
        expect(dayIndex(at("2026-10-20T23:30:00") * 1000, ID)).toBe(6);
        expect(dayIndex(at("2026-10-21T03:00:00") * 1000, ID)).toBe(6);
        expect(dayIndex(at("2026-10-21T06:00:00") * 1000, ID)).toBe(7);
    });

    it("tags a raid with the short names of its instances, else its title in capitals", () => {
        expect(raidTag({ title: "Whatever", instanceIds: ["hyjal", "bt"] })).toBe("HYJAL + BT");
        expect(raidTag({ title: "Kara Donnerstag" })).toBe("KARA");
        expect(raidTag({ title: "Gildenabend <&> Spaß" })).toBe("GILDENABEND <&> SPASS");
        expect(raidTag({})).toBe("RAID");
    });

    it("colours a raid by how full it is: grey under a third, green, orange when full", () => {
        expect(fillState({ size: 25 }, 3).color).toBe(PALETTE.grey);
        expect(fillState({ size: 25 }, 17)).toMatchObject({ color: PALETTE.green, share: 17 / 25 });
        expect(fillState({ size: 10 }, 12)).toMatchObject({ color: PALETTE.orange, share: 1 });
        expect(fillState({}, 5)).toEqual({ share: null, color: PALETTE.grey, size: 0 });
    });

    it("draws the heading, seven days Wednesday to Tuesday and the raids on their days", () => {
        const out = strip([
            raid("2026-10-17T20:00:00", { instanceIds: ["kara"], size: 10, signUps: people(10) }),
            raid("2026-10-18T19:30:00", { instanceIds: ["ssc"], signUps: people(17) }),
        ]);
        expect(out.width).toBe(WIDTH);
        expect(out.height).toBe(HEIGHT);
        expect(out.svg).toContain(">THIS ID<");
        expect(out.svg).toContain(">Wed 14.10. – Tue 20.10.<");
        for (const day of ["WED", "THU", "FRI", "SAT", "SUN", "MON", "TUE"]) expect(out.svg).toContain(`>${day}<`);
        for (const n of ["14", "15", "16", "17", "18", "19", "20"]) expect(out.svg).toContain(`>${n}</text>`);
        expect(out.svg).toContain(">KARA<");
        expect(out.svg).toContain(">SSC<");
        expect(out.svg).toContain(">20:00<");
        expect(out.svg).toContain(">19:30<");
        // full Kara: orange border, SSC 17/25: green
        expect(out.svg).toContain(`stroke="${PALETTE.orange}"`);
        expect(out.svg).toContain(`stroke="${PALETTE.green}"`);
        expect(out.alt).toBe("This ID · Wed 14.10. – Tue 20.10. · Sat 17.10. KARA 10/10 · Sun 18.10. SSC 17/25");
    });

    it("dims the days already over and marks today in the running ID", () => {
        const out = strip([]);
        // Wednesday and Thursday are over on a Friday
        expect(out.svg.match(/<g opacity="0.4">/g)).toHaveLength(2);
        expect(out.svg).toContain(`fill="${PALETTE.purple}" font-weight="700" letter-spacing="1">FRI<`);
        // the next ID: nothing over, no today
        const next = raidWeekStripSvg({ id: ID + 7 * 86400000, events: [], title: "Next ID", range: "", now: NOW, attending });
        expect(next.svg).not.toContain("<g opacity=\"0.4\">");
    });

    it("stacks two raids of a day and sums up a third and more as +n", () => {
        const two = strip([raid("2026-10-20T18:00:00", { instanceIds: ["mag"] }), raid("2026-10-20T20:00:00", { instanceIds: ["gruul"] })]);
        expect(two.svg).toContain(">MAGTHERIDON<");
        expect(two.svg).toContain(">GRUUL<");
        const three = strip([
            raid("2026-10-20T18:00:00", { instanceIds: ["mag"] }), raid("2026-10-20T19:00:00", { instanceIds: ["gruul"] }), raid("2026-10-20T21:00:00", { instanceIds: ["za"] }),
        ]);
        expect(three.svg).toContain(">+2<");
        expect(three.svg).not.toContain(">ZA<");
    });

    it("escapes a title with markup and cuts a long one to its chip", () => {
        const out = strip([raid("2026-10-17T20:00:00", { title: "<script>&Gildenabend mit sehr langem Namen</script>" })]);
        expect(out.svg).not.toContain("<script>");
        expect(out.svg).toContain("&lt;SCRIPT&gt;");
        expect(out.svg).toContain("…<");
    });

    it("speaks the category's language in the weekday names", () => {
        const out = strip([], { lang: "de", title: "Diese ID" });
        for (const day of ["MI", "DO", "FR", "SA", "SO", "MO", "DI"]) expect(out.svg).toContain(`>${day}<`);
        expect(out.svg).toContain(">DIESE ID<");
    });

    it("leaves out a raid that is not in the ID and keeps the alt text within Discord's 1024 characters", () => {
        expect(strip([raid("2026-10-28T20:00:00", { instanceIds: ["kara"] })]).svg).not.toContain(">KARA<");
        const many = Array.from({ length: 60 }, (_, i) => raid("2026-10-17T20:00:00", { title: `A long raid title number ${i}` }));
        expect(strip(many).alt.length).toBeLessThanOrEqual(1024);
    });

    it("renders to a PNG of its size", () => {
        const png = renderPng(strip([raid("2026-10-17T20:00:00", { instanceIds: ["kara"], signUps: people(4) })]).svg);
        expect(png.readUInt32BE(16)).toBe(WIDTH);
        expect(png.readUInt32BE(20)).toBe(HEIGHT);
    });
});
