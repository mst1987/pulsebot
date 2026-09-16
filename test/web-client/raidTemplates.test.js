// Raid-Vorlagen (#266): the rules behind the page (src/web-client/src/lib/
// raidTemplates.ts), run for real, and the page's layout decisions, checked on
// the source — the client is TSX without a React renderer here.
//
// The rule module is written to be strippable like settingsLogic.ts; this loader
// removes exactly the syntax it may use (`import type`, `export type`
// declarations and the annotations of a one-line signature).
const fs = require("fs");
const path = require("path");
const { publicVersions } = require("../../src/config/gameVersions");
const server = require("../../src/web/raidTemplates");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

function splitParams(list) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === "=" && list[i + 1] === ">") { cur += "=>"; i++; continue; }
        if ("(<{[".includes(c)) depth++;
        if (")>}]".includes(c)) depth--;
        if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
        cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function load() {
    const lines = read("lib", "raidTemplates.ts").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) {
            let depth = 0;
            for (; i < lines.length; i++) {
                for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
                if (depth === 0 && /;\s*$/.test(lines[i])) break;
            }
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const logic = load();
const versions = publicVersions();
const v = (id) => versions.find((x) => x.id === id);

describe("Raid-Vorlagen rules (client)", () => {
    it("proposes tanks and healers for a size, like the server", () => {
        const cases = [
            ["tbc", ["kara"], 10], ["tbc", ["gruul", "mag"], 25], ["tbc", ["kara"], 25],
            ["classic", ["ony"], 40], ["classic", [], 20], ["forever", ["forever-hyjal"], 20],
        ];
        for (const [version, ids, size] of cases) {
            expect({ version, ids, size, c: logic.proposeComposition(v(version), ids, size) })
                .toEqual({ version, ids, size, c: server.proposeComposition(version, ids, size) });
        }
    });

    it("offers the allowed sizes of the chosen instances, and none without", () => {
        expect(logic.allowedSizes(v("tbc"), ["kara", "ssc"])).toEqual([10, 25]);
        expect(logic.allowedSizes(v("tbc"), [])).toEqual([]);
    });

    it("counts the places left for DPS", () => {
        expect(logic.dpsSlots(40, 2, 8)).toBe(30);
        expect(logic.dpsSlots(10, 6, 6)).toBe(0);
        expect(logic.dpsSlots(null, 2, 3)).toBe(0);
    });

    it("validates like the server: tanks + healers within the size, sane ranges", () => {
        const draft = (over) => ({ ...logic.newDraft(v("tbc")), name: "Kara", ...over });
        const bad = [
            draft({ size: 10, composition: { tank: 5, healer: 6, melee: null, ranged: null } }),
            draft({ composition: { tank: 2, healer: 3, melee: { min: 5, max: 2 }, ranged: null } }),
            draft({ size: 10, composition: { tank: 2, healer: 3, melee: { min: 0, max: 12 }, ranged: null } }),
            draft({ size: 10, composition: { tank: 2, healer: 3, melee: { min: 3, max: null }, ranged: { min: 3, max: null } } }),
            draft({ name: " " }),
        ];
        for (const d of bad) {
            const msg = logic.validateDraft(d);
            expect(msg).not.toBe("");
            expect(server.validateTemplate(server.normalizeTemplate(d))).toBe(msg);
        }
        expect(logic.validateDraft(draft({}))).toBe("");
    });

    it("starts a new draft at the first instance's default size with its suggestion", () => {
        expect(logic.newDraft(v("classic"))).toMatchObject({ versionId: "classic", instanceIds: ["ony"], size: 40 });
        const d = logic.newDraft(v("tbc"));
        expect(d.composition).toMatchObject({ tank: 2, healer: 3 });
    });

    it("labels a row with the version and the categories it is the default for", () => {
        const t = { versionId: "tbc", defaultFor: ["c1", "c2"] };
        expect(logic.templateLabel(t, "TBC", { c1: "Mittwoch-Raid" })).toBe("TBC · Standard für Mittwoch-Raid, c2");
        expect(logic.templateLabel({ versionId: "classic" }, "Classic", {})).toBe("Classic");
    });

    it("filters by version, '' being all", () => {
        const list = [{ versionId: "tbc" }, { versionId: "classic" }];
        expect(logic.filterByVersion(list, "")).toHaveLength(2);
        expect(logic.filterByVersion(list, "classic")).toEqual([{ versionId: "classic" }]);
    });
});

describe("Raid-Vorlagen page", () => {
    const page = read("pages", "RaidTemplatesPage.tsx");
    const comp = read("components", "CompositionEditor.tsx");
    const app = read("App.tsx");
    const raids = read("pages", "RaidsPage.tsx");

    it("is its own route under Raids, linked from the Raid-Events head — no new sidebar entry", () => {
        expect(app).toContain("<Route path=\"raids/raid-templates\" element={<Guard user={user} areas={[\"raids\"]}><RaidTemplatesPage /></Guard>} />");
        expect(raids).toContain("to=\"/raids/raid-templates\"");
        expect(read("..", "..", "config", "menu.json")).not.toContain("raid-templates");
    });

    it("draws one compact row per template: icons, name, label, three values", () => {
        expect(page).toContain("<InstanceIcons icons={iconsOf(t)} />");
        expect(page).toContain("<div className=\"rt-name\">");
        expect(page).toMatch(/<Value label="Größe" value=\{t\.size\} \/>\s*<Value label="Tanks"[^>]*\/>\s*<Value label="Heiler"/);
        expect(page).toContain("Infos fehlen</Badge>");
        expect(page).toContain("Größe ergänzen</Badge>");
        // not the table of stacked forms the collection pattern replaced
        expect(page).not.toMatch(/\.map\(\([^)]*\) => \(?\s*<\w+Form\b/);
    });

    it("filters by game version as a remembered segment", () => {
        expect(page).toContain("usePersistedState(\"raid-templates-version\", \"\")");
        expect(page).toContain("ariaLabel=\"Spielversion\"");
    });

    it("edits in a modal held in the url, one at a time", () => {
        expect(page).toContain("useCollectionEditor(\"edit\")");
        expect(page).toContain("data.templates.find((t) => t.id === editor.editId) || null");
        expect(page).toMatch(/<Modal\s+open\s+onClose=\{onClose\}/);
        expect(page).toContain(">Abbrechen</Button>");
    });

    it("keeps the modal short: size, tanks and healers first, the rest behind Mehr", () => {
        expect(page.indexOf("<SizePicker")).toBeLessThan(page.indexOf("<CompositionEditor"));
        const more = page.indexOf("<details className=\"rt-more\">");
        expect(more).toBeGreaterThan(page.indexOf("<CompositionEditor"));
        for (const later of ["<RoleRanges", "<BuffPicker", "rt-deadline", "Raid-Helper-Vorlage (ID)", "label=\"Fairness\"", "label=\"Wünsche\""]) {
            expect({ later, afterMore: page.indexOf(later) > more }).toEqual({ later, afterMore: true });
        }
    });

    it("builds the editor from the shared plan fields of the event dialog, not its own copies", () => {
        expect(page).toContain("import { BuffPicker, FieldLabel, InstancePicker, NumberInput, RoleRanges, SizePicker, SwitchRow } from \"../components/RaidPlanFields\";");
        for (const copy of ["function NumberField", "function RangeField", "className={`rt-inst", "className={`rt-buff", "className=\"switch-row\"", "{ value: FREE, label: \"frei\" }"]) {
            expect({ copy, inPage: page.includes(copy) }).toEqual({ copy, inPage: false });
        }
        // a migrated template without size keeps its hint next to the size segment
        expect(page).toMatch(/<SizePicker [\s\S]*?\{draft\.size === null && <Badge tone="mid" icon=\{<WarnIcon \/>\}>Größe ergänzen<\/Badge>\}\s*<\/SizePicker>/);
    });

    it("proposes tanks and healers when the size changes", () => {
        expect(page).toMatch(/const changeSize = [\s\S]*?proposeComposition\(version, instanceIds, size\)/);
    });

    it("says what is left for DPS and caps the plus at the size", () => {
        expect(comp).toContain("Plätze\"} für DPS");
        expect(comp).toContain("disabled={disabled || full}");
    });

    it("styles the module in its own stylesheet", () => {
        expect(page).toContain("import \"../styles/raid-templates.css\";");
        expect(comp).toContain("import \"../styles/raid-templates.css\";");
    });
});
