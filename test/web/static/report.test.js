// The report pages' client script (src/web/static/report.js, #423): its pure
// helpers directly, its wiring against a small stand-in for the DOM — there is
// no browser in the test run, so every element is a plain object that knows
// which elements its closest()/querySelector() calls should find.
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "..", "src", "web", "static", "report.js");

// ---- a minimal DOM stand-in -------------------------------------------------------
function classList(el) {
    const set = () => new Set(String(el.className || "").split(/\s+/).filter(Boolean));
    const write = (s) => { el.className = [...s].join(" "); };
    return {
        contains: (c) => set().has(c),
        add: (c) => { const s = set(); s.add(c); write(s); },
        remove: (c) => { const s = set(); s.delete(c); write(s); },
        toggle: (c, on) => { const s = set(); const want = on === undefined ? !s.has(c) : !!on; if (want) s.add(c); else s.delete(c); write(s); return want; },
    };
}
function el(attrs = {}, props = {}) {
    const e = {
        attrs: { ...attrs }, className: "", hidden: false, open: false, disabled: false, textContent: "", value: "", html: "", tagName: "DIV", style: {},
        children: [], links: { closest: {}, one: {}, all: {} },
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
        setAttribute(n, v) { this.attrs[n] = String(v); },
        hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n); },
        closest(sel) { return this.links.closest[sel] || null; },
        querySelector(sel) { return this.links.one[sel] || null; },
        querySelectorAll(sel) { return this.links.all[sel] || []; },
        appendChild(c) { this.children.push(c); return c; },
        focus: jest.fn(), click: jest.fn(), showModal: jest.fn(), close: jest.fn(), scrollIntoView: jest.fn(), addEventListener: jest.fn(),
        getBoundingClientRect: () => ({ left: 100, top: 100, width: 40, height: 20, bottom: 120 }),
        ...props,
    };
    e.classList = classList(e);
    // setting innerHTML replaces the children, as in a browser
    Object.defineProperty(e, "innerHTML", { get() { return this.html; }, set(v) { this.html = v; this.children = []; } });
    if (props.innerHTML !== undefined) e.innerHTML = props.innerHTML;
    return e;
}

function load({ hash = "", search = "", pathname = "/r/abc123/p/1", byId = {}, fetchImpl, confirmAnswer = true, stored = null } = {}) {
    const listeners = {};
    const winListeners = {};
    const documentElement = el();
    const body = el();
    const document = {
        documentElement, body,
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        getElementById: (id) => byId[id] || null,
        querySelector: (sel) => (document.links.one[sel] || null),
        querySelectorAll: (sel) => (document.links.all[sel] || []),
        createElement: (tag) => {
            const e = el({}, { tagName: tag.toUpperCase() });
            e.querySelector = (sel) => e.links.one[sel] || (e.links.one[sel] = el()); // the tooltip box finds its <b> and <i>
            return e;
        },
        createTextNode: (t) => ({ text: t }),
        links: { one: {}, all: {} },
    };
    const storage = { eh: stored, setItem: jest.fn((k, v) => { storage.eh = v; }), getItem: () => storage.eh };
    const env = {
        document,
        window: { addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); }, innerWidth: 1200, matchMedia: () => ({ matches: false }) },
        location: { hash, search, pathname, reload: jest.fn() },
        history: { replaceState: jest.fn() },
        localStorage: storage,
        fetch: jest.fn(fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))),
        confirm: jest.fn(() => confirmAnswer),
    };
    const saved = {};
    for (const k of Object.keys(env)) { saved[k] = global[k]; global[k] = env[k]; }
    let helpers;
    try {
        jest.isolateModules(() => { helpers = require(FILE); });
    } finally {
        for (const k of Object.keys(env)) global[k] = saved[k];
    }
    // the handlers read the globals at call time, so fire() puts them back for the call
    const fire = (type, event, target = listeners) => {
        const keep = {};
        for (const k of Object.keys(env)) { keep[k] = global[k]; global[k] = env[k]; }
        try {
            for (const fn of target[type] || []) fn({ preventDefault: jest.fn(), ...event });
        } finally {
            for (const k of Object.keys(env)) global[k] = keep[k];
        }
    };
    const withEnv = async (fn) => {
        const keep = {};
        for (const k of Object.keys(env)) { keep[k] = global[k]; global[k] = env[k]; }
        try { return await fn(); } finally { for (const k of Object.keys(env)) global[k] = keep[k]; }
    };
    return { helpers, env, listeners, winListeners, fire, withEnv, document };
}
const flush = () => new Promise((r) => setImmediate(r));
const settle = async (withEnv) => { for (let i = 0; i < 10; i++) await withEnv(flush); };
const json = (data, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(data) });

