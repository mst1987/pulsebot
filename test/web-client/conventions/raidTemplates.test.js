// Raid-Vorlagen (#266): the rules a render cannot see — a route of its own
// under Raids without a sidebar entry, the editor built from the shared plan
// fields of the event dialog (no copies), and its own stylesheet. The page is
// rendered in Vitest (src/web-client/src/pages/RaidTemplatesPage.test.tsx,
// components/RaidPlanFields.test.tsx, components/CompositionEditor.test.tsx),
// the rules in lib/raidTemplates.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("raid templates conventions", () => {
    const page = read("pages", "RaidTemplatesPage.tsx");

    it("is its own route under Raids, linked from the Raid-Events head — no new sidebar entry", () => {
        expect(read("App.tsx")).toContain("<Route path=\"raids/raid-templates\" element={<Guard user={user} areas={[\"raids\"]}><RaidTemplatesPage /></Guard>} />");
        expect(read("pages", "RaidsPage.tsx")).toContain("to=\"/raids/raid-templates\"");
        expect(read("..", "..", "config", "menu.json")).not.toContain("raid-templates");
    });

    it("builds the editor from the shared plan fields of the event dialog, not its own copies", () => {
        expect(page).toContain("import { AppearanceFields, BuffPicker, FieldLabel, InstancePicker, NumberInput, RoleRanges, SizePicker, SwitchRow } from \"../components/RaidPlanFields\";");
        for (const copy of ["function NumberField", "function RangeField", "className={`rt-inst", "className={`rt-buff", "className=\"switch-row\"", "{ value: FREE, label: \"frei\" }"]) {
            expect({ copy, inPage: page.includes(copy) }).toEqual({ copy, inPage: false });
        }
        // the leading instance's colour comes from the shared rule, not a copy of it
        const fields = read("components", "RaidPlanFields.tsx");
        expect(fields).toContain("leadInstance(version, instanceIds)");
    });

    it("styles the module in its own stylesheet", () => {
        expect(page).toContain("import \"../styles/raid-templates.css\";");
        expect(read("components", "CompositionEditor.tsx")).toContain("import \"../styles/raid-templates.css\";");
    });
});
