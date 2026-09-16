const { raidSteps, roleSummary, firstOpenAnalysis } = require("../../src/web/raidDetailSteps");

function base(overrides = {}) {
    return {
        event: { id: "ev1", title: "Black Temple", startTime: 1, signupCount: 0, isPast: false, signupsKnown: true },
        setup: null,
        setupError: null,
        setupFromSnapshot: false,
        raidsheets: [{ id: "s1" }],
        eventSheet: null,
        sheetLink: null,
        eventSoftres: null,
        attendance: { responded: [], missing: [] },
        signupTarget: 25,
        lootItems: [],
        eventLogs: [],
        ...overrides,
    };
}

const step = (res, key) => res.steps.find((s) => s.key === key);

describe("raidSteps", () => {
    it("lists the six steps in order", () => {
        expect(raidSteps(base()).steps.map((s) => s.key)).toEqual(["signup", "setup", "sheet", "softres", "loot", "logs"]);
    });

    it("marks the signup step of a cancelled event and of a closed signup (#288)", () => {
        const own = { ...base().event, id: "eh-1", source: "eventhelper", signupCount: 4 };
        const cancelled = step(raidSteps(base({ event: { ...own, status: "cancelled", cancelReason: "Zu wenig Heiler" } })), "signup");
        expect(cancelled).toMatchObject({ tone: "bad", badge: { label: "abgesagt", tone: "bad" }, tip: { sub: "Grund: Zu wenig Heiler" } });
        const res = raidSteps(base({ event: { ...own, status: "cancelled" } }));
        expect(res).toMatchObject({ next: "", primary: null });
        expect(res.steps.some((s) => s.next)).toBe(false);
        const closed = step(raidSteps(base({ event: { ...own, signupsClosed: true } })), "signup");
        expect(closed).toMatchObject({ tone: "mid", badge: { label: "geschlossen" }, value: "4" });
    });

    it("offers the Raid-Helper raidplan only for a Raid-Helper event", () => {
        const signedUp = { ...base().event, signupCount: 10 };
        const rh = raidSteps(base({ event: signedUp }));
        expect(rh.primary).toMatchObject({ href: "https://raid-helper.xyz/raidplan/ev1" });
        const own = raidSteps(base({ event: { ...signedUp, id: "eh-1", source: "eventhelper" } }));
        // no Raid-Helper raidplan: the way leads into the own setup editor
        expect(own.next).toBe("setup");
        expect(own.primary).toMatchObject({ tab: "setup", label: "Setup vorschlagen" });
        expect(own.primary.href).toBeUndefined();
        expect(step(own, "setup").tip.sub).toMatch(/EventHelper/);
        expect(step(own, "setup").open).toEqual({ tab: "setup" });
    });

    describe("setup step of an own event (#263)", () => {
        const own = (ownSetup) => raidSteps(base({
            event: { ...base().event, signupCount: 20, id: "eh-1", source: "eventhelper" },
            ownSetup,
        }));

        it("is open while only a draft exists, and the primary action is the approval", () => {
            const res = own({ status: "draft", placed: 25, size: 25, changedSinceApproval: false });
            expect(step(res, "setup")).toMatchObject({ done: false, value: "25", unit: "/ 25", badge: { label: "Entwurf", tone: "mid" } });
            expect(res.primary).toMatchObject({ label: "Setup freigeben", tab: "setup" });
        });

        it("says when a draft changed an earlier approval", () => {
            const res = own({ status: "draft", placed: 24, size: 25, changedSinceApproval: true });
            expect(step(res, "setup").badge.label).toBe("geändert seit Freigabe");
            expect(step(res, "setup").done).toBe(false);
        });

        it("is done only once approved, and the way leads on to the sheet", () => {
            const res = own({ status: "approved", placed: 25, size: 25 });
            expect(step(res, "setup")).toMatchObject({ done: true, tone: "ok", badge: { label: "freigegeben" } });
            expect(res.next).toBe("sheet");
        });
    });

    it("points an empty upcoming raid at the signup call", () => {
        const res = raidSteps(base());
        expect(res.next).toBe("signup");
        expect(step(res, "signup").next).toBe(true);
        expect(res.primary).toMatchObject({ label: "Anmelde-Aufruf posten", modal: "notify" });
    });

    it("walks through setup and sheet to softres before the raid", () => {
        const ev = { ...base().event, signupCount: 23 };
        const setup = { total: 25, groups: [], roleCounts: { tank: 3, healer: 6, melee: 6, ranged: 10 } };
        expect(raidSteps(base({ event: ev })).next).toBe("setup");
        expect(raidSteps(base({ event: ev, setup })).next).toBe("sheet");
        const res = raidSteps(base({
            event: ev, setup,
            eventSheet: { url: "u", postedChannelId: "c", postedMessageId: "m" },
            sheetLink: { url: "u", name: "", source: "event" },
        }));
        expect(res.next).toBe("softres");
        expect(res.primary).toMatchObject({ label: "Softres erstellen", modal: "softres" });
        expect(step(res, "setup").badge).toEqual({ label: "3 T · 6 H · 16 DD", tone: "ok" });
        expect(step(res, "sheet")).toMatchObject({ value: "Gefüllt", badge: { label: "gepostet", tone: "ok" } });
        expect(step(res, "signup")).toMatchObject({ value: "23", unit: "/ 25" });
        expect(step(res, "signup").fill).toBeCloseTo(0.92);
    });

    it("counts the category's fixed sheet as a sheet", () => {
        const res = raidSteps(base({ sheetLink: { url: "u", name: "T6", source: "category" } }));
        expect(step(res, "sheet")).toMatchObject({ done: true, value: "Festes Sheet", badge: { label: "nicht gepostet", tone: "mid" } });
        expect(step(res, "sheet").tip.sub).toContain("T6");
    });

    it("says when a past raid's sheet copy is deleted", () => {
        const deleteAfter = Date.UTC(2026, 8, 17, 12);
        const res = raidSteps(base({
            event: { ...base().event, isPast: true, signupCount: 25 },
            eventSheet: { url: "u", deleteAfter, postedChannelId: "c", postedMessageId: "m" },
            sheetLink: { url: "u", name: "", source: "event" },
        }));
        expect(step(res, "sheet").badge.label).toBe("löscht am 17.09.");
    });

    it("only offers loot and logs once the raid has started", () => {
        const res = raidSteps(base({ event: { ...base().event, isPast: true } }));
        expect(res.next).toBe("loot");
        expect(step(res, "softres").next).toBe(false);
        expect(step(res, "loot").badge).toEqual({ label: "fehlt", tone: "mid" });
        expect(res.primary).toMatchObject({ modal: "loot" });
    });

    it("keeps loot and logs neutral before the raid", () => {
        const res = raidSteps(base());
        expect(step(res, "loot")).toMatchObject({ tone: "none", badge: { label: "nach dem Raid" } });
        expect(step(res, "logs")).toMatchObject({ tone: "none", badge: { label: "nach dem Raid" } });
    });

    it("turns a missing analysis into the primary action", () => {
        const res = raidSteps(base({
            event: { ...base().event, isPast: true },
            lootItems: [{ source: "gargul", character: "A" }, { source: "gargul", character: "B" }, { source: "rclc", character: "A" }],
            eventLogs: [{ id: "log1", sections: ["cla"] }],
        }));
        expect(step(res, "loot")).toMatchObject({ value: "3", unit: "Items", badge: { label: "Gargul", tone: "ok" } });
        expect(step(res, "loot").tip.head).toBe("Loot · 3 Items an 2 Raider");
        expect(res.next).toBe("logs");
        expect(step(res, "logs").badge).toEqual({ label: "RPB offen", tone: "mid" });
        expect(res.primary).toMatchObject({ label: "RPB auswerten", evaluate: { logId: "log1", section: "rpb" } });
    });

    it("has no next step once a past raid is fully evaluated", () => {
        const res = raidSteps(base({
            event: { ...base().event, isPast: true },
            lootItems: [{ source: "rclc", character: "A" }],
            eventLogs: [{ id: "log1", sections: ["cla", "rpb"] }],
        }));
        expect(res.next).toBe("");
        expect(res.primary).toBeNull();
        expect(step(res, "logs").badge).toEqual({ label: "ausgewertet", tone: "ok" });
    });

    it("never reports an unknown roster as zero signups", () => {
        const res = raidSteps(base({ event: { ...base().event, isPast: true, signupsKnown: false } }));
        expect(step(res, "signup")).toMatchObject({ value: "—", unit: "", fill: null, badge: { label: "unbekannt" } });
    });

    it("calls a saved roster the raid day's state only once the raid is over", () => {
        const setup = { total: 5, groups: [], roleCounts: { tank: 1 } };
        const upcoming = raidSteps(base({ event: { ...base().event, signupCount: 5, signUpsFromSnapshot: true }, setup, setupFromSnapshot: true }));
        expect(step(upcoming, "signup").badge.label).toBe("gespeicherter Stand");
        expect(step(upcoming, "setup").badge.label).toBe("gespeicherter Stand");
        const past = raidSteps(base({ event: { ...base().event, isPast: true, signupCount: 5, signUpsFromSnapshot: true }, setup, setupFromSnapshot: true }));
        expect(step(past, "signup").badge.label).toBe("Stand vom Raidtag");
        expect(step(past, "setup").badge.label).toBe("Stand vom Raidtag");
    });

    it("counts raiders without a reaction before the raid", () => {
        const res = raidSteps(base({
            event: { ...base().event, signupCount: 20 },
            attendance: { responded: [], missing: [{ id: "1" }, { id: "2" }, { id: "3" }] },
        }));
        expect(step(res, "signup")).toMatchObject({ tone: "mid", badge: { label: "3 ohne Reaktion", tone: "mid" } });
    });

    it("marks a failed raidplan load as an error, not as no plan", () => {
        const res = raidSteps(base({ setupError: "Timeout" }));
        expect(step(res, "setup")).toMatchObject({ tone: "bad", badge: { label: "Fehler", tone: "bad" } });
        expect(step(res, "setup").tip.sub).toBe("Timeout");
    });

    it("shows a softres list's amount and whether it was posted", () => {
        const res = raidSteps(base({ eventSoftres: { url: "u", editUrl: "e", instances: ["bt"], amount: 2, hardReserveCount: 1 } }));
        expect(step(res, "softres")).toMatchObject({ value: "2", unit: "/ Spieler", badge: { label: "nicht gepostet", tone: "mid" }, done: true });
    });
});

describe("helpers", () => {
    it("sums melee, ranged and unknown dps into DD", () => {
        expect(roleSummary({ tank: 2, healer: 5, melee: 4, ranged: 8, dps: 1 })).toBe("2 T · 5 H · 13 DD");
        expect(roleSummary()).toBe("0 T · 0 H · 0 DD");
    });

    it("finds CLA before RPB and the first log first", () => {
        const logs = [{ id: "a", sections: ["cla", "rpb"] }, { id: "b", sections: [] }];
        expect(firstOpenAnalysis(logs)).toEqual({ log: logs[1], section: "cla" });
        expect(firstOpenAnalysis([])).toBeNull();
    });
});
