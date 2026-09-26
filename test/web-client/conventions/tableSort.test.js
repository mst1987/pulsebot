// Guards for the admin client's table sorting across every table
// (src/web-client/src/lib/tableSort.ts, components/SortTh.tsx and their users;
// #435: the structural half of the former test/web-client/tableSort.test.js —
// the comparator and the remembered sort are tested in lib/tableSort.test.ts,
// the header in components/SortTh.test.tsx):
//   * every column header is sortable — a plain <th> is only allowed for the
//     documented exceptions (button/link columns and the permission matrix),
//   * nobody re-implements the sort header or the comparator locally again
//     (there used to be five copies of both),
//   * every remembered sort has its own storage key, so two tables can't
//     overwrite each other's column.
const fs = require("fs");
const path = require("path");
const { CLIENT, namespaces } = require("../clientSource");

// A translated header (`<th>{t("ns.key")}</th>`) is checked by its German text,
// looked up in the German dictionary files.
const DE = namespaces("de");
const german = (key) => key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), DE);
const headerText = (label) => {
    const key = label.match(/^\{t\("([^"]+)"\)\}$/);
    if (!key) return label;
    const text = german(key[1]);
    return typeof text === "string" ? text : label;
};

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

// Every page/component file of the client, as [name, source] — tests are not the app.
function clientSources() {
    const out = [];
    for (const dir of ["pages", "components"]) {
        for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
            if (file.endsWith(".tsx") && !file.endsWith(".test.tsx")) out.push([`${dir}/${file}`, readClient(dir, file)]);
        }
    }
    return out;
}

// Column headers that stay unsorted on purpose, with the reason. Everything
// else has to be a <SortTh>.
//
//   * "Links"/"WCL"  — the cell is the same one or two links on every row,
//   * "Token"        — the loot-sync token column is "ehl_…" plus four
//     characters of an otherwise unreadable secret; there is nothing in it an
//     order could be about,
//   * "Wer" — the permission matrix: rows grouped by owner (admins, base
//     access, roles, accounts), columns in the order of config/permissions.js;
//     sorting would make a row jump away under the cursor as a cell is toggled,
//   * "Slot" — the BiS-Listen matrix runs in character-sheet order (Kopf, Hals,
//     Schultern, …). That order is the point: it is how a raider reads their own
//     gear, and it is what lets the eye find a gap. Alphabetical would read
//     "Beine, Brust, Füße" and mean nothing.
//   * "Item" — the corner of the Loot-Vergleich matrix, same reason: its rows
//     are grouped by raid and run in character-sheet order inside each.
const ALLOWED_PLAIN_HEADERS = new Set(["Links", "WCL", "Token", "Wer", "Slot", "Item"]);

describe("table sorting", () => {
    it("reads a translated header by its German text", () => {
        expect(headerText("{t(\"raids.table.links\")}")).toBe("Links");
        expect(headerText("Wer")).toBe("Wer");
    });

    it("sorts every column that isn't a button or link column", () => {
        for (const [name, src] of clientSources()) {
            // <th>Label</th> — an empty <th /> is the actions column and fine.
            // A <th scope="row"> is skipped: it labels its own row (the slot in
            // the BiS matrix), so it is not a column header and can never be a
            // sort control.
            const labels = [...src.matchAll(/<th([^>]*)>([^<]+)<\/th>/g)]
                .filter((m) => !/scope=("row"|\{"row"\})/.test(m[1]))
                .map((m) => headerText(m[2].trim()))
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

    it("sorts through the shared comparator instead of a local one", () => {
        // A hand-rolled `[...rows].sort()` in a table file is the copy this
        // module replaced — the filter/option lists it does not cover sort
        // plain arrays of strings and stay allowed.
        for (const [name, src] of clientSources()) {
            const offenders = src.match(/\[\.\.\.\w+\]\.sort\(\(a, b\) => \{/g) || [];
            expect({ file: name, offenders }).toEqual({ file: name, offenders: [] });
        }
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
