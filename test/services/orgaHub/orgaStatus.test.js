// The status model of the Orga-Zentrale (services/orgaHub/orgaStatus.js): where
// an own raid stands, derived from the stored event and its signups.
const { orgaStatus, statusCounts, cancelledAfterApproval, STATUSES, LABELS } = require("../../../src/services/orgaHub/orgaStatus");

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 24 * 3600;
const sec = (ms) => Math.floor(ms / 1000);

const signed = (userId, status = "signed") => ({ userId, status });
const slots = (...ids) => ids.map((userId) => ({ userId, character: userId }));

/** An event with a setup of `placed` user ids; `approved` freezes them as the approval. */
function event({ start = sec(NOW) + 10 * DAY, deadline = 0, closed = false, size = 25, placed = [], status = "draft", changed = false,
    approved = null, version = 1, post = null, cancelled = false, reason = "" } = {}) {
    return {
        id: "eh-1",
        status: cancelled ? "cancelled" : "active",
        cancel: cancelled ? { reason } : null,
        startTime: start,
        signupDeadline: deadline,
        signupsClosed: closed,
        size,
        setup: placed.length || approved ? {
            status, version, changedSinceApproval: changed,
            groups: [{ index: 1, slots: slots(...placed) }],
            bench: [], pool: [],
            approved: approved ? { groups: [{ index: 1, slots: slots(...approved) }] } : null,
        } : null,
        setupPost: post,
    };
}

