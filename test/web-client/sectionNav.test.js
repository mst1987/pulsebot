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
//   * an id merged away in the redesign (#224) still reaches its new section,
//   * a section that saves itself is marked standalone, and the save bar
//     follows the draft instead of a button at the end of a form,
//   * every per-category setting is rendered in one place only,
//   * every history view belongs to exactly one area.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

// LF regardless of the checkout: git's autocrlf hands Windows the files with CRLF, and the patterns below match on \n
function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");
}

const sectionsSrc = readClient("lib", "settingsSections.ts");
const settingsSrc = readClient("pages", "SettingsPage.tsx");
const historySrc = readClient("pages", "HistoryPage.tsx");

/** The SETTINGS_SECTIONS entries, parsed out of the source. */
function sections() {
    const list = sectionsSrc.match(/export const SETTINGS_SECTIONS[\s\S]*?\n\];/)[0];
    return [...list.matchAll(/\{ id: "([^"]+)", group: "([^"]+)", label: "([^"]+)", icon: "([^"]+)"([^}]*)\}/g)].map((m) => ({
        id: m[1],
        group: m[2],
        label: m[3],
        icon: m[4],
        adminOnly: /adminOnly: true/.test(m[5]),
        standalone: /standalone: true/.test(m[5]),
    }));
}

