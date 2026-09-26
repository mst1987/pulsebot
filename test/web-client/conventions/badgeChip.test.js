// ui/Badge (tone, size, removable) and ui/Chip (#439): the local variants they
// replace (.hl-x, .chip-x, .badge.ros-mini, hand-written "badge chip" buttons)
// must not come back, and their look moved into index.css unchanged.
const { read } = require("../clientSource");

const badge = read("components/ui/Badge.tsx");
const chip = read("components/ui/Chip.tsx");
const css = read("index.css");

describe("ui/Badge", () => {
    it("takes a size and an optional remove button", () => {
        expect(badge).toContain("size = \"md\"");
        expect(badge).toContain("size === \"sm\" ? \"sm\" : \"\"");
        expect(badge).toMatch(/\{onRemove && <RemoveX label=\{removeLabel \|\| removeTip \|\| ""\} tip=\{removeTip\} onRemove=\{onRemove\} \/>\}/);
        expect(badge).toMatch(/<button type="button" className="badge-x" aria-label=\{label\}/);
    });

    it("has its variants in the shared stylesheet", () => {
        expect(css).toContain(".badge.sm { font-size: 11px; padding: 0 6px; }");
        expect(css).toMatch(/\n\.badge-x \{ display: inline-grid;[^}]*width: 15px; height: 15px;/);
        expect(css).toContain(".badge-x svg { width: 10px; height: 10px; }");
    });
});

describe("ui/Chip", () => {
    it("is a toggle button or a removable label, both a larger badge", () => {
        expect(chip).toContain("[\"badge\", \"chip\", tone || \"\", className]");
        expect(chip).toMatch(/<button type="button" className=\{cls\} aria-pressed=\{pressed\}/);
        expect(chip).toContain("{onRemove && <RemoveX");
    });

    it("keeps the settings chips' look", () => {
        expect(css).toContain(".chip-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }");
        expect(css).toContain(".badge.chip { font-size: 12.5px; padding: 5px 10px; cursor: pointer; font-family: var(--font-mono); }");
        expect(css).toContain(".badge.chip .badge-x svg { width: 12px; height: 12px; }");
        expect(read("styles/einstellungen.css")).not.toContain(".badge.chip");
    });

    it("is exported with the other building blocks", () => {
        const index = read("components/ui/index.ts");
        expect(index).toContain("export { default as Chip } from \"./Chip\";");
        expect(index).toContain("export { default as Badge, RemoveX, type Tone, type BadgeSize } from \"./Badge\";");
    });
});

describe("the places that use them", () => {
    it("the loot filters' active filters are removable badges", () => {
        expect(read("components/LootFilters.tsx")).toContain("<Badge key={f.key} tone={f.tone} onRemove={f.onRemove}");
        expect(read("styles/historie-loot.css")).not.toContain(".hl-x");
    });

    it("the roster's small badges use size=\"sm\"", () => {
        const roster = read("pages/roster");
        expect(roster).not.toContain("ros-mini");
        expect((roster.match(/size="sm" tip=/g) || []).length).toBe(2);
    });

    it("the settings' channel list and raider roles are chips", () => {
        const settings = read("pages/settings");
        expect(settings).toContain("<Chip");
        expect(settings).not.toContain("chip-x");
        const matrix = read("components/CategoryMatrix.tsx");
        expect(matrix).toMatch(/<Chip key=\{r\.id\} tone=\{on \? "accent" : undefined\} pressed=\{on\}/);
        expect(matrix).not.toContain("className={`badge chip");
    });
});
