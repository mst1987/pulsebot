// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => require("../../helpers/memoryFs").memoryFs());
jest.mock("../../../src/utils/loot/wowhead");

const fs = require("fs");
const wowhead = require("../../../src/utils/loot/wowhead");
const {
    listPending, getPending, upsertPending, resolvePending, resolutionFor, noteAppended, listLinked, unlinkEvent,
    restorePending, repairItemNames,
} = require("../../../src/stores/loot/lootInboxStore.js");

beforeEach(() => {
    fs.__store.clear();
});

const item = (over = {}) => ({
    source: "gargul", rawId: "c1", itemId: 100, itemName: "Thing",
    player: "Foo-Thunderstrike", character: "Foo", characterKey: "foo",
    awardedAt: 1000, ...over,
});

const session = (over = {}) => ({
    sessionId: "s1", startedAt: 1000, endedAt: 2000, instance: "Serpentshrine Cavern",
    items: [item()], ...over,
});

describe("stores/loot/lootInboxStore", () => {
    describe("upsertPending", () => {
        it("creates an entry carrying the upload's own metadata", () => {
            const { entry, added, created } = upsertPending(session(), {
                realm: "Thunderstrike", reporter: "Lead-Thunderstrike", tokenName: "Raidlead-PC",
            });
            expect(created).toBe(true);
            expect(added).toBe(1);
            expect(entry).toMatchObject({
                sessionId: "s1", instance: "Serpentshrine Cavern", itemCount: 1,
                realm: "Thunderstrike", reporter: "Lead-Thunderstrike", tokenName: "Raidlead-PC",
            });
            expect(listPending().length).toBe(1);
        });

        // #994: the card remembers the server of the upload key.
        it("stores the upload key's server, empty for a key without one", () => {
            expect(upsertPending(session(), { guildId: "gA" }).entry.guildId).toBe("gA");
            expect(upsertPending(session({ sessionId: "s2" })).entry.guildId).toBe("");
        });

        it("fills the server in on a re-upload once the key has one", () => {
            upsertPending(session());
            expect(upsertPending(session(), { guildId: "gB" }).entry.guildId).toBe("gB");
            expect(upsertPending(session()).entry.guildId).toBe("gB");
        });

        // The sync tool re-uploads the whole raid on every flush, so this is the
        // normal case, not an edge case.
        it("merges a re-upload into the same entry instead of adding a second card", () => {
            upsertPending(session());
            const { entry, added, created } = upsertPending(session({
                items: [item(), item({ rawId: "c2" })],
            }));
            expect(created).toBe(false);
            expect(added).toBe(1);
            expect(entry.itemCount).toBe(2);
            expect(listPending().length).toBe(1);
        });

        it("never double-counts an award already in the entry", () => {
            upsertPending(session());
            const { added, entry } = upsertPending(session());
            expect(added).toBe(0);
            expect(entry.itemCount).toBe(1);
        });

        // A Gargul row and an RCLootcouncil row can share a rawId by coincidence
        // — the source is part of the key, so both must survive.
        it("keys items by source and rawId together", () => {
            upsertPending(session());
            const { entry } = upsertPending(session({
                items: [item({ source: "rclc" })],
            }));
            expect(entry.itemCount).toBe(2);
        });

        it("extends the end time as a running raid reports a later one", () => {
            upsertPending(session());
            const { entry } = upsertPending(session({ endedAt: 9000 }));
            expect(entry.endedAt).toBe(9000);
        });

        it("keeps an earlier end time when a later upload reports none", () => {
            upsertPending(session());
            const { entry } = upsertPending(session({ endedAt: 0 }));
            expect(entry.endedAt).toBe(2000);
        });

        // An event created after the first upload has to be found eventually.
        it("refreshes the suggested match on every upload", () => {
            upsertPending(session(), { match: null });
            const { entry } = upsertPending(session(), {
                match: { suggested: { eventId: "e1", eventLabel: "SSC" }, ambiguous: false, candidates: [] },
            });
            expect(entry.match.suggested.eventId).toBe("e1");
        });

        it("keeps separate sessions apart", () => {
            upsertPending(session());
            upsertPending(session({ sessionId: "s2" }));
            expect(listPending().length).toBe(2);
        });
    });

    describe("repairItemNames", () => {
        const bare = (over = {}) => item({ itemIconUrl: "", itemQuality: null, itemLink: "https://www.wowhead.com/forever/item=100", ...over });

        beforeEach(() => {
            wowhead.lookupItem.mockReset();
            wowhead.lookupItem.mockResolvedValue({ name: "Thing", iconUrl: "thing.jpg", quality: 4 });
        });

        it("fills icon, quality and link from the section of the version the card names", async () => {
            const { entry } = upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            expect(await repairItemNames()).toBe(1);
            expect(wowhead.lookupItem).toHaveBeenCalledWith(100, { path: "tbc" });
            expect(getPending(entry.id).items[0]).toMatchObject({
                itemName: "Thing", itemIconUrl: "thing.jpg", itemQuality: 4, itemLink: "https://www.wowhead.com/tbc/item=100",
            });
        });

        it("asks nothing for a card that has everything, and repairs nothing twice", async () => {
            upsertPending(session({ items: [item({ itemIconUrl: "a.jpg", itemQuality: 4 })] }), { gameVersion: "tbc" });
            expect(await repairItemNames()).toBe(0);
            expect(wowhead.lookupItem).not.toHaveBeenCalled();
            upsertPending(session({ sessionId: "s2", items: [bare({ rawId: "c2" })] }), { gameVersion: "tbc" });
            expect(await repairItemNames()).toBe(1);
            expect(await repairItemNames()).toBe(0);
        });

        it("repairs a dismissed card too, it can come back", async () => {
            const { entry } = upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            resolvePending(entry.id, "dismissed");
            expect(await repairItemNames()).toBe(1);
            expect(restorePending(entry.id).items[0].itemIconUrl).toBe("thing.jpg");
        });

        // The lookups await: what happens meanwhile must survive.
        it("keeps a row uploaded and a card filed during the lookups", async () => {
            const { entry } = upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            const filed = upsertPending(session({ sessionId: "s2", items: [bare({ rawId: "c2" })] }), { gameVersion: "tbc" }).entry;
            let release;
            wowhead.lookupItem.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ name: "Thing", iconUrl: "thing.jpg", quality: 4 }); }));
            const running = repairItemNames();
            upsertPending(session({ items: [bare({ rawId: "late" })] }));
            resolvePending(filed.id, "accepted", { eventId: "e1" });
            release();
            await running;
            const rows = getPending(entry.id).items;
            expect(rows.map((r) => r.rawId)).toEqual(["c1", "late"]);
            expect(rows[0].itemIconUrl).toBe("thing.jpg");
            expect(getPending(filed.id)).toBeNull();
        });

        it("fills a card dismissed or restored during the lookups where it is now", async () => {
            const gone = upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" }).entry;
            const back = upsertPending(session({ sessionId: "s2", items: [bare({ rawId: "c2" })] }), { gameVersion: "tbc" }).entry;
            resolvePending(back.id, "dismissed");
            let release;
            wowhead.lookupItem.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ name: "Thing", iconUrl: "thing.jpg", quality: 4 }); }));
            const running = repairItemNames();
            resolvePending(gone.id, "dismissed");
            restorePending(back.id);
            release();
            expect(await running).toBe(2);
            expect(getPending(back.id).items[0].itemIconUrl).toBe("thing.jpg");
            expect(restorePending(gone.id).items[0].itemIconUrl).toBe("thing.jpg");
        });

        it("runs again after a run that failed", async () => {
            const { entry } = upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            const now = 5 * 60 * 60 * 1000;
            wowhead.lookupItem.mockRejectedValueOnce(new Error("wowhead down"));
            await expect(repairItemNames(now)).rejects.toThrow("wowhead down");
            expect(await repairItemNames(now + 60 * 60 * 1000)).toBe(1);
            expect(getPending(entry.id).items[0].itemIconUrl).toBe("thing.jpg");
        });

        it("answers a call during a run with that run", async () => {
            upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            let release;
            wowhead.lookupItem.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ name: "Thing", iconUrl: "thing.jpg", quality: 4 }); }));
            const first = repairItemNames();
            const second = repairItemNames();
            release();
            expect(await first).toBe(1);
            expect(await second).toBe(1);
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(1);
        });

        it("asks once per version, however many cards lack the same item", async () => {
            upsertPending(session({ items: [bare()] }), { gameVersion: "tbc" });
            upsertPending(session({ sessionId: "s2", items: [bare({ rawId: "c2" })] }), { gameVersion: "tbc" });
            expect(await repairItemNames()).toBe(2);
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(1);
        });

        // Wowhead not knowing an item must not cost a lookup on every page view.
        it("leaves a row Wowhead does not know as it is and rests before asking again", async () => {
            wowhead.lookupItem.mockResolvedValue(null);
            const now = 5 * 60 * 60 * 1000;
            const { entry } = upsertPending(session({ items: [bare({ itemLink: "https://www.wowhead.com/tbc/item=100" })] }), { gameVersion: "tbc" });
            expect(await repairItemNames(now)).toBe(0);
            expect(getPending(entry.id).items[0].itemIconUrl).toBe("");
            expect(await repairItemNames(now + 1000)).toBe(0);
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(1);
            await repairItemNames(now + 60 * 60 * 1000);
            expect(wowhead.lookupItem).toHaveBeenCalledTimes(2);
        });
    });

    describe("listPending", () => {
        it("sorts newest raid first", () => {
            upsertPending(session({ sessionId: "old", startedAt: 1000 }));
            upsertPending(session({ sessionId: "new", startedAt: 5000 }));
            expect(listPending().map((s) => s.sessionId)).toEqual(["new", "old"]);
        });

        it("is empty before anything was uploaded", () => {
            expect(listPending()).toEqual([]);
            expect(listPending().length).toBe(0);
        });
    });

    describe("getPending", () => {
        it("finds an entry by its inbox id, else null", () => {
            const { entry } = upsertPending(session());
            expect(getPending(entry.id).sessionId).toBe("s1");
            expect(getPending("nope")).toBeNull();
            expect(getPending("")).toBeNull();
        });
    });

    describe("resolvePending", () => {
        it("takes an accepted session out of the inbox and remembers where it went", () => {
            const { entry } = upsertPending(session());
            const removed = resolvePending(entry.id, "accepted", {
                eventId: "e1", eventLabel: "SSC", categoryId: "cat1",
            });
            expect(removed.sessionId).toBe("s1");
            expect(listPending().length).toBe(0);
            expect(resolutionFor("s1")).toMatchObject({
                action: "accepted", eventId: "e1", eventLabel: "SSC", categoryId: "cat1",
            });
        });

        it("remembers a dismissal so the session cannot come back", () => {
            const { entry } = upsertPending(session());
            resolvePending(entry.id, "dismissed");
            expect(resolutionFor("s1")).toMatchObject({ action: "dismissed" });
        });

        it("returns null for an unknown id", () => {
            expect(resolvePending("nope", "dismissed")).toBeNull();
        });

        // The uploader consults resolutionFor() to decide whether a session
        // skips the inbox — a stale "dismissed" would silently swallow a raid
        // the admin later decided to keep.
        it("lets the newest decision win when a session is resolved twice", () => {
            const first = upsertPending(session());
            resolvePending(first.entry.id, "dismissed");
            const second = upsertPending(session());
            resolvePending(second.entry.id, "accepted", { eventId: "e2", eventLabel: "TK" });
            expect(resolutionFor("s1")).toMatchObject({ action: "accepted", eventId: "e2" });
        });
    });

    describe("resolutionFor", () => {
        it("is null for a session nobody decided on", () => {
            expect(resolutionFor("never-seen")).toBeNull();
            expect(resolutionFor("")).toBeNull();
        });
    });

    // The quiet "Verknüpft" list under the inbox cards.
    describe("listLinked / noteAppended", () => {
        it("lists accepted sessions with raid, start and item count, newest first", () => {
            const a = upsertPending(session({ sessionId: "a", startedAt: 1000 }));
            resolvePending(a.entry.id, "accepted", { eventId: "e1", eventLabel: "Montag", contentLabel: "SSC" });
            const b = upsertPending(session({ sessionId: "b", startedAt: 5000 }));
            resolvePending(b.entry.id, "accepted", { eventId: "e2", eventLabel: "Donnerstag", contentLabel: "BT" });
            const linked = listLinked();
            expect(linked.map((l) => l.sessionId)).toEqual(["b", "a"]);
            expect(linked[1]).toMatchObject({
                eventId: "e1", eventLabel: "Montag", contentLabel: "SSC", startedAt: 1000, itemCount: 1, appended: 0,
            });
        });

        it("leaves dismissed sessions out, also when an older accept exists", () => {
            const first = upsertPending(session());
            resolvePending(first.entry.id, "accepted", { eventId: "e1" });
            const second = upsertPending(session());
            resolvePending(second.entry.id, "dismissed");
            expect(listLinked()).toEqual([]);
        });

        it("counts what later uploads appended to an accepted session", () => {
            const { entry } = upsertPending(session());
            resolvePending(entry.id, "accepted", { eventId: "e1" });
            expect(noteAppended("s1", 4)).toBe(true);
            expect(noteAppended("s1", 2)).toBe(true);
            expect(listLinked()[0].appended).toBe(6);
        });

        it("does not count onto an unknown or dismissed session, nor nothing", () => {
            const { entry } = upsertPending(session());
            resolvePending(entry.id, "dismissed");
            expect(noteAppended("s1", 3)).toBe(false);
            expect(noteAppended("nope", 3)).toBe(false);
            expect(noteAppended("s1", 0)).toBe(false);
        });

        it("caps the list", () => {
            for (let i = 0; i < 4; i += 1) {
                const { entry } = upsertPending(session({ sessionId: `s${i}` }));
                resolvePending(entry.id, "accepted", { eventId: `e${i}` });
            }
            expect(listLinked(2)).toHaveLength(2);
        });
    });

    // Clearing an event's loot unlinks its sessions: otherwise the next upload
    // appends the whole raid straight back into the event that was emptied.
    describe("unlinkEvent", () => {
        it("forgets the sessions accepted into the event, so the next upload is a new card", () => {
            const a = upsertPending(session({ sessionId: "a" }));
            resolvePending(a.entry.id, "accepted", { eventId: "e1" });
            const b = upsertPending(session({ sessionId: "b" }));
            resolvePending(b.entry.id, "accepted", { eventId: "e2" });

            expect(unlinkEvent("e1")).toBe(1);
            expect(resolutionFor("a")).toBeNull();
            expect(resolutionFor("b")).toMatchObject({ action: "accepted", eventId: "e2" });
            expect(upsertPending(session({ sessionId: "a" })).created).toBe(true);
        });

        // An older dismissal must not take over once the accept is forgotten —
        // the session would then vanish instead of returning to the inbox.
        it("drops every decision of an unlinked session, not just the accept", () => {
            const first = upsertPending(session());
            resolvePending(first.entry.id, "dismissed");
            const second = upsertPending(session());
            resolvePending(second.entry.id, "accepted", { eventId: "e1" });
            expect(unlinkEvent("e1")).toBe(1);
            expect(resolutionFor("s1")).toBeNull();
        });

        it("leaves a session alone whose last decision went elsewhere", () => {
            const first = upsertPending(session());
            resolvePending(first.entry.id, "accepted", { eventId: "e1" });
            const second = upsertPending(session());
            resolvePending(second.entry.id, "dismissed");
            expect(unlinkEvent("e1")).toBe(0);
            expect(resolutionFor("s1")).toMatchObject({ action: "dismissed" });
        });

        it("does nothing for an unknown or blank event and writes nothing", () => {
            const { entry } = upsertPending(session());
            resolvePending(entry.id, "accepted", { eventId: "e1" });
            fs.writeFileSync.mockClear();
            expect(unlinkEvent("nope")).toBe(0);
            expect(unlinkEvent("")).toBe(0);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });
    });
});

