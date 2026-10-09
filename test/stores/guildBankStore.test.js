const store = require("../../src/stores/guildBankStore");
const { tempStoreFile } = require("../helpers/tempStore");

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

beforeAll(() => store.useFile(tempStoreFile("guild-bank.json")));
afterAll(() => store.useFile(null));
beforeEach(() => {
    for (const r of store.listRequests()) store.removeRequest(r.id);
});

const add = (over = {}, now = NOW) => store.addRequest({ userId: "u1", userName: "Anna", categoryId: "cat1", item: "Super Mana Potion", amount: "10", ...over }, { now });

describe("stores/guildBankStore", () => {
    it("stores an open request with its fields cleaned", () => {
        const { request } = add({ item: "  Super   Mana Potion ", amount: " 12 ", purpose: " BT  Donnerstag " });
        expect(request).toMatchObject({
            userId: "u1", userName: "Anna", categoryId: "cat1", item: "Super Mana Potion", amount: 12, purpose: "BT Donnerstag",
            status: "open", reason: "", createdAt: NOW, handledBy: "", handledAt: 0, channelId: "", messageId: "",
        });
        expect(store.getRequest(request.id)).toEqual(request);
    });

    it("refuses a request without raider, item or a whole amount from 1 to 9999", () => {
        expect(store.addRequest({ item: "x", amount: 1 })).toEqual({ error: "Kein Raider." });
        expect(add({ item: "  " })).toEqual({ error: "Bitte angeben, was du brauchst." });
        for (const amount of ["0", "10000", "1.5", "-3", "zehn", ""]) {
            expect(add({ amount })).toEqual({ error: "Die Menge muss eine ganze Zahl von 1 bis 9999 sein." });
        }
        expect(add({ amount: "9999" }).request.amount).toBe(9999);
        expect(store.parseAmount(" 007 ")).toBe(7);
    });

    it("allows at most five open requests per raider", () => {
        for (let i = 0; i < store.MAX_OPEN; i++) expect(add().request).toBeTruthy();
        expect(add()).toEqual({ error: "Höchstens 5 offene Anfragen – warte, bis die Orga eine erledigt hat." });
        expect(add({ userId: "u2" }).request).toBeTruthy();
        const first = store.listRequests({ userId: "u1" })[0];
        store.resolveRequest(first.id, { status: "done", by: "o1", byName: "Orga" });
        expect(store.listRequests({ userId: "u1", status: "open" })).toHaveLength(4);
        expect(add().request).toBeTruthy();
    });

    it("lists open requests first (oldest first), then the handled ones (newest first), by raider and status", () => {
        const a = add({}, NOW).request;
        const b = add({}, NOW + 1000).request;
        const c = add({ userId: "u2" }, NOW + 2000).request;
        store.resolveRequest(a.id, { status: "done" }, { now: NOW + 5000 });
        store.resolveRequest(c.id, { status: "rejected" }, { now: NOW + 6000 });
        expect(store.listRequests().map((r) => r.id)).toEqual([b.id, c.id, a.id]);
        expect(store.listRequests({ userId: "u1" }).map((r) => r.id)).toEqual([b.id, a.id]);
        expect(store.listRequests({ status: "open" }).map((r) => r.id)).toEqual([b.id]);
    });

    it("remembers the orga post", () => {
        const { request } = add();
        expect(store.setMessage(request.id, { channelId: "900", messageId: "901" })).toMatchObject({ channelId: "900", messageId: "901" });
        expect(store.setMessage("nope", {})).toBeNull();
    });

    it("resolves an open request once: done, or declined with a reason", () => {
        const done = add().request;
        expect(store.resolveRequest(done.id, { status: "done", by: "o1", byName: "Orga", reason: "ignored" }, { now: NOW + 1 }).request)
            .toMatchObject({ status: "done", reason: "", handledBy: "o1", handledByName: "Orga", handledAt: NOW + 1 });
        const again = store.resolveRequest(done.id, { status: "rejected" });
        expect(again.error).toBe("Diese Anfrage ist schon erledigt.");
        expect(again.request.status).toBe("done");

        const declined = add().request;
        expect(store.resolveRequest(declined.id, { status: "rejected", by: "o1", reason: "  nicht   da " }).request)
            .toMatchObject({ status: "rejected", reason: "nicht da" });
        expect(store.resolveRequest("nope", { status: "done" })).toEqual({ error: "Anfrage nicht gefunden." });
        expect(store.resolveRequest(declined.id, { status: "open" })).toEqual({ error: "Unbekannter Status." });
    });

    describe("a request from the stock (#633)", () => {
        const stock = (over = {}, now = NOW) => add({
            item: "Klobiger lebendiger Rubin", amount: "2", bankKey: "tbc:x:y", itemId: 32193, icon: "inv_gem", group: "Edelsteine",
            characterName: "Zibbo", realm: "Spineshatter", faction: "Alliance", ...over,
        }, now).request;

        it("keeps the stock fields and the recipient", () => {
            expect(stock()).toMatchObject({
                bankKey: "tbc:x:y", itemId: 32193, icon: "inv_gem", group: "Edelsteine", characterName: "Zibbo", realm: "Spineshatter",
                faction: "Alliance", handedOutBy: "", handedOutAt: 0, handoutVia: "",
            });
            expect(add().request).toMatchObject({ bankKey: "", itemId: 0, characterName: "", handoutVia: "" });
        });

        it("goes open → confirmed → handedOut, and confirmed → open again", () => {
            const r = stock();
            expect(store.confirmRequest(r.id, { by: "o1", byName: "Arthas" }, { now: NOW + 1 }).request)
                .toMatchObject({ status: "confirmed", handledBy: "o1", handledByName: "Arthas", handledAt: NOW + 1 });
            expect(store.confirmRequest(r.id, {})).toMatchObject({ error: "Diese Anfrage ist schon vorgemerkt.", request: { status: "confirmed" } });
            expect(store.releaseRequest(r.id).request).toMatchObject({ status: "open", handledBy: "", handledByName: "", handledAt: 0 });
            expect(store.releaseRequest(r.id)).toMatchObject({ error: "Diese Anfrage ist noch nicht vorgemerkt." });
            expect(store.handOutRequest(r.id, {})).toMatchObject({ error: "Diese Anfrage ist noch nicht vorgemerkt." });
            store.confirmRequest(r.id, { by: "o1", byName: "Arthas" });
            expect(store.handOutRequest(r.id, { by: "o2", byName: "Jaina", via: "mail" }, { now: NOW + 5 }).request).toMatchObject({
                status: "handedOut", handedOutBy: "o2", handedOutByName: "Jaina", handedOutAt: NOW + 5, handoutVia: "mail", handledByName: "Arthas",
            });
            // a second report of the same hand-out is refused with the request (the addon ignores it)
            expect(store.handOutRequest(r.id, { via: "manual" })).toMatchObject({ error: "Diese Anfrage ist schon ausgegeben.", request: { handoutVia: "mail" } });
            expect(store.handOutRequest("nope")).toEqual({ error: "Anfrage nicht gefunden." });
        });

        it("hands out by the orga's button unless a known way is given", () => {
            const r = stock();
            store.confirmRequest(r.id, {});
            expect(store.handOutRequest(r.id, { via: "carrier pigeon" }).request.handoutVia).toBe("discord");
        });

        it("is never just 'done', but may be declined; a free-text request has no confirmation", () => {
            const r = stock();
            expect(store.resolveRequest(r.id, { status: "done" })).toMatchObject({ error: "Diese Anfrage ist noch nicht vorgemerkt.", request: { status: "open" } });
            expect(store.resolveRequest(r.id, { status: "rejected", reason: "leer" }).request).toMatchObject({ status: "rejected", reason: "leer" });
            const free = add().request;
            expect(store.confirmRequest(free.id, {})).toMatchObject({ error: "Diese Anfrage ist keine aus dem Bestand." });
            const done = add().request;
            store.resolveRequest(done.id, { status: "done" });
            expect(store.releaseRequest(done.id)).toMatchObject({ error: "Diese Anfrage ist keine aus dem Bestand." });
        });

        it("lists open before confirmed before handled", () => {
            const a = stock({}, NOW);
            const b = stock({}, NOW + 1);
            const c = stock({}, NOW + 2);
            store.confirmRequest(a.id, {});
            store.resolveRequest(c.id, { status: "rejected" });
            expect(store.listRequests().map((r) => r.id)).toEqual([b.id, a.id, c.id]);
        });
    });

    it("renames the pending requests of a stocked item, never handled or free-text ones", () => {
        const add = (userId, over = {}) => store.addRequest({ userId, item: "Klobiger lebendiger Rubin", amount: 1, bankKey: "tbc:x:y", itemId: 24027, ...over }, { now: 1 }).request.id;
        const open = add("u1");
        const confirmed = add("u2");
        store.confirmRequest(confirmed, { by: "o" }, { now: 2 });
        const handed = add("u3");
        store.confirmRequest(handed, { by: "o" }, { now: 2 });
        store.handOutRequest(handed, { by: "o" }, { now: 3 });
        const free = add("u4", { bankKey: "", itemId: 0 });
        const otherBank = add("u5", { bankKey: "tbc:a:b" });

        expect(store.renamePendingItem({ bankKeys: ["tbc:x:y"], itemId: 24027, name: "  Bold   Living Ruby " }).sort()).toEqual([open, confirmed].sort());
        const item = (id) => store.getRequest(id).item;
        expect([item(open), item(confirmed), item(handed), item(free), item(otherBank)])
            .toEqual(["Bold Living Ruby", "Bold Living Ruby", "Klobiger lebendiger Rubin", "Klobiger lebendiger Rubin", "Klobiger lebendiger Rubin"]);
        expect(store.renamePendingItem({ bankKeys: ["tbc:x:y"], itemId: 24027, name: "Bold Living Ruby" })).toEqual([]);
        expect(store.renamePendingItem({ bankKeys: [], itemId: 24027, name: "X" })).toEqual([]);
        expect(store.renamePendingItem({ bankKeys: ["tbc:x:y"], itemId: 0, name: "X" })).toEqual([]);
        expect(store.renamePendingItem({ bankKeys: ["tbc:x:y"], itemId: 24027, name: " " })).toEqual([]);
        expect(store.renamePendingItem()).toEqual([]);
    });

    it("removes a request", () => {
        const { request } = add();
        expect(store.removeRequest(request.id).id).toBe(request.id);
        expect(store.removeRequest(request.id)).toBeNull();
        expect(store.getRequest(request.id)).toBeNull();
    });

    it("prunes handled requests after 90 days and keeps open ones", () => {
        const old = add({}, NOW - 200 * DAY).request;
        const handledLongAgo = add({}, NOW - 200 * DAY).request;
        const handledRecently = add({}, NOW - 200 * DAY).request;
        store.resolveRequest(handledLongAgo.id, { status: "done" }, { now: NOW - 91 * DAY });
        store.resolveRequest(handledRecently.id, { status: "rejected" }, { now: NOW - 10 * DAY });
        expect(store.prune({ now: NOW })).toBe(1);
        expect(store.listRequests().map((r) => r.id).sort()).toEqual([old.id, handledRecently.id].sort());
        expect(store.prune({ now: NOW })).toBe(0);
    });
});
