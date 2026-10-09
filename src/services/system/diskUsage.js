// Disk figures for the "Systemstatus" page (docs/system-status.md): how full the disk of the data directory is and
// what takes the space under data/.
//
// Both are asked only when the page is open and kept for CACHE_MS (5 minutes): statfs is cheap, but walking data/
// (hundreds of report files) is not something to repeat every 15 seconds. The walk is asynchronous, bounded by
// MAX_ENTRIES, and never follows a symlink. Paths go out relative to the data directory - the absolute path of the
// server's checkout is nobody's business, not even an admin's page.
const fsp = require("fs/promises");
const path = require("path");
const { DATA_DIR } = require("../../config/paths");

const CACHE_MS = 5 * 60 * 1000;
/** Files and folders looked at during one walk at most; beyond that the sizes say "at least". */
const MAX_ENTRIES = 50000;
const TOP = 10;
/** One point of the free-space history per walk; 24 hours at one per five minutes. */
const HISTORY_KEEP = 288;

/** { total, free } in bytes of the filesystem that holds `dir`; null where statfs is missing or fails. */
async function diskSpace(dir, fsApi = fsp) {
    if (typeof fsApi.statfs !== "function") return null;
    try {
        const st = await fsApi.statfs(dir);
        const bsize = Number(st.bsize) || 0;
        const total = Number(st.blocks) * bsize;
        const free = Number(st.bavail) * bsize;
        if (!(total > 0)) return null;
        return { total, free };
    } catch {
        return null;
    }
}

/**
 * Walks `root` and returns the biggest top-level entries (folders with everything below them summed) and the
 * biggest single files anywhere below, both TOP long, plus whether the walk stopped at MAX_ENTRIES.
 */
async function largestEntries(root, { fsApi = fsp, maxEntries = MAX_ENTRIES, top = TOP } = {}) {
    let seen = 0;
    let truncated = false;
    const files = [];

    async function walk(dir, rel) {
        let list;
        try {
            list = await fsApi.readdir(dir, { withFileTypes: true });
        } catch {
            return { size: 0, count: 0 };
        }
        let size = 0;
        let count = 0;
        for (const ent of list) {
            if (seen >= maxEntries) { truncated = true; break; }
            seen += 1;
            const abs = path.join(dir, ent.name);
            const relPath = rel ? `${rel}/${ent.name}` : ent.name;
            if (ent.isSymbolicLink()) continue;
            if (ent.isDirectory()) {
                const sub = await walk(abs, relPath);
                size += sub.size;
                count += sub.count;
            } else if (ent.isFile()) {
                let st;
                try { st = await fsApi.stat(abs); } catch { continue; }
                size += st.size;
                count += 1;
                files.push({ path: relPath, size: st.size });
            }
        }
        return { size, count };
    }

    let list;
    try {
        list = await fsApi.readdir(root, { withFileTypes: true });
    } catch {
        return { entries: [], files: [], truncated: false };
    }
    const entries = [];
    for (const ent of list) {
        if (seen >= maxEntries) { truncated = true; break; }
        seen += 1;
        if (ent.isSymbolicLink()) continue;
        const abs = path.join(root, ent.name);
        if (ent.isDirectory()) {
            const sub = await walk(abs, ent.name);
            entries.push({ name: ent.name, dir: true, size: sub.size, files: sub.count });
        } else if (ent.isFile()) {
            let st;
            try { st = await fsApi.stat(abs); } catch { continue; }
            entries.push({ name: ent.name, dir: false, size: st.size, files: 1 });
            files.push({ path: ent.name, size: st.size });
        }
    }
    const bySize = (a, b) => b.size - a.size || String(a.name || a.path).localeCompare(String(b.name || b.path));
    return {
        entries: entries.sort(bySize).slice(0, top),
        files: files.sort(bySize).slice(0, top),
        truncated,
    };
}

/** A cache around both, so the page can ask on every poll. */
function createDiskUsage({ dir = DATA_DIR, fsApi = fsp, now = Date.now, cacheMs = CACHE_MS } = {}) {
    let cached = null;
    let running = null;
    const history = [];

    async function compute() {
        const [space, sizes] = await Promise.all([diskSpace(dir, fsApi), largestEntries(dir, { fsApi })]);
        const at = now();
        if (space) {
            history.push([at, Math.round((space.free / space.total) * 1000) / 10]);
            if (history.length > HISTORY_KEEP) history.shift();
        }
        return { at, total: space ? space.total : 0, free: space ? space.free : 0, known: !!space, ...sizes };
    }

    /** The figures, at most CACHE_MS old; `force` walks again. Never rejects. */
    async function get({ force = false } = {}) {
        if (!force && cached && now() - cached.at < cacheMs) return cached;
        if (!running) {
            running = compute().then((r) => { cached = r; return r; }, () => cached).finally(() => { running = null; });
        }
        return running;
    }

    return { get, history: () => history.map((p) => [...p]) };
}

const shared = createDiskUsage();

module.exports = {
    diskSpace, largestEntries, createDiskUsage,
    get: shared.get, history: shared.history,
    CACHE_MS, MAX_ENTRIES,
};
