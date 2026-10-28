// The app's own icon set (#951): every key is drawable, the three kinds never
// share a key, and the menu and the settings sections only name keys of it.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_ICONS, UI_GLYPHS, UI_LINE_ICONS, isBrandIcon, isUiGlyph, isUiIcon, isUiLineIcon } from "./iconSet";
import { MENU } from "../app/menu";
import { SETTINGS_SECTIONS } from "../settings/settingsSections";

const PATH_DATA = /^[MmLlCcHhVvZzAaSsQqTt0-9 ,.-]+$/;

describe("icon set", () => {
    it("gives every glyph one of the four tones and a path", () => {
        for (const [name, g] of Object.entries(UI_GLYPHS)) {
            expect({ name, tone: ["blood", "bronze", "arcane", "fel"].includes(g.tone), d: g.d.length > 20 && PATH_DATA.test(g.d) })
                .toEqual({ name, tone: true, d: true });
        }
    });

    it("gives every line icon at least one stroke path", () => {
        for (const [name, paths] of Object.entries(UI_LINE_ICONS)) {
            expect({ name, ok: paths.length > 0 && paths.every((d) => PATH_DATA.test(d)) }).toEqual({ name, ok: true });
        }
    });

    it("keeps glyphs, line icons and brands apart and every brand image in public/brands", () => {
        const glyphs = Object.keys(UI_GLYPHS);
        const lines = Object.keys(UI_LINE_ICONS);
        const brands = Object.keys(BRAND_ICONS);
        const all = [...glyphs, ...lines, ...brands];
        expect(new Set(all).size).toBe(all.length);
        for (const [name, src] of Object.entries(BRAND_ICONS)) {
            if (!src) continue; // Discord is drawn inline
            expect({ name, file: existsSync(path.join(__dirname, "../../../public", src)) }).toEqual({ name, file: true });
        }
        expect(isUiGlyph("raids") && isUiLineIcon("edit") && isBrandIcon("warcraftLogs")).toBe(true);
    });

    it("tells keys of the set from zamimg names", () => {
        expect(isUiIcon("settings")).toBe(true);
        expect(isUiIcon("discord")).toBe(true);
        expect(isUiIcon("inv_misc_bag_10")).toBe(false);
        expect(isUiIcon("toString")).toBe(false);
    });

    it("draws every menu entry with a key of the set", () => {
        for (const e of MENU) expect({ id: e.id, ok: isUiIcon(e.icon) }).toEqual({ id: e.id, ok: true });
    });

    it("draws every settings section with a key of the set", () => {
        for (const s of SETTINGS_SECTIONS) expect({ id: s.id, ok: isUiIcon(s.icon) }).toEqual({ id: s.id, ok: true });
    });
});