/** The LEGACY_SECTIONS map, parsed out of the source. */
function legacy() {
    const block = sectionsSrc.match(/export const LEGACY_SECTIONS[\s\S]*?\n\};/)[0];
    return Object.fromEntries([...block.matchAll(/(\w+): "([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

/** The section ids the page actually renders a panel for. */
function panelIds() {
    const body = settingsSrc.match(/const panel = \(\) => \{[\s\S]*?\n {4}\};/)[0];
    return [...body.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
}

describe("Einstellungen sections", () => {
    it("parses the section list at all", () => {
        // Sanity: a broken regex above would make every assertion below vacuous.
        expect(sections().length).toBe(10);
    });

    it("keeps ten sections in four groups, each with a WoW icon", () => {
        expect(sections().map((s) => s.id)).toEqual([
            "berechtigungen", "verbindungen", "discordserver", "kategorien",
            "raids", "raidsheets", "topitems", "logs", "recruitment", "auktionen",
        ]);
        expect([...new Set(sections().map((s) => s.group))]).toEqual(["Zugang", "Verbindungen", "Raid-Kategorien", "Module"]);
        for (const s of sections()) expect({ id: s.id, icon: /^[a-z0-9_]+$/.test(s.icon) }).toEqual({ id: s.id, icon: true });
    });

    it("gives every section a panel, and every panel a section", () => {
        const ids = sections().map((s) => s.id);
        expect([...ids].sort()).toEqual([...panelIds()].sort());
    });

    it("keeps the sections of a group together", () => {
        // groupedSections() only bundles neighbours: a section listed away from
        // its group would silently print that heading a second time.
        const groups = sections().map((s) => s.group);
        const firstSeen = groups.filter((g, i) => groups.indexOf(g) === i);
        const collapsed = groups.filter((g, i) => g !== groups[i - 1]);
        expect(collapsed).toEqual(firstSeen);
    });

    it("redirects every merged-away section id to a section that exists", () => {
        // Links such as ?section=raidchars and ids remembered from older builds
        // have to land where the setting lives now.
        const ids = new Set(sections().map((s) => s.id));
        const map = legacy();
        expect(Object.keys(map).sort()).toEqual(["anthropic", "battlenet", "discord", "loot", "lootsync", "raidchars", "warcraftlogs", "zugang"]);
        for (const [from, to] of Object.entries(map)) expect({ from, exists: ids.has(to) }).toEqual({ from, exists: true });
        expect(map.raidchars).toBe("kategorien");
        expect(map.loot).toBe("topitems");
        // resolveSection follows the map, and the url accepts the old ids at all.
        expect(sectionsSrc).toContain("const id = LEGACY_SECTIONS[stored] || stored;");
        expect(settingsSrc).toContain('usePersistedSearchParam(\n        "settings-section", "section", "berechtigungen", SECTION_PARAM_IDS,');
    });

    it("marks the permission section adminOnly", () => {
        // The API is the real gate (ACCESS_KEYS / requireFullAdmin), but a field
        // shown to someone who cannot save it is a trap.
        expect(sections().find((s) => s.id === "berechtigungen").adminOnly).toBe(true);
        // Which server is the event server decides where the role check runs (GUILD_KEYS).
        expect(sections().find((s) => s.id === "discordserver").adminOnly).toBe(true);
    });

    it("sends the access fields only when the server would accept them", () => {
        const guarded = settingsSrc.match(/\.\.\.\(data\.canManageAccess \? \{[\s\S]*?\n {16}\} : \{\}\),/)[0];
        for (const field of ["adminRoleIds:", "rolePermissions:", "baseAccess:", "userPermissions:"]) {
            expect(guarded).toContain(field);
        }
        // The connection blocks are no longer part of the page's save at all —
        // each modal sends its own (connectionPatch in settingsLogic.ts).
        const submit = settingsSrc.match(/const submit = async \(\) => \{[\s\S]*?\n {4}\};/)[0];
        for (const block of ["anthropic:", "warcraftlogsV2:", "blizzard:", "guildId:", "raidhelperServerId:"]) {
            expect({ block, inSubmit: submit.includes(block) }).toEqual({ block, inSubmit: false });
        }
    });

    it("hides the credentials of a limited settings user in the connection cards", () => {
        const logic = readClient("lib", "settingsLogic.ts");
        expect(logic).toContain('return canManageAccess ? ["discord", "battlenet", "wcl", "anthropic", "lootsync"] : ["battlenet"];');
        expect(readClient("components", "SettingsConnections.tsx")).toContain("visibleConnections(data.canManageAccess)");
    });

    it("marks the self-saving sections standalone, and the save bar follows the draft", () => {
        for (const id of ["verbindungen", "discordserver", "raidsheets"]) {
            const section = sections().find((s) => s.id === id);
            expect({ id, standalone: section.standalone }).toEqual({ id, standalone: true });
        }
        // The one save button of old sat at the end of the form; the bar appears
        // as soon as the draft differs and counts the changes.
        expect(settingsSrc).toContain("const changes = draftChanges(saved, draft, {");
        expect(settingsSrc).toMatch(/\{changes\.length > 0 && \(\s*<div className="savebar"/);
        expect(settingsSrc).toContain("setDraft(toDraft(data.config))");
        expect(settingsSrc).not.toMatch(/<form className="card-form" onSubmit=\{submit\}/);
    });

    it("shows icons and count badges in the section column", () => {
        const nav = readClient("components", "SectionNav.tsx");
        expect(nav).toContain("icon?: string; badge?: NavBadge | null");
        expect(nav).toContain("<WowIcon name={item.icon} size={24} />");
        expect(nav).toMatch(/<Badge count tone=\{item\.badge\.tone\}/);
        expect(settingsSrc).toContain("missingConnections(data, tokens, data.canManageAccess)");
    });

    it("configures each per-category setting in exactly one place", () => {
        const matrix = readClient("components", "CategoryMatrix.tsx");
        for (const prop of ["categoryRoles", "categoryLootTool", "categorySheets"]) {
            expect(matrix).toContain(prop);
            const renderedElsewhere = settingsSrc.includes(`value={draft.${prop}}`);
            expect({ prop, renderedElsewhere }).toEqual({ prop, renderedElsewhere: false });
        }
        // Raider → Charakter is no longer a section with its own category picker.
        expect(settingsSrc).not.toContain("RaiderCharactersTab");
        expect(matrix).toContain("<RaiderCharactersModal");
    });

    it("sends the whole sheet map, so clearing a url removes the assignment", () => {
        const submit = settingsSrc.match(/categorySheets: Object\.fromEntries\([\s\S]*?\),/)[0];
        expect(submit).toContain("Object.entries(draft.categorySheets)");
    });

    it("turns the hint paragraphs into tooltips", () => {
        expect(settingsSrc).not.toContain('className="hint"');
        expect(settingsSrc).not.toContain("<p className=\"note\">");
        expect(readClient("components", "RolePermissions.tsx")).not.toContain('className="hint"');
        expect(readClient("components", "CategoryMatrix.tsx")).not.toContain('className="hint"');
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
