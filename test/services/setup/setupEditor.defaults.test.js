// A setup written by hand (or by an older version) may lack checks, options, weights ...
// The editor's view fills neutral defaults so the page never meets an undefined.
const { editorView, _internal: { withSetupDefaults } } = require("../../../src/services/setup/setupEditor");

describe("editorView with a setup that lacks checks / options", () => {
    it("answers a complete setup", () => {
        const event = {
            id: "e1", size: 25, title: "T", startTime: 1, versionId: "tbc",
            setup: { status: "draft", version: 1, groups: [{ index: 1, slots: [{ userId: "1", character: "A", spec: "x", role: "tank" }] }], bench: [{ userId: "2" }] },
        };
        const v = editorView(event, { canWrite: true });
        expect(v.setup.checks.buffs.party).toEqual([]);
        expect(v.setup.checks.size).toEqual({ count: 1, size: 25, ok: false });
        expect(v.setup.options).toEqual({ weights: {}, fairness: null, wishes: null });
        expect(v.setup.warnings).toEqual([]);
    });

    it("keeps a full setup as it is", () => {
        const full = {
            checks: { ok: true, size: { count: 1, size: 5, ok: true }, roles: {}, buffs: { ok: true, required: [], raid: [], party: [] }, wishes: { met: 1, total: 2 } },
            groups: [], bench: [], options: { weights: { a: 1 }, fairness: true, wishes: false },
        };
        const s = withSetupDefaults(full, 5);
        expect(s.checks.wishes).toEqual({ met: 1, total: 2 });
        expect(s.options.weights).toEqual({ a: 1 });
    });

    it("copes with nothing at all", () => {
        expect(withSetupDefaults(null)).toBeNull();
        const s = withSetupDefaults({}, 10);
        expect(s.groups).toEqual([]);
        expect(s.checks.size).toEqual({ count: 0, size: 10, ok: false });
    });
});
