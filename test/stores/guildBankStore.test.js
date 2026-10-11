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

    describe("the waiting list (#775)", () => {
        const KEY = "tbc:spineshatter:die gilde";
        const wait = (over = {}, now = NOW) => store.addWaiting({
            userId: "u1", userName: "Anna", bankKey: KEY, itemId: 32470, item: "Crimson Spinal", amount: 3, ...over,
        }, { now });

        it("puts entries at the end of their item's list; never pruned", () => {
            const a = wait().request;
            const b = wait({ userId: "u2" }, NOW + 1).request;
            const other = wait({ itemId: 32471 }, NOW + 2).request;
            expect(a).toMatchObject({ status: "waiting", queueRank: 1, fromWaitlist: false, amount: 3 });
            expect([b.queueRank, other.queueRank]).toEqual([2, 1]);
            expect(store.waitingQueue(KEY, 32470).map((r) => r.id)).toEqual([a.id, b.id]);
            expect(store.waitingQueue(KEY).map((r) => r.id)).toEqual([a.id, b.id, other.id]);
            expect(store.waitingQueue("")).toEqual([]);
            expect(store.PENDING_STATUSES).toContain("waiting");
            expect(store.prune({ now: NOW + 400 * DAY })).toBe(0);
            // open first, then the waiting entries by their place
            const open = add({}, NOW + 3).request;
            expect(store.listRequests().map((r) => r.id)).toEqual([open.id, a.id, other.id, b.id]);
            expect(store.waitingCount("u1")).toBe(2);
            expect(store.openCount("u1")).toBe(1);
            expect([store.waitingCount(""), store.openCount("")]).toEqual([0, 0]);
        });

        it("checks the entry: a raider or a character, an item of the stock, the amount, MAX_WAITING for raiders", () => {
            expect(store.addWaiting({ bankKey: KEY, itemId: 1, item: "x", amount: 1 })).toEqual({ error: "Kein Raider und kein Charakter." });
            expect(wait({ itemId: 0 })).toEqual({ error: "Nur Gegenstände aus dem Bestand haben eine Warteliste." });
            expect(wait({ amount: "0" })).toEqual({ error: "Die Menge muss eine ganze Zahl von 1 bis 9999 sein." });
            for (let i = 0; i < store.MAX_WAITING; i++) expect(wait().request).toBeTruthy();
            expect(wait()).toEqual({ error: "Höchstens 10 Einträge auf der Warteliste – warte, bis einer drankommt." });
            // the orga's entries are not limited
            expect(wait({ addedBy: "o1", addedByName: "Orga" }).request).toMatchObject({ addedBy: "o1", addedByName: "Orga" });
        });

        it("keeps an entry with a character name alone (imported by the orga) — also across a reload", () => {
            const { request } = wait({ userId: "", userName: "", characterName: "Alîna", addedBy: "web" });
            expect(request).toMatchObject({ userId: "", userName: "Alîna", characterName: "Alîna" });
            expect(store.getRequest(request.id)).toMatchObject({ characterName: "Alîna" });
        });

        it("moves an entry up: all of it turns open, a part leaves the rest at the same place", () => {
            const a = wait().request;
            const b = wait({ userId: "u2", amount: 1 }, NOW + 1).request;
            const part = store.promoteWaiting(a.id, 2, { now: NOW + 5 });
            expect(part.request).toMatchObject({ status: "open", amount: 2, fromWaitlist: true, queueRank: 0, createdAt: NOW + 5, userId: "u1" });
            expect(part.request.id).not.toBe(a.id);
            expect(part.rest).toMatchObject({ id: a.id, status: "waiting", amount: 1, queueRank: 1, createdAt: NOW });
            const all = store.promoteWaiting(a.id, 5, { now: NOW + 6 });
            expect(all).toEqual({ request: expect.objectContaining({ id: a.id, status: "open", amount: 1, fromWaitlist: true }), rest: null });
            expect(store.promoteWaiting(a.id, 1)).toEqual({ error: "Kein Eintrag der Warteliste." });
            expect(store.promoteWaiting(b.id, 0)).toEqual({ error: "Nichts zu verteilen." });
            expect(store.waitingQueue(KEY).map((r) => r.id)).toEqual([b.id]);
        });

        it("reorders an item's list and removes entries", () => {
            const a = wait().request;
            const b = wait({}, NOW + 1).request;
            const c = wait({}, NOW + 2).request;
            const order = () => store.waitingQueue(KEY).map((r) => r.id);
            expect(store.moveWaiting(c.id, "up").request.id).toBe(c.id);
            expect(order()).toEqual([a.id, c.id, b.id]);
            store.moveWaiting(a.id, "down");
            expect(order()).toEqual([c.id, a.id, b.id]);
            // the first up and the last down stay
            store.moveWaiting(c.id, "up");
            store.moveWaiting(b.id, "down");
            expect(order()).toEqual([c.id, a.id, b.id]);
            expect(store.moveWaiting(a.id, "sideways")).toEqual({ error: "Unbekannte Richtung." });
            expect(store.moveWaiting("nope", "up")).toEqual({ error: "Kein Eintrag der Warteliste." });
            expect(store.removeWaiting(a.id).id).toBe(a.id);
            expect(order()).toEqual([c.id, b.id]);
            const open = add().request;
            expect(store.removeWaiting(open.id)).toBeNull();
            expect(store.removeWaiting("nope")).toBeNull();
        });
    });
});

describe("stores/guildBankStore — setRecipient (linking a character)", () => {
    beforeEach(() => {
        for (const r of store.listRequests()) store.removeRequest(r.id);
    });

    it("gives a waiting, open or confirmed request a new raider and character", () => {
        const waiting = store.addWaiting({ characterName: "Whapap", item: "Spinel", amount: 1, bankKey: "k", itemId: 5, addedBy: "o1" }).request;
        expect(waiting).toMatchObject({ userId: "", userName: "Whapap" });
        const linked = store.setRecipient(waiting.id, { userId: "u7", userName: "Wha", characterName: "Whapâp", realm: "Spineshatter" });
        expect(linked.request).toMatchObject({ userId: "u7", userName: "Wha", characterName: "Whapâp", realm: "Spineshatter", status: "waiting" });
        const open = add({ bankKey: "k", itemId: 5, characterName: "" }).request;
        expect(store.setRecipient(open.id, { userId: "u1", characterName: "Zibbo" }).request).toMatchObject({ userName: "Zibbo", characterName: "Zibbo" });
        store.confirmRequest(open.id, {});
        expect(store.setRecipient(open.id, { userId: "u2", userName: "Bert", characterName: "Bertie" }).request).toMatchObject({ status: "confirmed", userId: "u2" });
    });

    it("refuses a handled request, an unknown one and an empty pick", () => {
        const r = add({ bankKey: "k", itemId: 5 }).request;
        store.confirmRequest(r.id, {});
        store.handOutRequest(r.id, {});
        expect(store.setRecipient(r.id, { userId: "u2", characterName: "X" })).toMatchObject({ error: "Diese Anfrage ist schon erledigt.", request: { userId: "u1" } });
        expect(store.setRecipient("nope", { userId: "u2", characterName: "X" })).toEqual({ error: "Anfrage nicht gefunden." });
        expect(store.setRecipient(r.id, { userId: "", characterName: "X" })).toEqual({ error: "Kein Raider und kein Charakter." });
        expect(store.setRecipient(r.id, { userId: "u2", characterName: " " })).toEqual({ error: "Kein Raider und kein Charakter." });
    });
});
