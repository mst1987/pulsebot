const {
    ribbonChart, markerChart, barChart, lineChart, fmtTime, axisTicks, bandStats,
} = require("../../src/web/charts.js");

const classColor = (type) => ({ Mage: "#69CCF0", Priest: "#FFFFFF" }[type] || "");

describe("web/charts — helpers", () => {
    it("formats offsets as m:ss and hours past sixty minutes", () => {
        expect(fmtTime(0)).toBe("0:00");
        expect(fmtTime(65000)).toBe("1:05");
        expect(fmtTime(3725000)).toBe("1:02:05");
        expect(fmtTime(-5)).toBe("0:00");
    });

    it("picks a tick step that yields at most eight ticks", () => {
        expect(axisTicks(30000)).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000]);
        expect(axisTicks(240000)).toEqual([0, 30000, 60000, 90000, 120000, 150000, 180000, 210000, 240000]);
        expect(axisTicks(600000).length).toBeLessThanOrEqual(9);
        expect(axisTicks(0)).toEqual([0]);
    });

    it("bandStats merges overlaps and counts lead-in and tail gaps", () => {
        const s = bandStats([{ from: 10, to: 40 }, { from: 35, to: 60 }, { from: 80, to: 90 }], 100);
        expect(s).toEqual({ uptimePct: 60, gapCount: 3, longestGap: 20, firstAt: 10 });
        expect(bandStats([], 100)).toEqual({ uptimePct: 0, gapCount: 1, longestGap: 100, firstAt: null });
    });
});