// ---- pure helpers -------------------------------------------------------------------
describe("static/report.js — helpers", () => {
    const h = require(FILE);

    it("loads in Node without touching a DOM and exports its helpers", () => {
        expect(typeof h.reviewBody).toBe("function");
        expect(Object.keys(h)).toEqual(expect.arrayContaining(["phraseBody", "sendResult", "viewTarget", "cardVisible", "rowVisible"]));
    });

    it("reads the CSRF token in both answer shapes and an API error's message", () => {
        expect(h.csrfFrom({ csrfToken: "a" })).toBe("a");
        expect(h.csrfFrom({ data: { csrfToken: "b" } })).toBe("b");
        expect(h.csrfFrom(null)).toBe("");
        expect(h.errorText({ error: { message: "kaputt" } }, 500)).toBe("kaputt");
        expect(h.errorText({ message: "alt" }, 500)).toBe("alt");
        expect(h.errorText(null, 403)).toBe(403);
    });

    it("finds the report id in the page path", () => {
        expect(h.reportIdOf("/r/abc123/p/2")).toBe("abc123");
        expect(h.reportIdOf("/r/abc123")).toBe("abc123");
        expect(h.reportIdOf("/docs")).toBeUndefined();
    });

    it("builds the verdict body: a second click on the active verdict takes it back", () => {
        const base = { reportId: "r1", scope: "player", player: "Elun", key: "healers.mana" };
        expect(h.reviewBody({ ...base, action: "approve", state: "open" })).toEqual({ ...base, approved: true });
        expect(h.reviewBody({ ...base, action: "approve", state: "approved" })).toEqual({ ...base, approved: null });
        expect(h.reviewBody({ ...base, action: "reject", state: "approved" })).toEqual({ ...base, approved: false });
        expect(h.reviewBody({ ...base, action: "reject", state: "rejected" })).toEqual({ ...base, approved: null });
        expect(h.reviewBody({ ...base, action: "reset", state: "rejected" })).toEqual({ ...base, approved: null });
        expect(h.reviewBody({ ...base, action: "save", state: "open", text: "Eigener Text" })).toEqual({ ...base, text: "Eigener Text" });
        expect(h.reviewState(true)).toBe("approved");
        expect(h.reviewState(false)).toBe("rejected");
        expect(h.reviewState(null)).toBe("open");
    });

    it("phrases one raider or the whole report and reports the result", () => {
        expect(h.phraseBody("r1", "Elun")).toEqual({ reportId: "r1", players: ["Elun"] });
        expect(h.phraseBody("r1", "")).toEqual({ reportId: "r1" });
        expect(h.phraseDoneText({ phrased: 5, players: 2 })).toBe("Fertig: 5 Texte für 2 Raider. Seite wird neu geladen …");
        expect(h.phraseDoneText({ phrased: 5, players: 2, errors: [1] })).toBe("Fertig: 5 Texte für 2 Raider, 1 Fehler. Seite wird neu geladen …");
        expect(h.phraseDoneText(undefined)).toBe("Fertig: 0 Texte für 0 Raider. Seite wird neu geladen …");
    });

    it("says whether an account is mapped and when a raider was last written to", () => {
        expect(h.mappingLabel({ mapped: true })).toBe("Konto zugeordnet");
        expect(h.mappingLabel({ ambiguous: true })).toBe("mehrere Konten");
        expect(h.mappingLabel({})).toBe("kein Konto zugeordnet");
        expect(h.statusLine({ name: "Elun", approved: 2, mapped: true })).toBe("Elun: 2 Punkte · Konto zugeordnet");
        const at = Date.UTC(2026, 8, 7, 18, 30);
        expect(h.statusLine({ name: "Elun", approved: 2, sentAt: at, changed: true })).toBe(`Elun: 2 Punkte · kein Konto zugeordnet · gesendet ${new Date(at).toLocaleString("de-DE")} (seitdem geändert)`);
    });

    it("cuts a long point in the DM preview after 160 characters", () => {
        expect(h.previewText("kurz")).toBe("kurz");
        expect(h.previewText("x".repeat(200))).toBe(`${"x".repeat(160)} …`);
    });

    it("turns the send answer into the dialog's line and offers a resend only for an unchanged set", () => {
        expect(h.sendResult({ sent: [{ name: "Elun", items: 2 }] })).toEqual({ text: "Gesendet: 2 Punkte an Elun.", force: false });
        expect(h.sendResult({ skipped: [{ reason: "already_sent", message: "Bereits gesendet." }] })).toEqual({ text: "Bereits gesendet.", force: true });
        expect(h.sendResult({ skipped: [{ reason: "no_account" }], message: "Kein Konto." })).toEqual({ text: "Kein Konto.", force: false });
        expect(h.sendResult({ skipped: [{ reason: "x" }] })).toEqual({ text: "", force: false });
        expect(h.sendResult({})).toEqual({ text: "Nichts gesendet.", force: false });
    });

    it("reads the view or the raider from the url", () => {
        expect(h.viewTarget("#bosse", "")).toEqual({ view: "bosse" });
        expect(h.viewTarget("#raider-Elun", "")).toEqual({ raider: "Elun" });
        expect(h.viewTarget("#raider-J%C3%A4ger", "")).toEqual({ raider: "Jäger" });
        expect(h.viewTarget("#raider-%E0%A4%A", "")).toEqual({ raider: "%E0%A4%A" });
        expect(h.viewTarget("#raid", "?player=Dorn")).toEqual({ raider: "Dorn" });
        expect(h.viewTarget("#other", "")).toBeNull();
        expect(h.viewTarget("", "")).toBeNull();
    });

    it("filters raider cards and RPB rows by role and name", () => {
        const card = { role: "healer", name: "Elun", open: "2" };
        expect(h.cardVisible(card, "all", "")).toBe(true);
        expect(h.cardVisible(card, "healer", "el")).toBe(true);
        expect(h.cardVisible(card, "tank", "")).toBe(false);
        expect(h.cardVisible(card, "open", "")).toBe(true);
        expect(h.cardVisible({ ...card, open: "0" }, "open", "")).toBe(false);
        expect(h.cardVisible(card, "all", "brokk")).toBe(false);
        expect(h.rowVisible({ role: "Tank", name: "Brokk" }, "all", "BRO")).toBe(true);
        expect(h.rowVisible({ role: "Tank", name: "Brokk" }, "Healer", "")).toBe(false);
        expect(h.rowVisible({ role: "Tank", name: null }, "Tank", "x")).toBe(false);
    });
});

