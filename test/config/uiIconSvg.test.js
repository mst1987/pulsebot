// The app's own icon set (#951) on the server side: the generated glyph and
// line-icon data, the inline SVG the admin chrome draws from it, and that the
// client's twin (lib/ui/iconSet.ts) draws Discord with the same path.
const fs = require("fs");
const path = require("path");
const { uiIconSvg, isUiIcon, UI_ICONS, UI_LINE_ICONS, BRAND_FILES, DISCORD_PATH, GLYPH_VIEWBOX } = require("../../src/config/uiIconSvg");

const CLIENT = path.join(__dirname, "../../src/web-client");
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

describe("uiIconSvg", () => {
    it("has a valid path and one of the four tones for every glyph", () => {
        expect(Object.keys(UI_ICONS).length).toBeGreaterThan(0);
        for (const [name, glyph] of Object.entries(UI_ICONS)) {
            expect({ name, tone: glyph.tone }).toEqual({ name, tone: expect.stringMatching(/^(blood|bronze|arcane|fel)$/) });
            expect({ name, ok: PATH_RE.test(glyph.d) && /^M/.test(glyph.d) }).toEqual({ name, ok: true });
        }
    });

    it("has only stroke paths and no tone for every line icon", () => {
        expect(Object.keys(UI_LINE_ICONS).length).toBeGreaterThan(0);
        for (const [name, paths] of Object.entries(UI_LINE_ICONS)) {
            expect(Array.isArray(paths) && paths.length > 0).toBe(true);
            for (const d of paths) expect({ name, ok: PATH_RE.test(d) && /^[Mm]/.test(d) }).toEqual({ name, ok: true });
        }
    });

    it("keeps glyphs, line icons and brands apart (one key, one kind)", () => {
        const glyphs = Object.keys(UI_ICONS);
        const lines = Object.keys(UI_LINE_ICONS);
        const brands = ["discord", ...Object.keys(BRAND_FILES)];
        const all = [...glyphs, ...lines, ...brands];
        expect(new Set(all).size).toBe(all.length);
    });

    it("draws a glyph filled in its tone, decorative", () => {
        const name = Object.keys(UI_ICONS)[0];
        const html = uiIconSvg(name, 20);
        expect(html).toContain(`class="wi uic uic-${UI_ICONS[name].tone}"`);
        expect(html).toContain("width=\"20\" height=\"20\"");
        expect(html).toContain("aria-hidden=\"true\"");
        expect(html).toContain("fill-rule=\"evenodd\"");
        expect(html).toContain(`d="${UI_ICONS[name].d}"`);
    });

    it("draws a line icon stroked in currentColor, one path per stroke", () => {
        const html = uiIconSvg("edit");
        expect(html).toContain("class=\"wi uic uic-line\"");
        expect(html).toContain("fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"");
        expect((html.match(/<path /g) || []).length).toBe(UI_LINE_ICONS.edit.length);
    });

    it("draws Discord as its mark in Blurple and the other brands as their image", () => {
        expect(uiIconSvg("discord")).toContain("uic-discord");
        expect(uiIconSvg("discord")).toContain(DISCORD_PATH);
        expect(uiIconSvg("raidHelper")).toBe("<img class=\"wi uic uic-brand uic-raidHelper\" src=\"/brands/raid-helper.png\" width=\"24\" height=\"24\" alt=\"\">");
        for (const file of Object.values(BRAND_FILES)) {
            expect(fs.existsSync(path.join(CLIENT, "public", file))).toBe(true);
        }
    });

    it("knows its keys and gives nothing for an unknown one", () => {
        expect(isUiIcon("settings")).toBe(true);
        expect(isUiIcon("search")).toBe(true);
        expect(isUiIcon("discord")).toBe(true);
        expect(isUiIcon("inv_misc_bag_10")).toBe(false);
        expect(isUiIcon("toString")).toBe(false);
        expect(uiIconSvg("inv_misc_bag_10")).toBe("");
    });

    it("draws Discord with the same path as the client's icon set", () => {
        const src = fs.readFileSync(path.join(CLIENT, "src/lib/ui/iconSet.ts"), "utf8");
        const m = src.match(/export const DISCORD_PATH = "([^"]+)"/);
        expect(m && m[1]).toBe(DISCORD_PATH);
    });

    it("draws the filled marks a bit smaller than their box, like the client, and line icons full size", () => {
        const src = fs.readFileSync(path.join(CLIENT, "src/lib/ui/iconSet.ts"), "utf8");
        const m = src.match(/export const GLYPH_VIEWBOX = "([^"]+)"/);
        expect(m && m[1]).toBe(GLYPH_VIEWBOX);
        expect(uiIconSvg(Object.keys(UI_ICONS)[0])).toContain(`viewBox="${GLYPH_VIEWBOX}"`);
        expect(uiIconSvg("discord")).toContain(`viewBox="${GLYPH_VIEWBOX}"`);
        expect(uiIconSvg("edit")).toContain("viewBox=\"0 0 24 24\"");
    });
});