describe("web/charts — ribbonChart", () => {
    const chart = {
        duration: 120000,
        title: "Debuffs",
        rows: [
            { label: "Sunder Armor", icon: "ability_warrior_sunder", bands: [{ from: 0, to: 30000, stacks: 2 }, { from: 30000, to: 120000, stacks: 5 }], maxStacks: 5, value: "100%", tone: "good" },
            { label: "Faerie Fire", bands: [[10000, 70000]], value: "50%", tone: "high" },
        ],
        deaths: [{ at: 60000, name: "Aldra", type: "Mage", ability: "Shatter" }],
        classColor,
    };

    it("draws one band per interval, scaled to the plot width", () => {
        const html = ribbonChart(chart);
        expect(html).toContain("<svg class=\"fchart fc-ribbon\"");
        const rects = html.match(/<rect class="fc-band[^>]*>/g);
        expect(rects).toHaveLength(3);
        // the plot is 900 - 150 - 56 = 694 wide; a 30 s band of a 120 s fight is a quarter of it
        expect(rects[0]).toContain("x=\"150.0\"");
        expect(rects[0]).toContain("width=\"173.5\"");
        // Faerie Fire's band from 10 s to 70 s starts at 150 + 694/12
        expect(rects[2]).toContain("x=\"207.8\"");
    });

    it("steps the fill by stack height in one hue", () => {
        const html = ribbonChart(chart);
        expect(html).toContain("fill-opacity=\"0.40\""); // 2 of 5
        expect(html).toContain("fill-opacity=\"1.00\""); // 5 of 5
        expect(html).toContain("2/5 Stacks");
    });

    it("marks every death across the rows in the class colour with the cause in the title", () => {
        const html = ribbonChart(chart);
        expect(html).toContain("<g class=\"fc-death\" style=\"--cc:#69CCF0\">");
        expect(html).toContain("<title>1:00 Aldra († Shatter)</title>");
    });

    it("carries the row's headline value and tone at the right", () => {
        const html = ribbonChart(chart);
        expect(html).toContain("class=\"fc-value fc-good\"");
        expect(html).toContain(">100%</text>");
        expect(html).toContain("class=\"fc-value fc-high\"");
    });

    it("labels the axis in m:ss", () => {
        const html = ribbonChart(chart);
        expect(html).toContain(">0:00</text>");
        expect(html).toContain(">2:00</text>");
    });

    it("ships a table twin with uptime, gaps and first application", () => {
        const html = ribbonChart(chart);
        expect(html).toContain("<summary>Als Tabelle</summary>");
        expect(html).toContain("<tr><td>Faerie Fire</td><td>50%</td><td>2</td><td>0:10</td><td>0:50</td></tr>");
        expect(html).toContain("<tr><td>Sunder Armor</td><td>100%</td><td>0</td><td>0:00</td><td>–</td></tr>");
    });

    it("escapes labels and names", () => {
        const html = ribbonChart({
            duration: 1000,
            rows: [{ label: "<b>x</b>", bands: [[0, 500]] }],
            deaths: [{ at: 100, name: "\"Bob\"", type: "Priest" }],
        });
        expect(html).not.toContain("<b>x</b>");
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).toContain("&quot;Bob&quot;");
    });

    it("shortens a label that would run into the plot, keeping the full text in the title", () => {
        const html = ribbonChart({ duration: 1000, rows: [{ label: "Dorn · Strength of Earth Totem", icon: "x", bands: [[0, 500]] }] });
        expect(html).toContain("<title>Dorn · Strength of Earth Totem</title>Dorn · Strength of…</text>");
        const short = ribbonChart({ duration: 1000, rows: [{ label: "Windfury", bands: [[0, 500]] }] });
        expect(short).toContain(">Windfury</text>");
    });

    it("renders a placeholder, not an empty svg, without rows", () => {
        expect(ribbonChart({ duration: 1000, rows: [] })).toContain("fc-empty");
        expect(ribbonChart({ duration: 1000, rows: [] })).not.toContain("<svg");
    });

    it("skips malformed bands", () => {
        const html = ribbonChart({ duration: 1000, rows: [{ label: "x", bands: [null, [5, 5], [9, 3], "no", [0, 10]] }] });
        expect(html.match(/<rect class="fc-band[^>]*>/g)).toHaveLength(1);
    });
});

describe("web/charts — markerChart", () => {
    const chart = {
        duration: 60000,
        rows: [
            {
                label: "Windfury", icon: "spell_nature_windfury",
                markers: [{ at: 1000, label: "Windfury Totem" }, { at: 9000, icon: "spell_nature_invisibilitytotem", label: "Grace of Air" }, { at: NaN }],
                band: [[1000, 20000], [30000, 60000]],
                downtimes: [[20000, 30000]],
                value: "83%", tone: "medium",
            },
        ],
        windows: [{ label: "Bloodlust", from: 0, to: 40000 }],
        deaths: [{ at: 50000, name: "Zed", type: "Priest" }],
        classColor,
    };

    it("draws a marker per cast, as a dot or as the ability icon, each with a hit target", () => {
        const html = markerChart(chart);
        expect(html).toContain("<svg class=\"fchart fc-markers\"");
        expect(html.match(/<circle class="fc-marker"/g)).toHaveLength(1);
        expect(html.match(/<image class="fc-marker-icon"/g)).toHaveLength(1);
        expect(html.match(/class="fc-hit"/g).length).toBeGreaterThanOrEqual(3); // two marks + the death
        expect(html).toContain("<title>0:09 Grace of Air</title>");
    });

    it("draws the buff band, the downtime and the shaded window", () => {
        const html = markerChart(chart);
        expect(html.match(/fc-band fc-band-soft/g)).toHaveLength(2);
        expect(html).toContain("Lücke 0:20–0:30 (0:10)");
        expect(html).toContain("<rect class=\"fc-window\"");
        expect(html).toContain("Bloodlust: 0:00–0:40");
    });

    it("lists the cast times and gaps in the table twin", () => {
        const html = markerChart(chart);
        expect(html).toContain("<td>2</td><td>0:01, 0:09</td><td>0:20–0:30</td>");
    });

    it("renders a placeholder without rows", () => {
        expect(markerChart({ duration: 1, rows: [] })).toContain("fc-empty");
    });
});

describe("web/charts — barChart", () => {
    it("draws a bar per row with a rounded data end, value at the tip and optional link", () => {
        const html = barChart({
            title: "Tode pro Boss",
            rows: [{ label: "Gruul", value: 3, href: "#fight-3", tone: "high" }, { label: "Maulgar", value: 0, tone: "good" }],
            max: 3,
        });
        expect(html).toContain("<svg class=\"fchart fc-bars\"");
        expect(html.match(/<path class="fc-bar/g)).toHaveLength(1); // a zero draws no bar
        expect(html).toContain("a4,4 0 0 1 4,4");
        expect(html).toContain("<a href=\"#fight-3\">");
        expect(html).toContain(">3</text>");
        expect(html).toContain("<tr><td>Maulgar</td><td>0</td></tr>");
    });

    it("scales to 100 by default and clamps larger values", () => {
        const html = barChart({ rows: [{ label: "a", value: 250, display: "250%" }] });
        expect(html).toContain("h690.0"); // full plot width (694) minus the rounded end
        expect(html).toContain("250%");
    });

    it("renders a placeholder without rows", () => {
        expect(barChart({ rows: [] })).toContain("fc-empty");
    });
});

describe("web/charts — lineChart", () => {
    const chart = {
        duration: 20000,
        step: 5000,
        series: [
            { key: "a", label: "Raid-DPS", values: [1000, 2000, 1500, 500, 0] },
            { key: "b", label: "Raid-HPS", values: [200, 800, 900, 100, 0] },
        ],
        bossHp: [100, 80, 60, 40, 20],
        deaths: [{ at: 15000, name: "Aldra", type: "Mage" }],
        classColor,
    };

    it("draws a 2px line, a wash and an end marker per series on one axis", () => {
        const html = lineChart(chart);
        expect(html).toContain("<svg class=\"fchart fc-lines\"");
        expect(html.match(/<polyline class="fc-line"/g)).toHaveLength(2);
        expect(html.match(/<path class="fc-area"/g)).toHaveLength(2);
        expect(html.match(/<circle class="fc-end"/g)).toHaveLength(2);
        expect(html).toContain("class=\"fc-series fc-series-b\"");
        // the y ticks: 0, half and the shared maximum
        expect(html).toContain(">2000</text>");
        expect(html).toContain(">1000</text>");
    });

    it("draws the boss health as a faint reference line and names both in the legend", () => {
        const html = lineChart(chart);
        expect(html).toContain("<polyline class=\"fc-hp\"");
        expect(html).toContain("<div class=\"fc-legend\">");
        expect(html).toContain("Raid-DPS");
        expect(html).toContain("Boss-Leben");
    });

    it("tabulates every bucket", () => {
        const html = lineChart(chart);
        expect(html).toContain("<tr><td>0:05</td><td>2000</td><td>800</td><td>80%</td></tr>");
    });

    it("compacts thousands on the ticks", () => {
        const html = lineChart({ duration: 5000, step: 5000, series: [{ label: "x", values: [12000, 24000] }] });
        expect(html).toContain(">24.0k</text>");
    });

    it("renders a placeholder without a series", () => {
        expect(lineChart({ duration: 1, step: 1, series: [{ label: "x", values: [] }] })).toContain("fc-empty");
    });
});
