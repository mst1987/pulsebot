// Guards for the two navigations that were split into groups (see
// src/web-client/src/lib/settingsSections.ts and the tab groups in
// HistoryPage.tsx).
//
// The client is TSX and this project has no React test renderer, so what is
// checked here are the invariants that fail *silently* — a section that no
// button can reach, a tab that dropped out of every group, an admin-only field
// that ended up in a section everyone with write on "Einstellungen" can open:
//   * every section has a panel and every panel has a section,
//   * a group's sections stay adjacent (the grouping only bundles neighbours,
//     so a stray one would print its heading twice),
//   * the sections holding a full-admin-only field are marked adminOnly, and
//     those fields are still only sent when the server would accept them,
//   * a section that saves itself is marked standalone, so the page's shared
//     save button cannot appear under it,
//   * every per-category setting is rendered in one place only,
//   * every history tab belongs to exactly one group.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

const sectionsSrc = readClient("lib", "settingsSections.ts");
const settingsSrc = readClient("pages", "SettingsPage.tsx");
const historySrc = readClient("pages", "HistoryPage.tsx");

/** The SETTINGS_SECTIONS entries, parsed out of the source. */
function sections() {
    const list = sectionsSrc.match(/export const SETTINGS_SECTIONS[\s\S]*?\n\];/)[0];
    return [...list.matchAll(/\{ id: "([^"]+)", group: "([^"]+)", label: "([^"]+)"([^}]*)\}/g)].map((m) => ({
        id: m[1],
        group: m[2],
        label: m[3],
        adminOnly: /adminOnly: true/.test(m[4]),
        standalone: /standalone: true/.test(m[4]),
    }));
}

/** The section ids the page actually renders a panel for. */
function panelIds() {
    const body = settingsSrc.match(/const panel = \(\) => \{[\s\S]*?\n {4}\};/)[0];
    return [...body.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
}

describe("Einstellungen sections", () => {
    it("parses the section list at all", () => {
        // Sanity: a broken regex above would make every assertion below vacuous.
        expect(sections().length).toBeGreaterThan(10);
    });

    it("gives every section a panel, and every panel a section", () => {
        const ids = sections().map((s) => s.id);
        expect([...ids].sort()).toEqual([...panelIds()].sort());
    });

    it("uses each section id once", () => {
        const ids = sections().map((s) => s.id);
        expect(ids).toEqual([...new Set(ids)]);
    });

    it("keeps the sections of a group together", () => {
        // groupedSections() only bundles neighbours: a section listed away from
        // its group would silently print that heading a second time.
        const groups = sections().map((s) => s.group);
        const firstSeen = groups.filter((g, i) => groups.indexOf(g) === i);
        const collapsed = groups.filter((g, i) => g !== groups[i - 1]);
        expect(collapsed).toEqual(firstSeen);
    });

    it("marks every section holding a full-admin-only field as adminOnly", () => {
        // The API is the real gate (ACCESS_KEYS / requireFullAdmin in
        // apiRoutes/settings.js), but a field shown to someone who cannot save it
        // is a trap: they fill it in and get a 403 for the whole form.
        const byId = Object.fromEntries(sections().map((s) => [s.id, s]));
        for (const id of ["zugang", "berechtigungen", "discord"]) {
            expect({ id, adminOnly: byId[id].adminOnly }).toEqual({ id, adminOnly: true });
        }
    });

    it("sends the access fields only when the server would accept them", () => {
        // All four sit behind canManageAccess in the submit — including the two
        // server ids, which decide which guild the admin-role check runs against.
        const guarded = settingsSrc.match(/\.\.\.\(data\.canManageAccess \? \{[\s\S]*?\} : \{\}\),/)[0];
        for (const field of ["adminRoleIds:", "rolePermissions:", "guildId:", "raidhelperServerId:"]) {
            expect(guarded).toContain(field);
        }
    });

    it("hides the shared save button under a section that saves itself", () => {
        // Two save buttons doing different things is how a change gets lost.
        for (const id of ["lootsync", "raidchars", "raidsheets"]) {
            const section = sections().find((s) => s.id === id);
            expect({ id, standalone: section.standalone }).toEqual({ id, standalone: true });
        }
        // ...and the button follows that flag instead of a hardcoded id list.
        expect(settingsSrc).toContain("const inForm = savesWithForm(active);");
        expect(settingsSrc).toMatch(/\{inForm \? \(/);
    });

    it("configures each per-category setting in exactly one place", () => {
        // The point of the "Kategorien" section: roles, loot tool and sheet used
        // to live in three different tabs, each re-listing the categories.
        const matrix = readClient("components", "CategoryMatrix.tsx");
        for (const prop of ["categoryRoles", "categoryLootTool", "categorySheets"]) {
            expect(matrix).toContain(prop);
            // In the page they appear only as draft state and as props handed to
            // the matrix — never as a second editor of their own.
            const renderedElsewhere = settingsSrc.includes(`value={draft.${prop}}`);
            expect({ prop, renderedElsewhere }).toEqual({ prop, renderedElsewhere: false });
        }
    });

    it("sends the whole sheet map, so clearing a url removes the assignment", () => {
        // settingsStore replaces the stored map with what arrives; an entry left
        // out is an entry deleted, so the page has to send every category it
        // holds — including one whose url was just emptied.
        const submit = settingsSrc.match(/categorySheets: Object\.fromEntries\([\s\S]*?\),/)[0];
        expect(submit).toContain("Object.entries(draft.categorySheets)");
    });
});

describe("Historie & Loot tab groups", () => {
    function tabIds() {
        const list = historySrc.match(/const TABS: \{[\s\S]*?\n\];/)[0];
        return [...list.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]);
    }

    function groupedTabIds() {
        const list = historySrc.match(/const TAB_GROUPS: \{[\s\S]*?\n\];/)[0];
        return [...list.matchAll(/tabs: \[([^\]]+)\]/g)]
            .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    }

    it("puts every tab in exactly one group", () => {
        // A tab missing from the groups is unreachable — the row only renders
        // the open group's tabs; a tab in two groups jumps around when clicked.
        const grouped = groupedTabIds();
        expect(grouped).toEqual([...new Set(grouped)]);
        expect([...grouped].sort()).toEqual([...tabIds()].sort());
    });

    it("derives the open group from the open tab", () => {
        // Persisting the group as well would let the two drift apart — a link to
        // ?tab=items could open the group that doesn't contain it.
        expect(historySrc).toContain("const activeGroup = groupOf(tab);");
        expect(historySrc).not.toMatch(/usePersisted\w*\(\s*"history-group"/);
    });
});
