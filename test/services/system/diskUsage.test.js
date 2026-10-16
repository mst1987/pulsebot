// Disk figures of the "Systemstatus" page (docs/system-status.md): statfs of the data directory, the biggest
// entries under it, and the five-minute cache - against a real scratch directory and a fake statfs.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { diskSpace, largestEntries, createDiskUsage } = require("../../../src/services/system/diskUsage");
const { tempStoreFile } = require("../../helpers/tempStore");

let root;
beforeAll(() => {
    // a scratch directory of this suite's own, removed by the helper after the suite
    root = path.dirname(tempStoreFile("unused"));
    fs.mkdirSync(path.join(root, "reports"));
    fs.mkdirSync(path.join(root, "reports", "old"));
    fs.mkdirSync(path.join(root, "settings"));
    fs.writeFileSync(path.join(root, "reports", "a.json"), "x".repeat(5000));
    fs.writeFileSync(path.join(root, "reports", "old", "b.json"), "x".repeat(3000));
    fs.writeFileSync(path.join(root, "settings", "config.json"), "x".repeat(200));
    fs.writeFileSync(path.join(root, "sessions.json"), "x".repeat(1000));
});

const fakeStatfs = (over = {}) => ({ ...fsp, statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 50, ...over }) });

describe("diskSpace", () => {
    it("turns statfs blocks into bytes", async () => {
        expect(await diskSpace(root, fakeStatfs())).toEqual({ total: 4096000, free: 204800 });
    });

    it("is null without statfs, on an error and for an empty filesystem", async () => {
        expect(await diskSpace(root, { readdir: fsp.readdir })).toBeNull();
        expect(await diskSpace(root, { statfs: async () => { throw new Error("EACCES"); } })).toBeNull();
        expect(await diskSpace(root, fakeStatfs({ blocks: 0 }))).toBeNull();
    });

    it("answers for a real directory", async () => {
        const space = await diskSpace(root);
        if (typeof fsp.statfs === "function") expect(space.total).toBeGreaterThan(0);
        else expect(space).toBeNull();
    });
});

describe("largestEntries", () => {
    it("sums folders, lists the biggest files with relative paths, biggest first", async () => {
        const res = await largestEntries(root);
        expect(res.entries).toEqual([
            { name: "reports", dir: true, size: 8000, files: 2 },
            { name: "sessions.json", dir: false, size: 1000, files: 1 },
            { name: "settings", dir: true, size: 200, files: 1 },
        ]);
        expect(res.files).toEqual([
            { path: "reports/a.json", size: 5000 },
            { path: "reports/old/b.json", size: 3000 },
            { path: "sessions.json", size: 1000 },
            { path: "settings/config.json", size: 200 },
        ]);
        expect(res.truncated).toBe(false);
        expect(JSON.stringify(res)).not.toContain(root);
    });

    it("stops at maxEntries and says so", async () => {
        const res = await largestEntries(root, { maxEntries: 2 });
        expect(res.truncated).toBe(true);
    });

    it("keeps to `top` rows", async () => {
        const res = await largestEntries(root, { top: 1 });
        expect(res.entries).toHaveLength(1);
        expect(res.files).toEqual([{ path: "reports/a.json", size: 5000 }]);
    });

    it("is empty for a missing directory", async () => {
        expect(await largestEntries(path.join(root, "nope"))).toEqual({ entries: [], files: [], truncated: false });
    });
});

describe("createDiskUsage", () => {
    it("caches for five minutes, walks again when forced, and keeps a free-space history", async () => {
        let t = 0;
        const fsApi = fakeStatfs();
        const statfs = jest.spyOn(fsApi, "statfs");
        const disk = createDiskUsage({ dir: root, fsApi, now: () => t });
        const first = await disk.get();
        expect(first).toMatchObject({ at: 0, total: 4096000, free: 204800, known: true });
        expect(first.entries[0].name).toBe("reports");
        t = 60 * 1000;
        expect(await disk.get()).toBe(first);
        expect(statfs).toHaveBeenCalledTimes(1);
        t = 6 * 60 * 1000;
        const second = await disk.get();
        expect(second.at).toBe(t);
        await disk.get({ force: true });
        expect(statfs).toHaveBeenCalledTimes(3);
        expect(disk.history()).toEqual([[0, 5], [t, 5], [t, 5]]);
    });

    it("asks once while a walk is under way", async () => {
        const fsApi = fakeStatfs();
        const statfs = jest.spyOn(fsApi, "statfs");
        const disk = createDiskUsage({ dir: root, fsApi });
        const [a, b] = await Promise.all([disk.get(), disk.get()]);
        expect(a).toBe(b);
        expect(statfs).toHaveBeenCalledTimes(1);
    });

    it("reports an unknown disk without failing", async () => {
        const disk = createDiskUsage({ dir: root, fsApi: { ...fsp, statfs: undefined } });
        expect(await disk.get()).toMatchObject({ known: false, total: 0, free: 0 });
        expect(disk.history()).toEqual([]);
    });
});
