// The raid plan editor's two views (Oct 2026), checked on the stylesheet: the behaviour (which view shows what, the strip,
// the tool row, the slim list) runs in Vitest (src/web-client/src/pages/raid-detail/raidplan/BoardWorkspace.views.test.tsx,
// SectionStrip.test.tsx, planView.test.ts). Here only what a render in jsdom cannot see.
const { read } = require("../clientSource");

describe("the raid plan's views (Oct 2026)", () => {
    const css = read("styles/raidplan/index.css");
    const views = read("styles/raidplan/views.css");

    it("comes last in the raid plan's stylesheet, so it adjusts the earlier editor rules", () => {
        const index = require("fs").readFileSync(require("path").join(__dirname, "../../../src/web-client/src/styles/raidplan/index.css"), "utf8");
        const imports = [...index.matchAll(/@import "\.\/([\w-]+)\.css";/g)].map((m) => m[1]);
        expect(imports[imports.length - 1]).toBe("views");
        expect(css).toContain(".rp-tasksview .rp-cards { display: block; columns: 2 420px;");
    });

    it("shows a row's icon buttons on hover or keyboard focus only, and only where there is hover", () => {
        expect(views).toMatch(/@media \(hover: hover\) \{[\s\S]*\.rp-tasksview \.rp-editlist \.rp-line \.rp-line-acts \.rp-line-btn \{ opacity: 0;/);
        expect(views).toContain(".rp-tasksview .rp-editlist .rp-line:focus-within .rp-line-acts .rp-line-btn");
        // hidden by opacity, never by display / visibility: Tab still reaches them
        expect(views).not.toMatch(/\.rp-line-btn[^{]*\{[^}]*(display: none|visibility: hidden)/);
    });

    it("puts the map beside a slim column (about 220 px), stacked under 1000 px, never beside the task list", () => {
        expect(views).toContain(".rp-mapstage { display: grid; grid-template-columns: minmax(0, 1fr) auto;");
        expect(views).toContain(".rp-mapstage .rp-side { width: 220px; }");
        expect(views).toMatch(/@media \(max-width: 1000px\) \{\s*\.rp-mapstage \{ grid-template-columns: minmax\(0, 1fr\); \}/);
        expect(views).not.toMatch(/\.rp-tasksview[^{]*\.rp-board/);
    });
});
