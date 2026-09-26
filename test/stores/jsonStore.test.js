// The shared base of every JSON store (#419): read with defaults and
// normalisation, atomic write (temporary file + rename), the mtime cache and
// the one test hook useFile(). Runs against the real disk, in a scratch
// directory of its own.
const fs = require("fs");
const path = require("path");
const { tempStoreFile } = require("../helpers/tempStore");
const {
    createJsonStore, writeFileAtomic, writeJsonAtomic, readJsonFile, tempPathFor,
} = require("../../src/stores/jsonStore");

const listStore = (file, extra = {}) => createJsonStore({
    file,
    defaults: () => [],
    normalize: (data) => (Array.isArray(data.items) ? data.items : []),
    ...extra,
});

/** Everything in the file's directory apart from the file itself - leftovers of a write. */
const strays = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f !== path.basename(file));

afterEach(() => jest.restoreAllMocks());

describe("stores/jsonStore", () => {
    describe("read", () => {
        it("hands out the defaults while there is no file", () => {
            const store = listStore(tempStoreFile("items.json"));
            expect(store.read()).toEqual([]);
        });

        it("copies a default given as a value, so a caller cannot change the next one", () => {
            const store = createJsonStore({ file: tempStoreFile("x.json"), defaults: { events: [] } });
            store.read().events.push("changed");
            expect(store.read()).toEqual({ events: [] });
        });

        it("falls back to an empty object without defaults", () => {
            expect(createJsonStore({ file: tempStoreFile("x.json") }).read()).toEqual({});
        });

        it("returns the normalised file", () => {
            const file = tempStoreFile("items.json");
            fs.writeFileSync(file, JSON.stringify({ items: [1, 2] }));
            expect(listStore(file).read()).toEqual([1, 2]);
        });

        it("treats broken JSON and a normaliser that throws as an unreadable file", () => {
            const file = tempStoreFile("items.json");
            fs.writeFileSync(file, "{ not json");
            expect(listStore(file).read()).toEqual([]);
            fs.writeFileSync(file, "null");
            expect(listStore(file).read()).toEqual([]);
        });

        it("throws without a file", () => {
            expect(() => createJsonStore({})).toThrow(/file is required/);
            expect(() => createJsonStore()).toThrow(/file is required/);
        });
    });

    describe("write", () => {
        it("creates the directory and writes readable JSON", () => {
            const file = path.join(path.dirname(tempStoreFile("unused")), "deep", "er", "items.json");
            const store = listStore(file);
            store.write({ items: ["a"] });
            expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify({ items: ["a"] }, null, 2));
            expect(store.read()).toEqual(["a"]);
        });

        it("writes compact JSON with space 0", () => {
            const file = tempStoreFile("compact.json");
            createJsonStore({ file, space: 0 }).write({ a: 1 });
            expect(fs.readFileSync(file, "utf8")).toBe("{\"a\":1}");
        });

        it("replaces an existing file and leaves no temporary file behind", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file);
            store.write({ items: [1] });
            // a rename over an existing file - the case Windows is picky about
            store.write({ items: [1, 2] });
            expect(store.read()).toEqual([1, 2]);
            expect(strays(file)).toEqual([]);
        });

        it("leaves the old file untouched when writing the new one fails", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file);
            store.write({ items: ["old"] });
            const real = fs.writeFileSync;
            jest.spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
                // half a file on disk, then the disk is full
                real(p, String(data).slice(0, 5));
                const e = new Error("ENOSPC: no space left on device");
                e.code = "ENOSPC";
                throw e;
            });
            expect(() => store.write({ items: ["new"] })).toThrow(/ENOSPC/);
            fs.writeFileSync.mockRestore();
            expect(store.read()).toEqual(["old"]);
            expect(strays(file)).toEqual([]);
        });

        it("leaves the old file untouched when the rename fails, and removes the temporary file", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file);
            store.write({ items: ["old"] });
            jest.spyOn(fs, "renameSync").mockImplementation(() => {
                const e = new Error("EXDEV: cross-device link not permitted");
                e.code = "EXDEV";
                throw e;
            });
            expect(() => store.write({ items: ["new"] })).toThrow(/EXDEV/);
            expect(fs.renameSync).toHaveBeenCalledTimes(1);
            fs.renameSync.mockRestore();
            expect(store.read()).toEqual(["old"]);
            expect(strays(file)).toEqual([]);
        });

        it("tries the rename again while another process holds the file (Windows)", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file);
            store.write({ items: ["old"] });
            const real = fs.renameSync;
            let calls = 0;
            jest.spyOn(fs, "renameSync").mockImplementation((from, to) => {
                calls += 1;
                if (calls < 3) {
                    const e = new Error("EPERM: operation not permitted");
                    e.code = "EPERM";
                    throw e;
                }
                return real(from, to);
            });
            store.write({ items: ["new"] });
            expect(calls).toBe(3);
            fs.renameSync.mockRestore();
            expect(store.read()).toEqual(["new"]);
            expect(strays(file)).toEqual([]);
        });

        it("gives up after a few attempts when the file stays locked", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file);
            store.write({ items: ["old"] });
            jest.spyOn(fs, "renameSync").mockImplementation(() => {
                const e = new Error("EBUSY: resource busy or locked");
                e.code = "EBUSY";
                throw e;
            });
            expect(() => store.write({ items: ["new"] })).toThrow(/EBUSY/);
            expect(fs.renameSync).toHaveBeenCalledTimes(5);
            fs.renameSync.mockRestore();
            expect(store.read()).toEqual(["old"]);
            expect(strays(file)).toEqual([]);
        });
    });

    describe("update", () => {
        it("writes what the function changed in place", () => {
            const store = listStore(tempStoreFile("items.json"));
            store.write({ items: [1] });
            const next = createJsonStore({ file: store.file, defaults: () => ({ items: [] }) }).update((data) => {
                data.items.push(2);
            });
            expect(next).toEqual({ items: [1, 2] });
            expect(store.read()).toEqual([1, 2]);
        });

        it("writes what the function returned", () => {
            const store = createJsonStore({ file: tempStoreFile("count.json"), defaults: () => ({ n: 0 }) });
            store.update((data) => ({ n: data.n + 1 }));
            expect(store.update((data) => ({ n: data.n + 1 }))).toEqual({ n: 2 });
            expect(store.read()).toEqual({ n: 2 });
        });
    });

    describe("cache", () => {
        it("reads the file once while it does not change", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file, { cache: true });
            fs.writeFileSync(file, JSON.stringify({ items: [1] }));
            const read = jest.spyOn(fs, "readFileSync");
            expect(store.read()).toEqual([1]);
            expect(store.read()).toEqual([1]);
            expect(read.mock.calls.filter(([p]) => p === file)).toHaveLength(1);
        });

        it("hands out copies, so a caller changing one cannot change the cache", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file, { cache: true });
            store.write({ items: [{ a: 1 }] });
            store.read()[0].a = 99;
            store.read().push("x");
            expect(store.read()).toEqual([{ a: 1 }]);
        });

        it("reads again after a change from outside (another size or another mtime)", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file, { cache: true });
            fs.writeFileSync(file, JSON.stringify({ items: [1] }));
            expect(store.read()).toEqual([1]);
            fs.writeFileSync(file, JSON.stringify({ items: [1, 2, 3] }));
            expect(store.read()).toEqual([1, 2, 3]);
            // same size, only the mtime moves - an edit by hand
            fs.writeFileSync(file, JSON.stringify({ items: [4, 5, 6] }));
            const later = new Date(Date.now() + 60000);
            fs.utimesSync(file, later, later);
            expect(store.read()).toEqual([4, 5, 6]);
        });

        it("forgets the value on its own write and when the file is gone", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file, { cache: true });
            store.write({ items: [1] });
            expect(store.read()).toEqual([1]);
            store.write({ items: [2] });
            expect(store.read()).toEqual([2]);
            fs.unlinkSync(file);
            expect(store.read()).toEqual([]);
        });
    });

    describe("useFile, remove, ensureDir", () => {
        it("points the store at another file and back to its default with null", () => {
            const home = tempStoreFile("home.json");
            const other = tempStoreFile("other.json");
            const store = listStore(home, { cache: true });
            store.write({ items: ["home"] });
            expect(store.read()).toEqual(["home"]);
            store.useFile(other);
            expect(store.file).toBe(other);
            expect(store.read()).toEqual([]);
            store.write({ items: ["other"] });
            store.useFile(null);
            expect(store.file).toBe(home);
            expect(store.defaultFile).toBe(home);
            expect(store.read()).toEqual(["home"]);
            store.useFile();
            expect(store.file).toBe(home);
            expect(JSON.parse(fs.readFileSync(other, "utf8"))).toEqual({ items: ["other"] });
        });

        it("removes the file, and a missing one is fine", () => {
            const file = tempStoreFile("items.json");
            const store = listStore(file, { cache: true });
            store.write({ items: [1] });
            expect(store.read()).toEqual([1]);
            store.remove();
            expect(fs.existsSync(file)).toBe(false);
            expect(store.read()).toEqual([]);
            expect(() => store.remove()).not.toThrow();
        });

        it("creates the directory", () => {
            const file = path.join(path.dirname(tempStoreFile("unused")), "sub", "items.json");
            listStore(file).ensureDir();
            expect(fs.statSync(path.dirname(file)).isDirectory()).toBe(true);
        });
    });

    describe("file helpers", () => {
        it("puts the temporary file next to the target, hidden and unique", () => {
            const file = path.join("some", "dir", "config.json");
            const a = tempPathFor(file);
            expect(path.dirname(a)).toBe(path.dirname(file));
            expect(path.basename(a)).toMatch(/^\.config\.json\.\d+\.[0-9a-f]{8}\.tmp$/);
            expect(tempPathFor(file)).not.toBe(a);
        });

        it("writes text and JSON atomically and reads JSON with a fallback", () => {
            const file = tempStoreFile("report.json");
            writeFileAtomic(file, "plain");
            expect(fs.readFileSync(file, "utf8")).toBe("plain");
            writeJsonAtomic(file, { a: [1] }, { space: 0 });
            expect(fs.readFileSync(file, "utf8")).toBe("{\"a\":[1]}");
            writeJsonAtomic(file, { a: 1 });
            expect(fs.readFileSync(file, "utf8")).toBe("{\n  \"a\": 1\n}");
            expect(readJsonFile(file, null)).toEqual({ a: 1 });
            expect(readJsonFile(`${file}.missing`, "fallback")).toBe("fallback");
            expect(strays(file)).toEqual([]);
        });

        it("does not hide the error when even the clean-up fails", () => {
            const file = tempStoreFile("report.json");
            jest.spyOn(fs, "writeFileSync").mockImplementation(() => {
                throw new Error("disk gone");
            });
            jest.spyOn(fs, "unlinkSync").mockImplementation(() => {
                throw new Error("still gone");
            });
            expect(() => writeFileAtomic(file, "x")).toThrow("disk gone");
        });
    });
});
