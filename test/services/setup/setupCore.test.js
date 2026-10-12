// Where a setup stands (services/setup/setupCore.js setupSummary/setupPhase): the
// one reading the raid detail's Freigabe step and the Orga-Zentrale share.
const { setupSummary, setupPhase } = require("../../../src/services/setup/setupCore");

const setup = (over = {}) => ({
    status: "draft", version: 2, changedSinceApproval: false,
    groups: [{ index: 1, slots: [{ userId: "a" }, { userId: "b" }] }, { index: 2, slots: [{ userId: "c" }] }],
    bench: [{ userId: "d" }], pool: [{ userId: "e" }, { userId: "f" }],
    checks: { ok: true },
    ...over,
});

describe("services/setup/setupCore setupSummary", () => {
    it("counts the placed, the bench and the pool", () => {
        expect(setupSummary({ size: 25, setup: setup({ approvedAt: 7 }) })).toEqual({
            status: "draft", changedSinceApproval: false, version: 2, placed: 3, size: 25, bench: 1, pool: 2, ok: true, approvedAt: 7,
        });
    });

    it("reads an approval and its time from the snapshot", () => {
        const s = setupSummary({ setup: setup({ status: "approved", checks: null, approved: { approvedAt: 9 } }) });
        expect(s).toMatchObject({ status: "approved", size: 0, ok: false, approvedAt: 9 });
    });

    it("is null without a setup", () => {
        expect(setupSummary({})).toBeNull();
        expect(setupSummary(null)).toBeNull();
    });
});

describe("services/setup/setupCore setupPhase", () => {
    const summary = (over) => ({ placed: 3, status: "draft", changedSinceApproval: false, version: 2, ...over });

    it("is none without anybody placed", () => {
        expect(setupPhase(null)).toBe("none");
        expect(setupPhase(summary({ placed: 0 }))).toBe("none");
    });

    it("tells draft, changed and approved apart", () => {
        expect(setupPhase(summary())).toBe("draft");
        expect(setupPhase(summary({ changedSinceApproval: true }))).toBe("changed");
        expect(setupPhase(summary({ status: "approved" }), null)).toBe("approved");
        expect(setupPhase(summary({ status: "approved" }), { channelId: "c" })).toBe("approved");
    });

    it("tells a posted setup from one whose message shows an older state", () => {
        expect(setupPhase(summary({ status: "approved" }), { messageId: "m", version: 2 })).toBe("posted");
        expect(setupPhase(summary({ status: "approved" }), { messageId: "m", version: 1 })).toBe("outdated");
    });
});
