// The one way a store reads and writes its JSON file (#419).
//
// Before this every *Store.js carried its own readAll/writeAll/ensureDir, and
// none of them wrote atomically: writeFileSync truncates the file first, so a
// crash or a full disk halfway through left a half-written settings file that
// the next start read as "empty" - every event, every signup gone.
//
//   const store = createJsonStore({
//       file: settingsPath("events.json"),
//       defaults: () => [],                               // missing or unreadable file
//       normalize: (d) => (Array.isArray(d.events) ? d.events : []),
//   });
//   store.read();                 // normalize(parsed file), else defaults
//   store.write({ events });      // the whole document, atomically
//   store.update((events) => ...) // read, change, write
//   store.useFile(tmp)            // tests: another file; null = back to the default
//
// Writing goes to a temporary file in the same directory, which is then
// renamed over the real one. A rename within one directory is atomic, so a
// reader - or the next start after a crash - sees the old file or the new one,
// never half of each.
//
// `cache: true` keeps the normalised value and reads the file again only when
// its mtime, size or inode changed (an edit by hand counts). Every read hands
// out a copy, so a caller changing what it got cannot change the cache.
const fs = require("fs");
const path = require("path");
const { newId } = require("../utils/ids");

// Windows refuses a rename while another process (a virus scanner, an editor,
// a backup tool) holds the target open. That clears within milliseconds, so the
// rename is tried a few times before the write counts as failed.
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 20;

function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (e) {
            if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(e && e.code)) throw e;
            sleepSync(RENAME_WAIT_MS * attempt);
        }
    }
}

/** The temporary sibling a write goes through: same directory, so the rename stays atomic. */
function tempPathFor(file) {
    return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${newId(4)}.tmp`);
}

/**
 * Write `text` to `file` atomically: temporary file, then rename. Creates the
 * directory. On failure the temporary file is removed, the old file is left
 * exactly as it was, and the error is thrown.
 */
function writeFileAtomic(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = tempPathFor(file);
    try {
        fs.writeFileSync(tmp, text);
        renameWithRetry(tmp, file);
    } catch (e) {
        try {
            fs.unlinkSync(tmp);
        } catch {
            // never created, or already gone
        }
        throw e;
    }
}

/** `value` as JSON, atomically. `space` as in JSON.stringify (2 = readable, 0 = compact). */
function writeJsonAtomic(file, value, { space = 2 } = {}) {
    writeFileAtomic(file, space ? JSON.stringify(value, null, space) : JSON.stringify(value));
}

/** The parsed file, or `fallback` when it is missing or no valid JSON. */
function readJsonFile(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

/**
 * A store over one JSON file.
 *
 * @param {object} options
 * @param {string} options.file        the default file (useFile(null) returns to it)
 * @param {*|Function} [options.defaults]  what read() returns for a missing or unreadable
 *                                     file; a function is called each time, a value is copied
 * @param {Function} [options.normalize]  parsed file -> the value read() returns; a throw
 *                                     counts as an unreadable file
 * @param {boolean} [options.cache]    keep the value until the file changes (mtime/size/inode)
 * @param {number} [options.space]     JSON indentation, 2 by default, 0 for compact
 */
function createJsonStore({ file, defaults, normalize, cache = false, space = 2 } = {}) {
    if (!file) throw new Error("createJsonStore: file is required");
    const defaultFile = file;
    let current = defaultFile;
    // { key, value } of the last read while `cache` is on.
    let cached = null;

    const fallback = () => {
        const value = typeof defaults === "function" ? defaults() : copy(defaults);
        return value === undefined ? {} : value;
    };

    function load() {
        try {
            const parsed = JSON.parse(fs.readFileSync(current, "utf8"));
            return normalize ? normalize(parsed) : parsed;
        } catch {
            return fallback();
        }
    }

    function statKey() {
        try {
            const st = fs.statSync(current);
            return `${st.mtimeMs}:${st.size}:${st.ino}`;
        } catch {
            return null;
        }
    }

    /** The stored value (normalised), or the defaults. */
    function read() {
        if (!cache) return load();
        const key = statKey();
        if (key === null) {
            cached = null;
            return fallback();
        }
        if (!cached || cached.key !== key) cached = { key, value: load() };
        return copy(cached.value);
    }

    /** Replace the whole file with `value`, atomically. */
    function write(value) {
        cached = null;
        writeJsonAtomic(current, value, { space });
    }

    /**
     * Read, let `fn` change the value, write it back. `fn` may return a new
     * value or change the one it got and return nothing. Returns what was written.
     */
    function update(fn) {
        const value = read();
        const result = fn(value);
        const next = result === undefined ? value : result;
        write(next);
        return next;
    }

    /** Create the file's directory. write() does this itself. */
    function ensureDir() {
        fs.mkdirSync(path.dirname(current), { recursive: true });
    }

    /** Delete the file (reset in tests); a missing file is fine. */
    function remove() {
        cached = null;
        try {
            fs.unlinkSync(current);
        } catch {
            // never existed
        }
    }

    /** Tests: read and write another file; null/undefined = the default again. */
    function useFile(next) {
        current = next || defaultFile;
        cached = null;
    }

    return {
        read, write, update, ensureDir, remove, useFile,
        get file() { return current; },
        defaultFile,
    };
}

module.exports = { createJsonStore, writeFileAtomic, writeJsonAtomic, readJsonFile, tempPathFor };
