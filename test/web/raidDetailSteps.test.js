const {
    raidSteps, roleSummary, firstOpenAnalysis, eventSteps, STEP_IDS, STEP_STATES,
} = require("../../src/web/raidDetailSteps");

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

    it("drops the softres step when the loot system has no softres list", () => {
        const lc = { system: "lootcouncil", softres: false };
        expect(raidSteps(base({ lootSystem: lc })).steps.map((s) => s.key)).toEqual(["signup", "setup", "sheet", "loot", "logs"]);
        expect(raidSteps(base({ lootSystem: { system: "lootcouncil", softres: true } })).steps.map((s) => s.key)).toContain("softres");
        // with signup, setup and sheet done there is nothing left before the raid — no nudge to "Softres erstellen"
        const res = raidSteps(base({
            lootSystem: lc,
            event: { ...base().event, signupCount: 23 },
            setup: { total: 25, groups: [], roleCounts: {} },
            sheetLink: { url: "u", name: "", source: "event" },
        }));
        expect(res.next).toBe("");
        expect(res.primary).toBeNull();
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

// ---------------------------------------------------------------------------
// Das Raid-Cockpit (#319)
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const inHours = (h) => Math.floor((NOW + h * HOUR) / 1000);

/** Ein eigenes Event, wie das Detail-Payload es hinlegt. */
function own(overrides = {}) {
    const { event, ...rest } = overrides;
    return {
        event: {
            id: "eh-1", source: "eventhelper", title: "SSC + TK", channelName: "mi-23-09-ssc-tk",
            startTime: inHours(48), size: 25, signupDeadline: inHours(24),
            signupCount: 0, isPast: false, signupsKnown: true, status: "active",
            signupsClosed: false, autoSuggest: false,
            ...(event || {}),
        },
        ownSignups: [],
        ownSetup: null,
        ownSetupPost: null,
        attendance: { responded: [], missing: [] },
        signupTarget: 25,
        lootItems: [],
        eventLogs: [],
        ...rest,
    };
}

const run = (d) => eventSteps(d, { now: NOW });
const at = (res, id) => res.steps.find((s) => s.id === id);
const signed = (n) => Array.from({ length: n }, () => ({ status: "signed" }));

describe("eventSteps — das Raid-Cockpit (#319)", () => {
    it("ist immer dieselbe Strecke aus fünf Schritten", () => {
        expect(run(own()).steps.map((s) => s.id)).toEqual(STEP_IDS);
        expect(STEP_IDS).toEqual(["created", "signup", "setup", "approval", "after"]);
        expect(run(own()).steps.map((s) => s.label)).toEqual(["Angelegt", "Anmeldung", "Setup", "Freigabe", "Nachbereitung"]);
        // jeder Zustand ist einer der fünf, und jeder Schritt erklärt sich
        for (const s of run(own()).steps) {
            expect(STEP_STATES).toContain(s.state);
            expect(s.hint.length).toBeGreaterThan(10);
        }
    });

    it("frisch angelegt: „Angelegt“ ist erledigt, die Anmeldung ist dran", () => {
        const res = run(own());
        expect(at(res, "created")).toMatchObject({ state: "done", value: "#mi-23-09-ssc-tk" });
        expect(at(res, "created").action).toMatchObject({ manage: "edit", label: "Bearbeiten" });
        expect(res.current).toBe("signup");
        // ohne eine einzige Anmeldung ist der Aufruf die Tat, nicht der Ping
        expect(res.action).toMatchObject({ modal: "notify", label: "Anmelde-Aufruf posten" });
        expect(at(res, "signup")).toMatchObject({ state: "current", value: "0", unit: "/ 25" });
        // nur ein Schritt ist offen; die späteren sind „später“, nicht „offen“
        expect(res.steps.filter((s) => s.state === "current").map((s) => s.id)).toEqual(["signup"]);
        expect(at(res, "after").state).toBe("todo");
    });

    it("zählt Plätze wie rosterCounts: „Dabei“ und „Spät“, die Bank ist Warteliste", () => {
        const res = run(own({
            ownSignups: [...signed(3), { status: "late" }, { status: "bench" }, { status: "bench" }, { status: "tentative" }, { status: "absence" }],
        }));
        const step = at(res, "signup");
        expect(step.value).toBe("4");
        expect(step.unit).toBe("/ 25");
        expect(step.note).toBe("2 auf der Warteliste · 1× vielleicht");
        expect(step.fill).toBeCloseTo(4 / 25);
    });

    it("pingt die Fehlenden, sobald jemand angemeldet ist", () => {
        const res = run(own({ ownSignups: signed(12), attendance: { responded: [], missing: [{}, {}, {}] } }));
        expect(res.action).toMatchObject({ modal: "ping", label: "Fehlende pingen" });
        expect(at(res, "signup").hint).toMatch(/^3 Raider haben mit Raider-Rolle noch nicht reagiert/);
    });

    it("bietet das Schließen an, wenn alle reagiert haben", () => {
        const res = run(own({ ownSignups: signed(20) }));
        expect(res.action).toMatchObject({ manage: "signups", label: "Anmeldung schließen" });
    });

    it("ist mit der Anmeldung fertig, wenn sie geschlossen ist oder der Schluss vorbei", () => {
        const closed = run(own({ event: { signupsClosed: true }, ownSignups: signed(18) }));
        expect(at(closed, "signup")).toMatchObject({ state: "done", value: "18", action: null });
        expect(closed.current).toBe("setup");

        const passed = run(own({ event: { signupDeadline: inHours(-2), startTime: inHours(3) }, ownSignups: signed(18) }));
        expect(at(passed, "signup").state).toBe("done");
        expect(at(passed, "signup").hint).toMatch(/Anmeldeschluss/);
    });

    it("Setup: kein Vorschlag → offen, ein Entwurf → erledigt", () => {
        const open = run(own({ event: { signupsClosed: true } }));
        expect(at(open, "setup")).toMatchObject({ state: "current", value: "—" });
        expect(open.action).toMatchObject({ tab: "setup", label: "Setup vorschlagen" });

        const draft = run(own({ event: { signupsClosed: true }, ownSetup: { status: "draft", placed: 24, size: 25, bench: 3, version: 2, ok: true } }));
        expect(at(draft, "setup")).toMatchObject({ state: "done", value: "24", unit: "/ 25", note: "3 auf der Bank" });
        expect(at(draft, "setup").action).toMatchObject({ tab: "setup", label: "Setup öffnen" });
        expect(draft.current).toBe("approval");
    });

    it("sagt am Setup-Schritt, dass der Bot zum Anmeldeschluss selbst vorschlägt", () => {
        const res = run(own({ event: { autoSuggest: true } }));
        expect(at(res, "setup").note).toBe("Vorschlag bei Anmeldeschluss");
        expect(at(res, "setup").hint).toMatch(/Anmeldeschluss legt der Bot/);
    });

    describe("übersprungen ist kein Fehler", () => {
        it("gilt ohne autoSuggest, ohne Entwurf und weniger als eine Stunde vor dem Start", () => {
            const res = run(own({ event: { startTime: inHours(0.5), signupDeadline: inHours(-2) }, ownSignups: signed(20) }));
            expect(at(res, "setup")).toMatchObject({ state: "skipped", note: "ohne Setup" });
            expect(at(res, "approval")).toMatchObject({ state: "skipped", note: "ohne Setup" });
            // übersprungen heißt nicht kaputt: kein Ton, kein „fehlt“, nichts offen
            expect(at(res, "setup").hint).toMatch(/gewöhnlicher Fall/);
            expect(res.current).toBe("");
            expect(res.action).toBeNull();
            // und der Weg in den Editor bleibt trotzdem offen
            expect(at(res, "setup").action).toMatchObject({ tab: "setup" });
        });

        it("gilt noch nicht, solange mehr als eine Stunde bis zum Start ist", () => {
            const res = run(own({ event: { startTime: inHours(2), signupDeadline: inHours(-2) }, ownSignups: signed(20) }));
            expect(at(res, "setup").state).toBe("current");
        });

        it("wartet mit autoSuggest bis zum Start ab, danach nicht mehr", () => {
            const waiting = run(own({ event: { autoSuggest: true, startTime: inHours(0.5), signupDeadline: inHours(-2) } }));
            expect(at(waiting, "setup").state).toBe("current");
            const over = run(own({ event: { autoSuggest: true, startTime: inHours(-3), isPast: true } }));
            expect(at(over, "setup").state).toBe("skipped");
        });

        it("überspringt auch die Freigabe eines Entwurfs, der nie freigegeben wurde", () => {
            const res = run(own({
                event: { startTime: inHours(-4), isPast: true },
                ownSetup: { status: "draft", placed: 25, size: 25, version: 1, bench: 0, ok: true },
            }));
            expect(at(res, "setup").state).toBe("done");
            expect(at(res, "approval")).toMatchObject({ state: "skipped", note: "nie freigegeben" });
        });
    });

    describe("Freigabe", () => {
        const approved = (post, extra) => run(own({
            event: { signupsClosed: true },
            ownSetup: { status: "approved", changedSinceApproval: false, placed: 25, size: 25, version: 3, bench: 2, ok: true, ...(extra || {}) },
            ownSetupPost: post,
        }));

        it("ist offen, solange nur ein Entwurf steht", () => {
            const res = run(own({ event: { signupsClosed: true }, ownSetup: { status: "draft", placed: 25, size: 25, version: 1, bench: 0, ok: true } }));
            expect(at(res, "approval")).toMatchObject({ state: "current", value: "25", unit: "im Entwurf", note: "Entwurf" });
            expect(res.action).toMatchObject({ tab: "setup", label: "Setup freigeben" });
            expect(at(res, "approval").hint).toMatch(/Raider sehen noch nichts/);
        });

        it("ist wieder offen, wenn sich nach der Freigabe etwas geändert hat", () => {
            const res = approved(null, { status: "approved", changedSinceApproval: true });
            expect(at(res, "approval")).toMatchObject({ state: "current", note: "geändert seit der Freigabe" });
        });

        it("nennt den Stand und die DMs, wenn freigegeben ist", () => {
            const res = approved({ messageId: "m1", channelId: "c1", version: 3, dms: { total: 22, sent: 22, failed: 0 } });
            expect(at(res, "approval")).toMatchObject({ state: "done", value: "Stand 3", unit: "", note: "gepostet · 22 DMs", action: null });
            expect(res.current).toBe("");
            const failed = approved({ messageId: "m1", channelId: "c1", version: 3, dms: { total: 22, sent: 20, failed: 2 } });
            expect(at(failed, "approval").note).toBe("gepostet · 20 DMs · 2 fehlgeschlagen");
        });

        it("bietet das Nachposten an, wenn die Nachricht einen älteren Stand zeigt", () => {
            const res = approved({ messageId: "m1", channelId: "c1", version: 2, dms: null });
            expect(at(res, "approval").action).toMatchObject({ tab: "setup", label: "Setup posten" });
            expect(at(res, "approval").hint).toMatch(/zeigt noch Stand 2/);
            // eine nie gepostete Nachricht ist kein veralteter Stand
            expect(at(approved(null), "approval").note).toBe("nicht gepostet");
        });
    });

    describe("Nachbereitung", () => {
        const past = (rest) => run(own({ event: { startTime: inHours(-20), isPast: true, signupDeadline: inHours(-24) }, ...rest }));

        it("ist vor dem Raid nur „später“ und bekommt keine Tat", () => {
            expect(at(run(own()), "after")).toMatchObject({ state: "todo", action: null });
        });

        it("fängt bei einem vergangenen Raid die Strecke an", () => {
            const res = past({});
            expect(res.current).toBe("after");
            expect(res.action).toMatchObject({ modal: "log", label: "Log zuordnen" });
            // nichts vor der Nachbereitung ist noch offen
            expect(res.steps.filter((s) => s.state === "current").map((s) => s.id)).toEqual(["after"]);
        });

        it("führt vom Log über die Auswertung zum Loot", () => {
            const toEvaluate = past({ eventLogs: [{ id: "l1", sections: ["cla"] }] });
            expect(toEvaluate.action).toMatchObject({ label: "RPB auswerten", evaluate: { logId: "l1", section: "rpb" } });

            const toLoot = past({ eventLogs: [{ id: "l1", sections: ["cla", "rpb"] }] });
            expect(toLoot.action).toMatchObject({ modal: "loot", label: "Loot importieren" });
            expect(at(toLoot, "after")).toMatchObject({ value: "1", unit: "Log", note: "kein Loot" });
        });

        it("ist erledigt, wenn Log ausgewertet UND Loot importiert ist", () => {
            const res = past({ eventLogs: [{ id: "l1", sections: ["cla", "rpb"] }], lootItems: [{ character: "Zibbo" }, { character: "Brokk" }] });
            expect(at(res, "after")).toMatchObject({ state: "done", value: "1", unit: "Log", note: "2 Items", action: null });
            expect(res.current).toBe("");
            expect(res.note).toMatch(/Nachbereitung erledigt/);
        });
    });

    it("ein abgesagtes Event zeigt nur „abgesagt“ und den Weg zurück", () => {
        const res = run(own({
            event: { status: "cancelled", cancelReason: "Zu wenig Heiler" },
            ownSignups: signed(9),
            ownSetup: { status: "draft", placed: 9, size: 25, version: 1, bench: 0, ok: true },
        }));
        expect(res.cancelled).toBe(true);
        expect(res.note).toBe("Abgesagt: Zu wenig Heiler");
        expect(res.current).toBe("");
        expect(res.action).toMatchObject({ manage: "reopen", label: "Absage zurücknehmen" });
        // kein Schritt drängt noch zu irgendetwas
        expect(res.steps.map((s) => s.state)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
        expect(res.steps.every((s) => s.action === null)).toBe(true);
    });

    it("kommt ohne jedes Feld aus, statt zu werfen", () => {
        const res = eventSteps({}, { now: NOW });
        expect(res.steps.map((s) => s.id)).toEqual(STEP_IDS);
        expect(res.cancelled).toBe(false);
    });
});