// ---- the wiring -----------------------------------------------------------------------
describe("static/report.js — wiring", () => {
    it("opens a dialog from [data-dialog], closes it from [data-close] and the backdrop, and opens a card by keyboard", () => {
        const dlg = el({ id: "dlg-x" });
        const { fire } = load({ byId: { "dlg-x": dlg } });
        const opener = el({ "data-dialog": "dlg-x" });
        opener.links.closest["[data-dialog]"] = opener;
        opener.links.closest.summary = opener;
        const ev = { target: opener, preventDefault: jest.fn() };
        fire("click", ev);
        expect(dlg.showModal).toHaveBeenCalled();
        const closer = el();
        closer.links.closest["[data-close]"] = closer;
        closer.links.closest.dialog = dlg;
        fire("click", { target: closer });
        expect(dlg.close).toHaveBeenCalledTimes(1);
        dlg.links.closest["dialog.dlg"] = dlg;
        fire("click", { target: dlg });
        expect(dlg.close).toHaveBeenCalledTimes(2);
        const card = el({ role: "button", "data-dialog": "dlg-x" });
        card.links.closest["[role=button][data-dialog]"] = card;
        fire("keydown", { key: "Enter", target: card });
        expect(card.click).toHaveBeenCalled();
        fire("keydown", { key: "a", target: card });
        expect(card.click).toHaveBeenCalledTimes(1);
    });

    it("leaves a disabled opener closed", () => {
        const dlg = el();
        const { fire } = load({ byId: { "dlg-x": dlg } });
        const opener = el({ "data-dialog": "dlg-x" }, { disabled: true });
        opener.links.closest["[data-dialog]"] = opener;
        fire("click", { target: opener });
        expect(dlg.showModal).not.toHaveBeenCalled();
    });

    it("switches data-show panels and keeps the open view in the hash", () => {
        const pa = el(); const pb = el();
        const { fire, env } = load({ byId: { "view-raid": pa, "view-bosse": pb } });
        const a = el({ "data-show": "view-raid" }); const b = el({ "data-show": "view-bosse" });
        const nav = el();
        nav.links.all["[data-show]"] = [a, b];
        for (const x of [a, b]) { x.parentElement = nav; x.links.closest["[data-show]"] = x; x.links.closest[".seg.views [data-show]"] = x; }
        fire("click", { target: b });
        expect(b.classList.contains("active")).toBe(true);
        expect(a.classList.contains("active")).toBe(false);
        expect(pa.hidden).toBe(true);
        expect(pb.hidden).toBe(false);
        expect(env.history.replaceState).toHaveBeenCalledWith(null, "", "#bosse");
    });

    it("opens the raider of the url on load and again on a hash change", () => {
        const btn = el();
        const card = el({ "data-name": "Elun" });
        const other = el({ "data-name": "Brokk" });
        const { document, winListeners, fire, env } = load({ hash: "#raider-Elun" });
        // the first run happened on load, before the links existed: wire them and replay the hash change
        document.links.one[".seg.views [data-show='view-raider']"] = btn;
        document.links.all[".raider-card"] = [other, card];
        fire("hashchange", {}, winListeners);
        expect(btn.click).toHaveBeenCalled();
        expect(card.open).toBe(true);
        expect(card.scrollIntoView).toHaveBeenCalled();
        expect(other.open).toBe(false);
        env.location.hash = "#raid";
        const raid = el();
        document.links.one[".seg.views [data-show='view-raid']"] = raid;
        fire("hashchange", {}, winListeners);
        expect(raid.click).toHaveBeenCalled();
    });

    it("filters the raider cards by role and search and shows the empty note", () => {
        const empty = el();
        const { fire, document } = load({ byId: { raiderEmpty: empty } });
        const a = el({ "data-role": "tank", "data-name": "Brokk", "data-open": "0" });
        const b = el({ "data-role": "healer", "data-name": "Elun", "data-open": "2" });
        document.links.all[".raider-card"] = [a, b];
        const seg = el();
        const heal = el({ "data-rolefilter": "healer" });
        heal.parentElement = seg;
        heal.links.closest["[data-rolefilter]"] = heal;
        seg.links.all["[data-rolefilter]"] = [heal];
        fire("click", { target: heal });
        expect([a.hidden, b.hidden]).toEqual([true, false]);
        expect(empty.hidden).toBe(true);
        fire("input", { target: el({}, { id: "raiderSearch", value: " XYZ " }) });
        expect(b.hidden).toBe(true);
        expect(empty.hidden).toBe(false);
    });

    it("opens or closes every visible raider card", () => {
        const { fire, document } = load();
        const a = el(); const b = el({}, { hidden: true });
        document.links.all[".raider-card"] = [a, b];
        const btn = el({ "data-cards": "toggle" });
        btn.links.closest["[data-cards]"] = btn;
        fire("click", { target: btn });
        expect(a.open).toBe(true);
        expect(b.open).toBe(false);
        fire("click", { target: btn });
        expect(a.open).toBe(false);
    });

    it("filters the RPB rows of a .dscope and flips its orientation", () => {
        const { fire } = load();
        const scope = el();
        const r1 = el({ "data-role": "Tank", "data-name": "Brokk" });
        const r2 = el({ "data-role": "Healer", "data-name": "Elun" });
        scope.links.all["[data-role]"] = [r1, r2];
        const seg = el();
        const btn = el({ "data-frole": "Healer" }, { tagName: "BUTTON" });
        btn.parentElement = seg;
        btn.links.closest["[data-frole]"] = btn;
        btn.links.closest[".dscope"] = scope;
        seg.links.all["button[data-frole]"] = [btn];
        fire("click", { target: btn });
        expect([r1.hidden, r2.hidden]).toEqual([true, false]);
        const input = el({ "data-fsearch": "" }, { value: "zz" });
        input.links.closest[".dscope"] = scope;
        fire("input", { target: input });
        expect(r2.hidden).toBe(true);
        const orient = el({ "data-orient": "a" });
        orient.parentElement = seg;
        orient.links.closest["[data-orient]"] = orient;
        orient.links.closest[".dscope"] = scope;
        fire("click", { target: orient });
        expect(scope.classList.contains("va")).toBe(true);
    });

    it("filters the player page's fight table", () => {
        const { fire } = load();
        const section = el();
        const t1 = el({ "data-flag": "1" }); const t0 = el({ "data-flag": "0" });
        section.links.all["tr[data-flag]"] = [t1, t0];
        const seg = el();
        const flag = el({ "data-pfilter": "flag" });
        flag.parentElement = seg;
        flag.links.closest["[data-pfilter]"] = flag;
        flag.links.closest.section = section;
        seg.links.all["[data-pfilter]"] = [flag];
        fire("click", { target: flag });
        expect([t1.hidden, t0.hidden]).toEqual([false, true]);
    });

    it("posts a verdict with the CSRF token and marks the row", async () => {
        const calls = [];
        const { fire, withEnv, env } = load({
            fetchImpl: (url, opts) => { calls.push([url, opts]); return url === "/api/session" ? json({ csrfToken: "tok" }) : json({ ok: true }); },
        });
        const li = el({}, { className: "rec rec-state-open" });
        const box = el({ "data-scope": "player", "data-player": "Elun", "data-key": "gear" });
        const status = el(); const state = el(); const ap = el(); const rj = el();
        li.links.one[".rec-review"] = box;
        li.links.one[".rec-status"] = status;
        li.links.one[".rec-state"] = state;
        box.links.one["[data-review=approve]"] = ap;
        box.links.one["[data-review=reject]"] = rj;
        const btn = el({ "data-review": "approve" });
        btn.links.closest["[data-review]"] = btn;
        btn.links.closest[".rec"] = li;
        fire("click", { target: btn });
        await settle(withEnv);
        expect(calls[1][0]).toBe("/api/cla/recommendations");
        expect(calls[1][1].headers["X-CSRF-Token"]).toBe("tok");
        expect(JSON.parse(calls[1][1].body)).toEqual({ reportId: "abc123", scope: "player", player: "Elun", key: "gear", approved: true });
        expect(li.className).toBe("rec rec-state-approved");
        expect(state.textContent).toBe("freigegeben");
        expect(state.className).toBe("badge rec-state ok");
        expect(ap.classList.contains("ok")).toBe(true);
        expect(status.textContent).toBe("gespeichert");
        // the second verdict reuses the token
        fire("click", { target: btn });
        await settle(withEnv);
        expect(env.fetch.mock.calls.filter(([u]) => u === "/api/session")).toHaveLength(1);
        expect(JSON.parse(calls[2][1].body).approved).toBeNull();
    });

    it("saves an own text, shows it, and reports a failed save in the row", async () => {
        let fail = false;
        const { fire, withEnv } = load({
            fetchImpl: (url) => (url === "/api/session" ? json({ data: { csrfToken: "t" } }) : fail ? json({ error: { message: "verboten" } }, false, 403) : json({})),
        });
        const li = el({}, { className: "rec rec-state-open" });
        const box = el({ "data-scope": "raid", "data-key": "k" });
        const text = el({}, { value: "Mein Text" }); const bodyEl = el(); const status = el();
        Object.assign(li.links.one, { ".rec-review": box, ".rec-text": text, ".rec-body": bodyEl, ".rec-status": status });
        const save = el({ "data-review": "save" });
        save.links.closest["[data-review]"] = save;
        save.links.closest[".rec"] = li;
        fire("click", { target: save });
        await settle(withEnv);
        expect(bodyEl.textContent).toBe("Mein Text");
        fail = true;
        fire("click", { target: save });
        await settle(withEnv);
        expect(status.textContent).toBe("Fehler: verboten");
        expect(li.open).toBe(true);
    });

    it("opens the editor and toggles the rule text without a request", () => {
        const { fire, env } = load();
        const li = el();
        const edit = el({}, { hidden: true }); const ta = el(); const rule = el({}, { hidden: true });
        edit.links.one.textarea = ta;
        li.links.one[".rec-edit"] = edit;
        li.links.one[".rec-rule"] = rule;
        const e1 = el({ "data-review": "edit" });
        e1.links.closest["[data-review]"] = e1;
        e1.links.closest[".rec"] = li;
        fire("click", { target: e1 });
        expect(li.open).toBe(true);
        expect(edit.hidden).toBe(false);
        expect(ta.focus).toHaveBeenCalled();
        const label = { textContent: "" };
        const r = el({ "data-review": "rule" }, { lastChild: label });
        r.links.closest["[data-review]"] = r;
        r.links.closest[".rec"] = li;
        fire("click", { target: r });
        expect(rule.hidden).toBe(false);
        expect(label.textContent).toBe("Regeltext verbergen");
        expect(env.fetch).not.toHaveBeenCalled();
    });

    it("starts the phrasing job for one raider, polls until it is done and reloads", async () => {
        jest.useFakeTimers({ doNotFake: ["setImmediate"] });
        let polls = 0;
        const { fire, withEnv, env } = load({
            fetchImpl: (url) => {
                if (url === "/api/session") return json({ csrfToken: "t" });
                if (url.startsWith("/api/cla/recommendations/phrase?")) { polls++; return json({ data: polls < 2 ? { job: { status: "running" } } : { job: { status: "done" }, last: { phrased: 3, players: 1 } } }); }
                return json({ ok: true });
            },
        });
        const box = el({ "data-report": "abc123", "data-name": "Elun" });
        const out = el({}, { hidden: true });
        box.links.one[".rec-send-result"] = out;
        const btn = el({ "data-phrase": "player" });
        btn.links.closest["[data-phrase]"] = btn;
        btn.links.closest["[data-report]"] = box;
        fire("click", { target: btn });
        expect(out.textContent).toBe("KI-Formulierung läuft …");
        await settle(withEnv);
        expect(JSON.parse(env.fetch.mock.calls[1][1].body)).toEqual({ reportId: "abc123", players: ["Elun"] });
        await withEnv(async () => { jest.advanceTimersByTime(2500); });
        await settle(withEnv);
        expect(out.textContent).toBe("Fertig: 3 Texte für 1 Raider. Seite wird neu geladen …");
        await withEnv(async () => { jest.advanceTimersByTime(1200); });
        expect(env.location.reload).toHaveBeenCalled();
        jest.useRealTimers();
    });

    it("shows a failed phrasing job and enables the button again", async () => {
        const { fire, withEnv } = load({
            fetchImpl: (url) => (url === "/api/session" ? json({ csrfToken: "t" }) : url.includes("?id=") ? json({ data: { job: { status: "error", error: "kein Schlüssel" } } }) : json({})),
        });
        const box = el({ "data-report": "abc123" });
        const out = el();
        box.links.one[".rec-send-result"] = out;
        const btn = el({ "data-phrase": "all" });
        btn.links.closest["[data-phrase]"] = btn;
        btn.links.closest["[data-report]"] = box;
        fire("click", { target: btn });
        await settle(withEnv);
        expect(out.textContent).toBe("Fehler: kein Schlüssel");
        expect(btn.disabled).toBe(false);
    });

    it("checks the mapping and sends to every raider after the confirmation", async () => {
        const { fire, withEnv, env } = load({
            fetchImpl: (url) => {
                if (url === "/api/session") return json({ csrfToken: "t" });
                if (url.startsWith("/api/cla/recommendations/send?")) return json({ data: { players: [{ name: "Elun", approved: 2, mapped: true }, { name: "Dorn", approved: 1, ambiguous: true }] } });
                return json({ data: { message: "2 gesendet", sent: [{ name: "Elun", items: 2 }], skipped: [{ name: "Dorn", message: "mehrere Konten" }] } });
            },
        });
        const box = el({ "data-report": "abc123" });
        const out = el();
        box.links.one[".rec-send-result"] = out;
        const status = el({ "data-send": "status" });
        status.links.closest["[data-send]"] = status;
        status.links.closest[".rec-send"] = box;
        fire("click", { target: status });
        await settle(withEnv);
        expect(out.children.map((c) => [c.className, c.textContent])).toEqual([["rec-send-row ok", "Elun: 2 Punkte · Konto zugeordnet"], ["rec-send-row warn", "Dorn: 1 Punkte · mehrere Konten"]]);
        const all = el({ "data-send": "all" });
        all.links.closest["[data-send]"] = all;
        all.links.closest[".rec-send"] = box;
        out.children = [];
        fire("click", { target: all });
        await settle(withEnv);
        expect(env.confirm).toHaveBeenCalled();
        expect(out.children.map((c) => c.textContent)).toEqual(["2 gesendet", "Gesendet: Elun (2 Punkte)", "Übersprungen: Dorn: mehrere Konten"]);
        expect(all.disabled).toBe(false);
    });

    it("sends nothing when the confirmation is declined, and lists nothing approved", async () => {
        const { fire, withEnv, env } = load({ confirmAnswer: false, fetchImpl: () => json({ data: { players: [] } }) });
        const box = el({ "data-report": "abc123" });
        const out = el();
        box.links.one[".rec-send-result"] = out;
        const all = el({ "data-send": "all" });
        all.links.closest["[data-send]"] = all;
        all.links.closest[".rec-send"] = box;
        fire("click", { target: all });
        expect(out.hidden).toBe(true);
        expect(env.fetch).not.toHaveBeenCalled();
        const status = el({ "data-send": "status" });
        status.links.closest["[data-send]"] = status;
        status.links.closest[".rec-send"] = box;
        fire("click", { target: status });
        await settle(withEnv);
        expect(out.children.map((c) => c.textContent)).toEqual(["Nichts freigegeben."]);
    });

    function sendDialog() {
        const dlg = el({ "data-report": "abc123", "data-player": "Elun" });
        const badge = el(); const out = el(); const dm = el();
        const ta1 = el({}, { value: "Mein eigener Text" }); const ta2 = el({}, { value: "Regeltext" });
        const it1 = el({ "data-mode": "custom", "data-key": "gear", "data-title": "Gear", "data-custom": "", "data-ai": "KI-Text", "data-rule": "Regel" });
        const it2 = el({ "data-mode": "rule", "data-key": "mana", "data-title": "Mana", "data-custom": "" });
        it1.links.one[".send-text"] = ta1;
        it2.links.one[".send-text"] = ta2;
        const btn = el({ "data-sendact": "send" });
        Object.assign(dlg.links.one, { ".map-badge": badge, ".send-out": out, ".dm-items": dm });
        dlg.links.all[".send-item"] = [it1, it2];
        dlg.links.all["[data-sendact]"] = [btn];
        btn.links.closest["[data-sendact]"] = btn;
        btn.links.closest.dialog = dlg;
        return { dlg, badge, out, dm, it1, ta1, btn };
    }

    it("fills the mapping badge when a send dialog opens, once per report", async () => {
        const d = sendDialog();
        const { fire, withEnv, env } = load({ byId: { "send-1": d.dlg }, fetchImpl: () => json({ data: { players: [{ name: "Elun", approved: 1, mapped: true }] } }) });
        const opener = el({ "data-dialog": "send-1" });
        opener.links.closest["[data-dialog^='send-']"] = opener;
        fire("click", { target: opener });
        await settle(withEnv);
        expect(d.badge.textContent).toBe("Konto zugeordnet");
        expect(d.badge.className).toBe("badge map-badge ok");
        fire("click", { target: opener });
        expect(env.fetch).toHaveBeenCalledTimes(1);
    });

    it("switches a point between KI, Regel and Eigener and redraws the preview", () => {
        const d = sendDialog();
        const { fire } = load();
        const ki = el({ "data-txt": "ai" }); const own = el({ "data-txt": "custom" });
        d.it1.links.all["[data-txt]"] = [ki, own];
        for (const x of [ki, own]) { x.links.closest["[data-txt]"] = x; x.links.closest[".send-item"] = d.it1; x.links.closest.dialog = d.dlg; }
        fire("click", { target: ki });
        expect(d.it1.getAttribute("data-mode")).toBe("ai");
        expect(d.ta1.value).toBe("KI-Text");
        expect(d.ta1.readOnly).toBe(true);
        expect(ki.classList.contains("active")).toBe(true);
        expect(d.dm.children.map((c) => c.children[0].textContent)).toEqual(["Gear", "Mana"]);
        fire("click", { target: own });
        expect(d.ta1.readOnly).toBe(false);
        expect(d.ta1.focus).toHaveBeenCalled();
        const typing = el({}, { className: "send-text" });
        typing.links.closest.dialog = d.dlg;
        fire("input", { target: typing });
        // "Eigener" starts from the saved own text, empty here, and an empty point stays out of the preview
        expect(d.dm.children.map((c) => c.children[0].textContent)).toEqual(["Mana"]);
    });

    it("saves changed own texts, sends, and offers a resend for an unchanged set", async () => {
        const d = sendDialog();
        const posts = [];
        const { fire, withEnv } = load({
            fetchImpl: (url, opts) => {
                if (url === "/api/session") return json({ csrfToken: "t" });
                posts.push([url, JSON.parse(opts.body)]);
                if (url === "/api/cla/recommendations") return json({});
                return json({ data: { skipped: [{ reason: "already_sent", message: "Bereits gesendet." }] } });
            },
        });
        fire("click", { target: d.btn });
        expect(d.out.textContent).toBe("…");
        await settle(withEnv);
        expect(posts[0]).toEqual(["/api/cla/recommendations", { reportId: "abc123", scope: "player", player: "Elun", key: "gear", text: "Mein eigener Text" }]);
        expect(posts[1]).toEqual(["/api/cla/recommendations/send", { reportId: "abc123", players: ["Elun"], force: false }]);
        expect(d.it1.getAttribute("data-custom")).toBe("Mein eigener Text");
        expect(d.out.textContent).toBe("Bereits gesendet.");
        expect(d.out.children[1].getAttribute("data-sendact")).toBe("force");
        expect(d.btn.disabled).toBe(false);
    });

    it("only saves on 'Nur speichern' and reports a failed save", async () => {
        const d = sendDialog();
        d.btn.attrs["data-sendact"] = "save";
        let ok = true;
        const { fire, withEnv } = load({ fetchImpl: (url) => (url === "/api/session" ? json({ csrfToken: "t" }) : Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve({}) })) });
        fire("click", { target: d.btn });
        await settle(withEnv);
        expect(d.out.textContent).toBe("Gespeichert.");
        d.it1.attrs["data-custom"] = "";
        ok = false;
        fire("click", { target: d.btn });
        await settle(withEnv);
        expect(d.out.textContent).toBe("Fehler: Speichern fehlgeschlagen (500)");
    });

    it("shows a tooltip box on hover and focus, toggles it on touch and hides it again", () => {
        const { fire, document, winListeners } = load();
        const t = el({ "data-tip": "Kopf", "data-tip-sub": "Erklärung" });
        t.links.closest["[data-tip]"] = t;
        fire("mouseover", { target: t });
        const box = document.body.children[0];
        expect(box.id).toBe("tip");
        expect(box.classList.contains("on")).toBe(true);
        fire("scroll", {}, winListeners);
        const plain = el();
        fire("mouseover", { target: plain });
        expect(box.classList.contains("on")).toBe(false);
        fire("focusin", { target: t });
        expect(box.classList.contains("on")).toBe(true);
        fire("focusout", {});
        expect(box.classList.contains("on")).toBe(false);
        fire("pointerdown", { pointerType: "touch", target: t });
        expect(box.classList.contains("on")).toBe(true);
        fire("pointerdown", { pointerType: "touch", target: t });
        expect(box.classList.contains("on")).toBe(false);
        fire("pointerdown", { pointerType: "touch", target: plain });
        fire("pointerdown", { pointerType: "mouse", target: t });
        fire("mouseover", { target: t });
        fire("mouseout", { relatedTarget: null });
        expect(box.classList.contains("on")).toBe(false);
    });

    it("toggles the theme and remembers it", () => {
        const btn = el();
        const { env } = load({ byId: { themeBtn: btn } });
        expect(btn.innerHTML).toContain("<circle"); // dark by default: the sun switches to light
        const click = btn.addEventListener.mock.calls.find(([type]) => type === "click")[1];
        const keep = {};
        for (const k of Object.keys(env)) { keep[k] = global[k]; global[k] = env[k]; }
        try { click(); } finally { for (const k of Object.keys(env)) global[k] = keep[k]; }
        expect(env.document.documentElement.getAttribute("data-theme")).toBe("light");
        expect(env.localStorage.setItem).toHaveBeenCalledWith("eh-theme", "light");
        expect(btn.innerHTML).not.toContain("<circle");
    });
});
