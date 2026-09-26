// An in-memory `fs` for store suites, so a store never touches the repo's disk.
//
//   jest.mock("fs", () => require("../helpers/memoryFs").memoryFs());
//   const fs = require("fs");
//   beforeEach(() => fs.__store.clear());
//
// `fs.__store` is a Map path -> text. It covers what the stores and their base
// (src/stores/jsonStore.js) call: the atomic write goes through a temporary file
// and renameSync, and the mtime cache asks statSync - every write, including a
// direct `fs.__store.set(...)` in a test, gives the file a new mtime.
// Each function is a jest.fn, so a suite can count calls or make one fail.

function enoent(p, op = "open") {
    const e = new Error(`ENOENT: no such file or directory, ${op} '${p}'`);
    e.code = "ENOENT";
    return e;
}

function memoryFs() {
    // mtime per path, bumped by every set - also by a test writing the Map itself.
    const versions = new Map();
    let clock = 0;
    class FileMap extends Map {
        set(p, text) {
            clock += 1;
            versions.set(p, clock);
            return super.set(p, text);
        }
        delete(p) {
            versions.delete(p);
            return super.delete(p);
        }
        clear() {
            versions.clear();
            return super.clear();
        }
    }
    const store = new FileMap();

    return {
        __store: store,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn((p, data) => {
            store.set(p, String(data));
        }),
        readFileSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p);
            return store.get(p);
        }),
        renameSync: jest.fn((from, to) => {
            if (!store.has(from)) throw enoent(from, "rename");
            const text = store.get(from);
            store.delete(from);
            store.set(to, text);
        }),
        unlinkSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p, "unlink");
            store.delete(p);
        }),
        rmSync: jest.fn((p) => {
            store.delete(p);
        }),
        existsSync: jest.fn((p) => store.has(p)),
        statSync: jest.fn((p) => {
            if (!store.has(p)) throw enoent(p, "stat");
            return { mtimeMs: versions.get(p) || 0, size: store.get(p).length, ino: 0, isFile: () => true };
        }),
    };
}

module.exports = { memoryFs };
