// Guards for the two navigations that were split into groups (see
// src/web-client/src/lib/settingsSections.ts and the areas in
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
//   * every history view belongs to exactly one area.
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
        // All of them sit behind canManageAccess in the submit — including the
        // two server ids, which decide which guild the admin-role check runs
        // against, and the two credential blocks the server refuses from a
        // limited settings user (CREDENTIAL_KEYS in apiRoutes/settings.js).
        // the block closes on its own line at the spread's indentation — the
        // inner secret spreads (`? { apiKey } : {}),`) close on theirs
        const guarded = settingsSrc.match(/\.\.\.\(data\.canManageAccess \? \{[\s\S]*?\n {16}\} : \{\}\),/)[0];
        for (const field of ["adminRoleIds:", "rolePermissions:", "guildId:", "raidhelperServerId:", "anthropic:", "warcraftlogsV2:"]) {
            expect(guarded).toContain(field);
        }
        const unguarded = settingsSrc.slice(settingsSrc.indexOf(guarded) + guarded.length);
        expect(unguarded).not.toMatch(/^\s*anthropic: \{/m);
        expect(unguarded).not.toMatch(/^\s*warcraftlogsV2: \{/m);
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

describe("Historie & Loot areas", () => {
    function tabIds() {
        const union = historySrc.match(/type Tab = ([^;]+);/)[1];
        return [...union.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    }

    function areaViewIds() {
        const list = historySrc.match(/const AREAS: \{[\s\S]*?\n\];/)[0];
        return [...list.matchAll(/\{ id: "([^"]+)", label: "[^"]+" \}/g)].map((m) => m[1]);
    }

    it("puts every view in exactly one area", () => {
        // A view missing from the areas is unreachable — the subnav only renders
        // the open area's views; a view in two areas jumps around when clicked.
        const views = areaViewIds();
        expect(views).toEqual([...new Set(views)]);
        expect([...views].sort()).toEqual([...tabIds()].sort());
    });

    it("has three areas, the import and the inbox no longer among the views", () => {
        const list = historySrc.match(/const AREAS: \{[\s\S]*?\n\];/)[0];
        expect([...list.matchAll(/^ {4}\{\s*id: "([^"]+)"/gm)].map((m) => m[1])).toEqual(["loot", "raids", "chars"]);
        expect(tabIds()).not.toContain("import");
        expect(tabIds()).not.toContain("inbox");
    });

    it("derives the open area from the open view", () => {
        // Persisting the area as well would let the two drift apart — a link to
        // ?tab=items could open the area that doesn't contain it. Resolved
        // against the areas the user may see, so the loot-only view lands in
        // its own area instead of falling back to "Raids & Logs".
        expect(historySrc).toContain("const activeArea = areas.find((a) => a.views.some((v) => v.id === tab)) || areas[0];");
        expect(historySrc).not.toMatch(/usePersisted\w*\(\s*"history-(group|area)"/);
    });

    it("offers only the areas the visitor's permissions cover", () => {
        // The narrower "loot" area opens the loot area alone (permissions.js);
        // rendering AREAS directly would put views on screen whose data the
        // server refuses to send.
        expect(historySrc).toContain("const areas = fullHistory ? AREAS : AREAS.filter((a) => a.id === \"loot\");");
        expect(historySrc).toContain("{areas.length > 1 && (");
    });

    it("keeps the old ?tab=import and ?tab=inbox links working", () => {
        // Posted in Discord before the import became a dialog and the inbox a page.
        expect(historySrc).toContain("const LEGACY_IMPORT = \"import\";");
        expect(historySrc).toContain("const LEGACY_INBOX = \"inbox\";");
        expect(historySrc).toContain("useState(legacyTab === LEGACY_IMPORT && canWrite)");
        expect(historySrc).toContain("if (legacyTab === LEGACY_INBOX && fullHistory) return <Navigate to=\"/history/inbox\" replace />;");
    });
});