describe("services/orgaHub/orgaStatus", () => {
    describe("nobody placed", () => {
        it("is the running signup while the deadline is ahead and the raid more than 3 days away", () => {
            const deadline = sec(Date.UTC(2026, 9, 27, 18, 0, 0));
            const st = orgaStatus(event({ deadline }), [signed("a"), signed("b"), signed("c", "absence")], { now: NOW });
            expect(st).toMatchObject({ status: "signup", label: "Anmeldung läuft", link: { label: "Raid", tab: "" } });
            expect(st.detail).toBe("2 Anmeldungen · Anmeldeschluss 27.10.");
        });

        it("names only the count without a deadline, in the singular for one", () => {
            expect(orgaStatus(event(), [signed("a")], { now: NOW }).detail).toBe("1 Anmeldung");
        });

        it("is an open setup once the deadline passed", () => {
            const st = orgaStatus(event({ deadline: sec(NOW) - 60 }), [signed("a")], { now: NOW });
            expect(st).toMatchObject({ status: "open", label: "Setup offen", detail: "1 Anmeldung · noch niemand im Setup", link: { label: "Setup bauen", tab: "setup" } });
        });

        it("is an open setup when the signup is closed or the raid is under 3 days away", () => {
            expect(orgaStatus(event({ closed: true }), [], { now: NOW }).status).toBe("open");
            expect(orgaStatus(event({ start: sec(NOW) + 2 * DAY }), [], { now: NOW }).status).toBe("open");
        });

        it("reads an empty setup as nobody placed", () => {
            expect(orgaStatus(event({ placed: [], status: "draft" }), [], { now: NOW }).status).toBe("signup");
        });
    });

    it("is a setup in the works while placed and not approved", () => {
        const st = orgaStatus(event({ placed: ["a", "b"] }), [signed("a"), signed("b"), signed("c")], { now: NOW });
        expect(st).toMatchObject({ status: "draft", label: "Setup in Arbeit", detail: "3 Anmeldungen · 2 von 25 im Setup", link: { label: "Setup" } });
    });

    it("leaves the size out for a raid without one", () => {
        expect(orgaStatus(event({ size: 0, placed: ["a"] }), [], { now: NOW }).detail).toBe("0 Anmeldungen · 1 im Setup");
    });

    it("is approved but not posted", () => {
        const st = orgaStatus(event({ placed: ["a", "b"], status: "approved", approved: ["a", "b"] }), [], { now: NOW });
        expect(st).toMatchObject({ status: "approved", label: "Freigegeben", detail: "2 von 25 im Setup · nicht gepostet", link: { label: "Setup posten" } });
    });

    it("is approved again when the message shows an older state", () => {
        const st = orgaStatus(event({ placed: ["a"], status: "approved", approved: ["a"], version: 3, post: { messageId: "m", version: 2 } }), [], { now: NOW });
        expect(st).toMatchObject({ status: "approved", detail: "Stand 3 nicht gepostet" });
    });

    it("is posted with the confirmations of the posted lineup", () => {
        const post = { messageId: "m", version: 1, confirmations: { a: { status: "confirmed" }, b: { status: "confirmed" }, x: { status: "confirmed" } } };
        const st = orgaStatus(event({ placed: ["a", "b", "c"], status: "approved", approved: ["a", "b", "c"], post }), [], { now: NOW });
        expect(st).toMatchObject({ status: "posted", label: "Gepostet", detail: "2 von 3 bestätigt", link: { label: "Setup", tab: "setup" } });
    });

    describe("changed since the approval", () => {
        it("when the draft differs from the approval", () => {
            const st = orgaStatus(event({ placed: ["a"], status: "draft", changed: true, approved: ["b"] }), [], { now: NOW });
            expect(st).toMatchObject({ status: "changed", label: "Geändert seit Freigabe", detail: "Änderung nicht gepostet", link: { label: "Setup prüfen" } });
        });

        it("when placed raiders signed off or declined after the approval", () => {
            const post = { messageId: "m", version: 1, confirmations: { b: { status: "declined" }, a: { status: "confirmed" } } };
            const ev = event({ placed: ["a", "b", "c"], status: "approved", approved: ["a", "b", "c"], post });
            const st = orgaStatus(ev, [signed("a"), signed("c", "absence"), signed("z", "absence")], { now: NOW });
            expect(st).toMatchObject({ status: "changed", detail: "2 Absagen nach der Freigabe" });
        });

        it("names both", () => {
            const ev = event({ placed: ["a"], status: "draft", changed: true, approved: ["a", "c"] });
            expect(orgaStatus(ev, [signed("c", "absence")], { now: NOW }).detail).toBe("Änderung nicht gepostet · 1 Absage nach der Freigabe");
        });
    });

    it("is cancelled with its reason and without a link", () => {
        const st = orgaStatus(event({ cancelled: true, reason: "Zu wenige", placed: ["a"] }), [], { now: NOW });
        expect(st).toEqual({ status: "cancelled", label: "Abgesagt", detail: "Zu wenige", link: null });
        expect(orgaStatus(event({ cancelled: true }), [], { now: NOW }).detail).toBe("");
    });

    it("counts nobody as cancelled without an approval", () => {
        expect(cancelledAfterApproval(event({ placed: ["a"] }), [signed("a", "absence")])).toBe(0);
        expect(cancelledAfterApproval(null, [])).toBe(0);
    });

    it("tolerates a missing event and signups", () => {
        expect(orgaStatus(null, undefined, { now: NOW }).status).toBe("open");
    });

    it("has a label for every status", () => {
        for (const s of STATUSES) expect(LABELS[s]).toBeTruthy();
    });

    it("counts by status in the summary's order, only the non-zero ones", () => {
        expect(statusCounts(["posted", "open", "draft", "open", "changed", "cancelled"])).toEqual([
            { status: "open", count: 2, label: "2 Setups offen" },
            { status: "changed", count: 1, label: "1 geändert" },
            { status: "draft", count: 1, label: "1 in Arbeit" },
            { status: "posted", count: 1, label: "1 gepostet" },
            { status: "cancelled", count: 1, label: "1 abgesagt" },
        ]);
        expect(statusCounts([])).toEqual([]);
        expect(statusCounts(undefined)).toEqual([]);
        expect(statusCounts(["signup"])[0].label).toBe("1 Anmeldung läuft");
    });
});