describe("stores/loot/lootInboxStore per server (#919)", () => {
    it("remembers the server an accepted session went to, else none", () => {
        const first = upsertPending(session());
        resolvePending(first.entry.id, "accepted", { eventId: "e1", guildId: "gB" });
        expect(resolutionFor("s1").guildId).toBe("gB");
        const second = upsertPending(session({ sessionId: "s2" }));
        resolvePending(second.entry.id, "accepted", { eventId: "e2" });
        expect(resolutionFor("s2").guildId).toBe("");
    });
});

// #1002: waiting uploads, first accept wins, dismissed uploads kept 14 days.
describe("stores/lootInboxStore - waiting and dismissed", () => {
    const store = require("../../../src/stores/loot/lootInboxStore.js");
    const DAY = 24 * 60 * 60 * 1000;

    it("stores the game version and the waiting servers, deduplicated", () => {
        const { entry } = store.upsertPending(session(), { gameVersion: "tbc", waiting: true, servers: ["gA", "gB", "gA", ""] });
        expect(entry).toMatchObject({ gameVersion: "tbc", waiting: true, servers: ["gA", "gB"] });
        const plain = store.upsertPending(session({ sessionId: "s2" }), {}).entry;
        expect(plain).toMatchObject({ gameVersion: "", waiting: false, servers: [] });
    });

    it("updates the waiting state when the same session comes again", () => {
        store.upsertPending(session(), { gameVersion: "tbc", waiting: true, servers: ["gA", "gB"] });
        const again = store.upsertPending(session({ items: [item(), item({ rawId: "c2" })] }), { waiting: false, guildId: "gA" });
        expect(again.created).toBe(false);
        expect(store.getPending(again.entry.id)).toMatchObject({ waiting: false, servers: [] });
    });

    it("remembers the decision by inbox id for a second assign", () => {
        const { entry } = store.upsertPending(session());
        expect(store.resolvedById(entry.id)).toBeNull();
        store.resolvePending(entry.id, "accepted", { eventId: "e1", guildId: "gA" });
        expect(store.resolvedById(entry.id)).toMatchObject({ action: "accepted", eventId: "e1", guildId: "gA" });
        expect(store.resolvePending(entry.id, "accepted", { eventId: "e2" })).toBeNull();
        expect(store.resolvedById("")).toBeNull();
    });

    it("keeps a dismissed upload with who dismissed it and brings it back", () => {
        const { entry } = store.upsertPending(session(), { waiting: true, servers: ["gA"] });
        store.resolvePending(entry.id, "dismissed", { by: "Admin" });
        expect(store.listPending()).toHaveLength(0);
        expect(store.listDismissed()).toHaveLength(1);
        expect(store.getDismissed(entry.id)).toMatchObject({ dismissedBy: "Admin", waiting: true });
        expect(store.getDismissed("nope")).toBeNull();

        const back = store.restorePending(entry.id);
        expect(back).toMatchObject({ id: entry.id, waiting: true, servers: ["gA"] });
        expect(back.dismissedAt).toBeUndefined();
        expect(store.listPending()).toHaveLength(1);
        expect(store.listDismissed()).toHaveLength(0);
        expect(store.resolutionFor("s1")).toBeNull();
        expect(store.restorePending(entry.id)).toBeNull();
    });

    it("sorts dismissed uploads newest first", () => {
        const spy = jest.spyOn(Date, "now");
        spy.mockReturnValue(1000);
        const a = store.upsertPending(session()).entry;
        store.resolvePending(a.id, "dismissed");
        spy.mockReturnValue(5000);
        const b = store.upsertPending(session({ sessionId: "s2" })).entry;
        store.resolvePending(b.id, "dismissed");
        expect(store.listDismissed(6000).map((d) => d.sessionId)).toEqual(["s2", "s1"]);
        spy.mockRestore();
    });

    it("forgets dismissed uploads after 14 days", () => {
        const { entry } = store.upsertPending(session());
        store.resolvePending(entry.id, "dismissed");
        const at = store.getDismissed(entry.id).dismissedAt;
        expect(store.DISMISS_KEEP_MS).toBe(14 * DAY);
        expect(store.listDismissed(at + 13 * DAY)).toHaveLength(1);
        expect(store.listDismissed(at + 15 * DAY)).toHaveLength(0);
        expect(store.pruneDismissed(at + 13 * DAY)).toBe(0);
        expect(store.pruneDismissed(at + 15 * DAY)).toBe(1);
        expect(store.listDismissed(at)).toHaveLength(0);
    });

    it("cannot restore a dismissal older than 14 days", () => {
        const spy = jest.spyOn(Date, "now").mockReturnValue(1000);
        const { entry } = store.upsertPending(session());
        store.resolvePending(entry.id, "dismissed");
        spy.mockReturnValue(1000 + 15 * DAY);
        expect(store.restorePending(entry.id)).toBeNull();
        spy.mockRestore();
    });
});
