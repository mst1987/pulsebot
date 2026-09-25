// The raid plan store (src/web/raidplanStore.js): bosses of an event, strict
// validation of a save, version check, publishing and the room-map files.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../helpers/tempStore");
const store = require("../../src/web/raidplanStore");

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);

const BOSS = "bt/supremus";
const CTX = { bossKeys: ["bt/supremus", "bt/shade-of-akama"], allowedUserIds: ["u1", "u2", "u3"], profileIds: ["p1"], userId: "orga" };

beforeEach(() => store.useFile(tempStoreFile("raidplans.json")));
afterAll(() => store.useFile());

describe("bosses of an event", () => {
    it("lists the bosses of every instance in raid order with a stable key and an icon", () => {
        const list = store.bossesForInstances(["bt"]);
        // "Allgemein" first, then the bosses in raid order, then the trash
        expect(list[0]).toMatchObject({ key: "general", general: true });
        expect(list[1]).toMatchObject({ key: "bt/high-warlord-najentus", instanceId: "bt", name: "High Warlord Naj'entus" });
        expect(list[list.length - 1]).toMatchObject({ key: "bt/trash", trash: true });
        expect(list.map((b) => b.key)).toContain("bt/illidan-stormrage");
        expect(list.find((b) => b.key === BOSS).iconUrl).toBe("/bosses/602.jpg");
        // an encounter WCL does not list falls back to the instance icon
        expect(list.find((b) => b.key === "bt/reliquary-of-the-lost").iconUrl).toMatch(/^https:\/\/wow\.zamimg\.com/);
    });

    it("knows nothing for unknown or missing instances and never repeats a boss", () => {
        expect(store.bossesForInstances(["nope"])).toEqual([]);
        expect(store.bossesForInstances(undefined)).toEqual([]);
        expect(store.bossesForInstances(["bt", "bt"])).toHaveLength(store.bossesForInstances(["bt"]).length);
    });

    it("accepts only known instance ids and boss keys as a map key", () => {
        expect(store.isMapKey("bt")).toBe(true);
        expect(store.isMapKey(BOSS)).toBe(true);
        for (const bad of ["", "nope", "bt/nope", "../etc/passwd", "bt/../x", "bt/supremus/x", "BT"]) expect(store.isMapKey(bad)).toBe(false);
    });
});

