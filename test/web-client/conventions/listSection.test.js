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
const shared = require("../clientSource");

// LF line endings whatever the checkout (the patterns below match on \n)
const readClient = shared.read;

const editorSrc = readClient("lib", "collectionEditor.ts");
const sectionSrc = readClient("components", "ListSection.tsx");

/** Every page/component file of the client, as [name, source]. */
function clientSources() {
    return shared.pageSources();
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
        expect(editorSrc).toContain("editId: open === \"new\" ? \"\" : open");
    });

    it("falls back to the new-editor for an id that is gone", () => {
        // A stale link or an entry deleted in another tab must not leave the
        // editor on a blank screen.
        expect(sectionSrc).toContain("entries.find((e) => idOf(e) === editor.editId) || null");
    });
});

describe("list sections", () => {
    // The sections that manage a collection, with the url param each one uses.
    const SECTIONS = [
        ["pages/settings/RaidsheetsSection.tsx", ["sheet"]],
    ];

    // The modal variant: the same url-held editor, opened as a dialog over the
    // list instead of in its place (design issue #222).
    it("pages/NotifyTemplatesPage.tsx opens its editor as a modal through the shared hook", () => {
        const src = readClient("pages", "NotifyTemplatesPage.tsx");
        expect(src).toContain("useCollectionEditor(\"edit\")");
        expect(src).toMatch(/<Modal\s+open=\{!!editor\.open\}/);
        // an id that is gone opens the new-editor, as ListSection does
        expect(src).toContain("templates.find((t) => t.id === editor.editId) || null");
        // no list-replacing editor panel any more
        expect(src).not.toContain("<ListSection");
    });

    it.each(SECTIONS)("%s opens its editor through the shared hook", (file, params) => {
        const src = readClient(file);
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

    describe("Recruitment: the editor as a modal over the list", () => {
        // Recruitment keeps the list visible and opens its editors as dialogs
        // (design #215) — still one at a time and still in the url.
        const src = readClient("pages", "recruitment");

        it("opens both editors through the shared hook, each with its own param", () => {
            expect(src).toContain("useCollectionEditor(\"edit\")");
            expect(src).toContain("useCollectionEditor(\"editpost\")");
            expect(src).not.toContain("<ListSection");
        });

        it("renders every editor in a Modal whose close ends the editor", () => {
            for (const name of ["TemplateEditor", "PostEditor", "PostDialog"]) {
                const body = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
                expect({ name, modal: body.includes("<Modal") }).toEqual({ name, modal: true });
                expect({ name, onClose: body.includes("open onClose={onClose}") }).toEqual({ name, onClose: true });
                expect({ name, cancel: body.includes(">Abbrechen</Button>") }).toEqual({ name, cancel: true });
            }
            expect(src).toContain("onSaved={afterChange} onClose={templateEditor.close}");
            expect(src).toMatch(/onPosted=\{afterChange\} onClose=\{postEditor\.close\}/);
        });

        it("falls back to the new-editor for an id that is gone", () => {
            expect(src).toContain("data.templates.find((t) => t.id === templateEditor.editId) || null");
            expect(src).toContain("{postEditor.open && !editingPost && (");
        });
    });

    it("puts the way back in every editor", () => {
        // EditorPanel carries it for all of them, so a section can't ship an
        // editor with no way out but the browser's back button.
        // (the default label comes from the dictionary, in the page's language)
        expect(sectionSrc).toContain("{backLabel ?? t(\"list.back\")}");
        expect(shared.dictionary("de")["list.back"]).toBe("Zurück zur Liste");
        expect(sectionSrc).toMatch(/<EditorPanel title=\{editorTitle\(entry\)\} onClose=\{editor\.close\}>/);
    });
});
