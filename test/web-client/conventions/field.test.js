// components/ui/Field.tsx (#439): label with its info tooltip, the control, a
// hint and an error line — one building block instead of each module wiring
// FieldLabel by hand. The wrappers keep their module's class (field, set-field,
// dlg-field, …); what is inside looks the same everywhere.
const { read } = require("../clientSource");

const field = read("components/ui/Field.tsx");
const settingsUi = read("components/settings/settingsUi.tsx");
const indexCss = read("index.css");
const settingsCss = read("styles/einstellungen.css");

describe("ui/Field", () => {
    it("draws label, control, hint and error in that order", () => {
        const body = field.slice(field.indexOf("export default function Field"));
        const order = ["<FieldLabel", "{children}", "className=\"hint\"", "className=\"field-error\""].map((s) => body.indexOf(s));
        expect(order.every((i) => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(body).toContain("role=\"alert\"");
        expect(body).toContain("className = \"field\"");
    });

    it("owns FieldLabel and the round InfoTip (no longer local to the settings)", () => {
        expect(field).toMatch(/export function FieldLabel\(/);
        expect(field).toMatch(/export function InfoTip\(/);
        expect(settingsUi).not.toMatch(/function (FieldLabel|InfoTip)\(/);
        expect(read("components/ui/index.ts")).toContain("export { default as Field, FieldLabel, InfoTip } from \"./Field\";");
    });

    it("its styles are shared ones (index.css), not the settings page's", () => {
        for (const rule of [".field-label {", ".field-error {", ".info {"]) {
            expect(indexCss).toContain(rule);
            expect(settingsCss).not.toContain(rule);
        }
        // tokens only
        const err = indexCss.slice(indexCss.indexOf(".field-error {"));
        expect(err.slice(0, err.indexOf("}"))).toContain("var(--high)");
    });

    it.each([
        ["pages/settings/RaidsheetsSection.tsx", "<Field className=\"set-field\" htmlFor=\"rs-name\""],
        ["pages/settings/SettingsReminders.tsx", "<Field className=\"dlg-field\" htmlFor=\"rem-missing\""],
    ])("%s uses it", (file, needle) => {
        expect(read(file)).toContain(needle);
    });
});
