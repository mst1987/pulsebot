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
        expect(store.countOpen("u1")).toBe(4);
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
