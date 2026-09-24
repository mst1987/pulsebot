// A hand-written setup without checks / options must not crash the setup editor (client side).
const { loadTs, makeT } = require("./i18nHelper");

const lib = loadTs("lib/setupEditor.ts", { t: makeT("de") });
const bare = { status: "draft", version: 1, groups: [{ index: 1, slots: [{ userId: "1", character: "A", spec: "x", role: "tank" }] }], bench: [] };

describe("withSetupDefaults", () => {
    it("fills checks, options, warnings and the rest", () => {
        const s = lib.withSetupDefaults(bare);
        expect(s.checks.buffs.required).toEqual([]);
        expect(s.checks.buffs.party).toEqual([]);
        expect(s.checks.size.count).toBe(1);
        expect(s.checks.ok).toBe(false);
        expect(s.warnings).toEqual([]);
        expect(s.options.weights).toEqual({});
    });

    it("keeps what is there and copes with no groups or bench", () => {
        const s = lib.withSetupDefaults({ ...bare, checks: { ok: true, buffs: { ok: true, required: [{ key: "k" }] } }, bench: undefined, groups: [{ index: 2 }] });
        expect(s.checks.ok).toBe(true);
        expect(s.checks.buffs.required).toHaveLength(1);
        expect(s.bench).toEqual([]);
        expect(s.groups[0].slots).toEqual([]);
    });
});
