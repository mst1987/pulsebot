// In-memory fs so the store never touches the repo disk.
jest.mock("fs", () => {
    const store = new Map();
    const enoent = (p) => {
        const e = new Error(`ENOENT: no such file '${p}'`);
        e.code = "ENOENT";
        return e;
    };
    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => { store.set(p, String(data)); }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
    };
});

const fs = require("fs");
const {
    listPending, getPending, upsertPending, resolvePending, resolutionFor, pendingCount,
} = require("../../src/web/lootInboxStore.js");

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

describe("web/lootInboxStore", () => {
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
            expect(pendingCount()).toBe(1);
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
            expect(pendingCount()).toBe(1);
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
            expect(pendingCount()).toBe(2);
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
            expect(pendingCount()).toBe(0);
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
            expect(pendingCount()).toBe(0);
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
});