describe("saving a plan", () => {
    it("starts empty, creates the plan on the first save and bumps the version", () => {
        expect(store.getPlan("e1")).toBeNull();
        expect(store.emptyPlan("e1")).toMatchObject({ version: 0, status: "draft", publicToken: "", bosses: {} });
        const r = store.savePlan("e1", { version: 0, bosses: { [BOSS]: { tokens: [{ userId: "u1", x: 0.25, y: 0.5 }], targets: [], notes: "" } } }, CTX);
        expect(r.plan.version).toBe(1);
        expect(store.getPlan("e1").bosses[BOSS].tokens).toMatchObject([{ userId: "u1", x: 0.25, y: 0.5, opacity: 1 }]);
        expect(store.getPlan("e1")).toMatchObject({ updatedBy: "orga" });
    });

    it("refuses a save made on an old version", () => {
        store.savePlan("e1", { version: 0, bosses: {} }, CTX);
        const r = store.savePlan("e1", { version: 0, bosses: {} }, CTX);
        expect(r.code).toBe("conflict");
        expect(store.getPlan("e1").version).toBe(1);
        expect(store.savePlan("e1", { version: 1, bosses: {} }, CTX).plan.version).toBe(2);
    });

    it("clamps coordinates and drops what is not valid instead of storing it", () => {
        const r = store.savePlan("e1", {
            version: 0,
            bosses: {
                [BOSS]: {
                    tokens: [
                        { userId: "u1", x: -3, y: 9 },
                        { userId: "u1", x: 0.1, y: 0.1 }, // duplicate
                        { userId: "stranger", x: 0.1, y: 0.1 }, // not in the setup
                        { userId: "u2", x: "abc", y: null },
                        { x: 0.5, y: 0.5 },
                    ],
                    targets: [{ id: "a b!", title: "  Main-Tank  ", userIds: ["u1", "u1", "nobody", "u3"] }],
                    notes: "  hi ",
                },
                "bt/does-not-exist": { tokens: [{ userId: "u1", x: 0.5, y: 0.5 }] },
            },
        }, CTX);
        const board = r.plan.bosses[BOSS];
        expect(board.tokens).toMatchObject([{ userId: "u1", x: 0, y: 1 }, { userId: "u2", x: 0, y: 0 }]);
        expect(board.targets).toEqual([{ id: "ab", title: "Main-Tank", userIds: ["u1", "u3"] }]);
        expect(board.notes).toBe("  hi ");
        expect(r.plan.bosses["bt/does-not-exist"]).toBeUndefined();
        expect(r.dropped).toBeGreaterThanOrEqual(5);
    });

    it("cuts long texts, gives rows without a usable id a new one and stores no untouched boss", () => {
        const r = store.savePlan("e1", {
            version: 0,
            bosses: {
                [BOSS]: { targets: [{ id: "x", title: "T".repeat(500) }, { id: "x", title: "dup id" }], notes: "n".repeat(5000) },
                "bt/shade-of-akama": { tokens: [], targets: [], notes: "   " },
            },
        }, CTX);
        const board = r.plan.bosses[BOSS];
        expect(board.targets[0].title).toHaveLength(store.LIMITS.title);
        expect(board.targets[1].id).not.toBe("x");
        expect(board.notes).toHaveLength(store.LIMITS.notes);
        expect(Object.keys(r.plan.bosses)).toEqual([BOSS]);
    });

    it("keeps a known profile id and forgets an unknown one", () => {
        const r = store.savePlan("e1", {
            version: 0,
            bosses: { [BOSS]: { profileId: "p1" }, "bt/shade-of-akama": { profileId: "gone", notes: "x" } },
        }, CTX);
        expect(r.plan.bosses[BOSS].profileId).toBe("p1");
        expect(r.plan.bosses["bt/shade-of-akama"].profileId).toBe("");
    });

    it("rejects a body that is no plan and too many tokens or rows", () => {
        expect(store.savePlan("e1", { version: 0, bosses: [] }, CTX).code).toBe("invalid");
        expect(store.savePlan("e1", { version: 0, bosses: "x" }, CTX).code).toBe("invalid");
        const many = { ...CTX, allowedUserIds: Array.from({ length: 70 }, (_, i) => `u${i}`) };
        const tokens = Array.from({ length: 61 }, (_, i) => ({ userId: `u${i}`, x: 0.5, y: 0.5 }));
        expect(store.savePlan("e1", { version: 0, bosses: { [BOSS]: { tokens } } }, many).code).toBe("invalid");
        const targets = Array.from({ length: 31 }, () => ({ title: "t" }));
        expect(store.savePlan("e1", { version: 0, bosses: { [BOSS]: { targets } } }, CTX).code).toBe("invalid");
    });

    it("survives a broken file", () => {
        const file = tempStoreFile("broken.json");
        fs.writeFileSync(file, "{ nope");
        store.useFile(file);
        expect(store.getPlan("e1")).toBeNull();
        expect(store.savePlan("e1", { version: 0, bosses: {} }, CTX).plan.version).toBe(1);
    });
});

