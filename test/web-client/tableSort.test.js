// Guards for the admin client's table sorting (src/web-client/src/lib/tableSort.ts,
// components/SortTh.tsx and every table using them).
//
// The hooks and components are TSX-only and there is no React test renderer in
// this project, so what is checked here are the invariants that silently rot:
//   * every column header is sortable — a plain <th> is only allowed for the
//     documented exceptions (button/link columns and the permission matrix),
//   * nobody re-implements the sort header or the comparator locally again
//     (there used to be five copies of both),
//   * every remembered sort has its own storage key, so two tables can't
//     overwrite each other's column,
//   * a stored key is validated against the columns that exist.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

// Every page/component file of the client, as [name, source].
function clientSources() {
    const out = [];
    for (const dir of ["pages", "components"]) {
        for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
            if (file.endsWith(".tsx")) out.push([`${dir}/${file}`, readClient(dir, file)]);
        }
    }
    return out;
}

// Column headers that stay unsorted on purpose, with the reason. Everything
// else has to be a <SortTh>.
//
//   * "Links"/"WCL"  — the cell is the same one or two links on every row,
//   * the permission matrix — a fixed checklist per role in the deliberate
//     order of config/permissions.js, where sorting by a switch would make the
//     row jump away under the cursor as it is toggled.
const ALLOWED_PLAIN_HEADERS = new Set(["Links", "WCL", "Bereich", "Lesen", "Schreiben"]);

describe("table sorting", () => {
    it("sorts every column that isn't a button or link column", () => {
        for (const [name, src] of clientSources()) {
            // <th>Label</th> — an empty <th /> is the actions column and fine.
            const labels = [...src.matchAll(/<th[^>]*>([^<]+)<\/th>/g)]
                .map((m) => m[1].trim())
                .filter((label) => label && !ALLOWED_PLAIN_HEADERS.has(label));
            expect({ file: name, unsortable: labels }).toEqual({ file: name, unsortable: [] });
        }
    });

    it("has exactly one sort header component", () => {
        // The button carries the .sort-link class; finding it anywhere but in
        // SortTh.tsx means a table grew its own header again.
        const offenders = clientSources()
            .filter(([name, src]) => name !== "components/SortTh.tsx" && src.includes("sort-link"))
            .map(([name]) => name);
        expect(offenders).toEqual([]);
    });

    it("tells screen readers which column is sorted", () => {
        // The ▲/▼ glyph is decoration; aria-sort is what is announced.
        const sortTh = readClient("components", "SortTh.tsx");
        expect(sortTh).toMatch(/aria-sort=\{active \? \(dir === "asc" \? "ascending" : "descending"\) : "none"\}/);
    });

    it("sorts through the shared comparator instead of a local one", () => {
        // A hand-rolled `[...rows].sort()` in a table file is the copy this
        // module replaced — the filter/option lists it does not cover sort
        // plain arrays of strings and stay allowed.
        for (const [name, src] of clientSources()) {
            const offenders = src.match(/\[\.\.\.\w+\]\.sort\(\(a, b\) => \{/g) || [];
            expect({ file: name, offenders }).toEqual({ file: name, offenders: [] });
        }
    });

    it("keeps equal rows in their previous order", () => {
        // An unstable sort reshuffles the rows a column can't tell apart on
        // every render, which reads as a table flickering by itself.
        const lib = readClient("lib", "tableSort.ts");
        expect(lib).toContain("return a.index - b.index;");
    });

    it("falls back to the default when the stored column is gone", () => {
        const lib = readClient("lib", "tableSort.ts");
        expect(lib).toContain("const sort: K = defaults[state.sort] ? state.sort : initial;");
    });

    it("never reuses a sort storage key across two tables", () => {
        const seen = new Map();
        for (const [name, src] of clientSources()) {
            for (const [, key] of src.matchAll(/useTableSort(?:<[^>]*>)?\(\s*"([^"]+)"/g)) {
                expect(seen.has(key) ? `${key} also in ${seen.get(key)}` : key).toBe(key);
                seen.set(key, name);
            }
            // RaidTable takes its key as a prop, since the same table is shown
            // more than once on a page (upcoming vs. past raids).
            for (const [, key] of src.matchAll(/sortKey="([^"]+-sort)"/g)) {
                expect(seen.has(key) ? `${key} also in ${seen.get(key)}` : key).toBe(key);
                seen.set(key, name);
            }
        }
        // Sanity: the scan found the tables at all.
        expect(seen.size).toBeGreaterThan(8);
    });
});
