// Guards for the list/editor pattern (src/web-client/src/lib/collectionEditor.ts
// and src/web-client/src/components/ListSection.tsx).
//
// A section that manages a collection shows the list first and exactly one
// editor at a time, in the list's place. The client is TSX and there is no React
// test renderer here, so what is checked are the invariants that fail silently:
//   * no section renders one expanded form per entry again — that is the thing
//     this replaced,
//   * every list section goes through the shared components rather than
//     re-inventing a heading row and a back button,
//   * the open editor lives in the url and leaves the page's other params
//     (the settings section, a tab) alone,
//   * a "new" editor asks the server for no entry to edit,
//   * two editors on the same page use different url params.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

const editorSrc = readClient("lib", "collectionEditor.ts");
const sectionSrc = readClient("components", "ListSection.tsx");

/** Every page/component file of the client, as [name, source]. */
function clientSources() {
    const out = [];
    for (const dir of ["pages", "components"]) {
        for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
            if (file.endsWith(".tsx")) out.push([`${dir}/${file}`, readClient(dir, file)]);
        }
    }
    return out;
}

describe("collection editor", () => {
    it("keeps the page's other url params while opening and closing", () => {
        // Einstellungen carries ?section=<id>; wiping it on "Bearbeiten" would
        // throw the admin back to the first section on the way out of the editor.
        const set = editorSrc.match(/const set = \(value: string\) => \{[\s\S]*?\n {4}\};/)[0];
        expect(set).toContain("new URLSearchParams(searchParams)");
        expect(set).toContain("params.delete(param)");
        expect(editorSrc).not.toMatch(/setSearchParams\(\{/);
    });

    it("asks the server for no entry while creating", () => {
        // "new" is not an id: a page that passes it on as one would have the
        // server look up a template that does not exist.
        expect(editorSrc).toContain('editId: open === "new" ? "" : open');
    });

    it("falls back to the new-editor for an id that is gone", () => {
        // A stale link or an entry deleted in another tab must not leave the
        // editor on a blank screen.
        expect(sectionSrc).toContain('entries.find((e) => idOf(e) === editor.editId) || null');
    });
});

describe("list sections", () => {
    // The sections that manage a collection, with the url param each one uses.
    const SECTIONS = [
        ["pages/SettingsPage.tsx", ["sheet"]],
        ["pages/NotifyTemplatesPage.tsx", ["edit"]],
        ["pages/RecruitmentPage.tsx", ["edit", "editpost"]],
    ];

    it.each(SECTIONS)("%s opens its editor through the shared hook", (file, params) => {
        const [dir, name] = file.split("/");
        const src = readClient(dir, name);
        expect(src).toContain("<ListSection");
        for (const param of params) expect(src).toContain(`useCollectionEditor("${param}")`);
    });

    it.each(SECTIONS)("%s gives each of its collections its own url param", (file, params) => {
        // Two editors sharing a param on one page would close each other, and
        // the page would end up showing neither. Across pages the same name is
        // fine — a url param only ever means something on its own page.
        expect(params).toEqual([...new Set(params)]);
    });

    it("renders no form per entry any more", () => {
        // The pattern this replaced: `entries.map(e => <SomethingForm …/>)`,
        // which turned a dozen templates into a page of stacked forms.
        for (const [name, src] of clientSources()) {
            const offenders = src.match(/\.map\(\([^)]*\) => \(?\s*<\w+Form\b/g) || [];
            expect({ file: name, offenders }).toEqual({ file: name, offenders: [] });
        }
    });

    it("puts the way back in every editor", () => {
        // EditorPanel carries it for all of them, so a section can't ship an
        // editor with no way out but the browser's back button.
        expect(sectionSrc).toContain("backLabel = \"Zurück zur Liste\"");
        expect(sectionSrc).toMatch(/<EditorPanel title=\{editorTitle\(entry\)\} onClose=\{editor\.close\}>/);
    });
});