describe("publishing", () => {
    it("mints a token on the first publish, keeps it while unpublished and answers only when published", () => {
        expect(store.getPublishedByToken("whatever-token-1234567")).toBeNull();
        const first = store.setPublished("e1", true, { userId: "orga" }).plan;
        expect(first.status).toBe("published");
        expect(first.publicToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
        expect(store.getPublishedByToken(first.publicToken).eventId).toBe("e1");
        store.setPublished("e1", false);
        expect(store.getPublishedByToken(first.publicToken)).toBeNull();
        const again = store.setPublished("e1", true).plan;
        expect(again.publicToken).toBe(first.publicToken);
    });

    it("rotates the token, which kills the old link", () => {
        const a = store.setPublished("e1", true).plan.publicToken;
        const b = store.setPublished("e1", true, { rotate: true }).plan.publicToken;
        expect(b).not.toBe(a);
        expect(store.getPublishedByToken(a)).toBeNull();
        expect(store.getPublishedByToken(b)).not.toBeNull();
    });

    it("does not look up a malformed token and keeps a save from touching the token", () => {
        expect(store.getPublishedByToken("")).toBeNull();
        expect(store.getPublishedByToken("short")).toBeNull();
        expect(store.getPublishedByToken("../../etc/passwd/xxxxxxxx")).toBeNull();
        const token = store.setPublished("e1", true).plan.publicToken;
        store.savePlan("e1", { version: 0, bosses: {} }, CTX);
        expect(store.getPlan("e1")).toMatchObject({ publicToken: token, status: "published" });
    });

    it("deletes a plan with its event", () => {
        store.setPublished("e1", true);
        expect(store.deletePlan("e1")).toBe(true);
        expect(store.deletePlan("e1")).toBe(false);
        expect(store.getPlan("e1")).toBeNull();
    });
});

describe("room maps", () => {
    it("recognises an image by its bytes, not by what the upload claims", () => {
        expect(store.sniffImage(PNG)).toMatchObject({ mime: "image/png", ext: "png" });
        expect(store.sniffImage(JPG)).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
        expect(store.sniffImage(WEBP)).toMatchObject({ mime: "image/webp", ext: "webp" });
        expect(store.sniffImage(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"))).toBeNull();
        expect(store.sniffImage(Buffer.from("GIF89a" + "x".repeat(20)))).toBeNull();
        expect(store.sniffImage(Buffer.alloc(3))).toBeNull();
        expect(store.sniffImage("not a buffer")).toBeNull();
    });

    it("stores, reads, replaces and deletes a map per boss and per instance", () => {
        expect(store.readMap(BOSS)).toBeNull();
        expect(store.saveMap(BOSS, PNG)).toEqual({ ok: true, mime: "image/png" });
        expect(store.readMap(BOSS)).toMatchObject({ mime: "image/png" });
        // a new upload of another type replaces the old file
        expect(store.saveMap(BOSS, JPG).mime).toBe("image/jpeg");
        expect(store.readMap(BOSS).mime).toBe("image/jpeg");
        expect(store.saveMap("bt", WEBP).ok).toBe(true);
        expect(store.deleteMap(BOSS)).toBe(true);
        expect(store.deleteMap(BOSS)).toBe(false);
        expect(store.readMap("bt").mime).toBe("image/webp");
    });

    it("refuses unknown keys, non-images and files over 3 MB", () => {
        expect(store.saveMap("../../evil", PNG).code).toBe("invalid");
        expect(store.saveMap(BOSS, Buffer.from("just text, long enough")).code).toBe("invalid");
        expect(store.saveMap(BOSS, Buffer.alloc(0)).code).toBe("invalid");
        const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
        expect(store.saveMap(BOSS, big).code).toBe("too_large");
        expect(store.readMap(BOSS)).toBeNull();
        expect(store.readMap("../x")).toBeNull();
    });

    it("gives a boss its own map, else its instance's, and none when neither exists", () => {
        const boss = store.bossesForInstances(["bt"]).find((b) => b.key === BOSS);
        expect(store.mapForBoss(boss)).toBeNull();
        store.saveMap("bt", PNG);
        expect(store.mapForBoss(boss)).toMatchObject({ key: "bt", source: "instance" });
        store.saveMap(BOSS, PNG);
        expect(store.mapForBoss(boss)).toMatchObject({ key: BOSS, source: "boss" });
        expect(store.mapForBoss(boss).version).toBeGreaterThan(0);
    });

    it("writes only into its own folder", () => {
        const file = tempStoreFile("plans.json");
        store.useFile(file);
        store.saveMap(BOSS, PNG);
        const dir = path.join(path.dirname(file), "raidplan-maps");
        expect(fs.readdirSync(dir)).toEqual(["bt__supremus.png"]);
    });
});
