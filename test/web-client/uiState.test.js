// Guards for the admin client's remembered UI state (src/web-client/src/lib/persistedState.ts
// and its callers).
//
// The hooks themselves are TSX-only and there is no React test renderer in this
// project, so what is checked here are the invariants that break silently and
// only show up as "my filter reset itself" or "my pasted export is gone":
//   * the two storages stay apart — view preferences in localStorage, form
//     drafts in sessionStorage, each under its own key prefix,
//   * a draft that was submitted is dropped instead of coming back,
//   * every tab/filter selection goes through a persisted hook rather than a
//     plain useState that dies with the component,
//   * no two of them share a storage key, which would couple unrelated pages.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

const persistedState = readClient("lib", "persistedState.ts");

// Every page/component file of the client, as [name, source].
function clientSources() {
    const out = [];
    for (const dir of ["pages", "components"]) {
        for (const file of fs.readdirSync(path.join(CLIENT, dir))) {
            if (file.endsWith(".tsx")) out.push([`${dir}/${file}`, readClient(dir, file)]);
        }
    }
    return out;
}

describe("persistedState hooks", () => {
    it("keeps view preferences and form drafts in separate stores", () => {
        // A draft is transient by design (sessionStorage): a loot export pasted
        // today must not greet the admin again next week, while a chosen tab must.
        expect(persistedState).toContain('const PREFIX = "eh-";');
        expect(persistedState).toContain('const DRAFT_PREFIX = "eh-draft-";');
        expect(persistedState).toMatch(/session \? window\.sessionStorage : window\.localStorage/);
        // usePersistedState never touches the session store...
        const viewHook = persistedState.match(/export function usePersistedState[\s\S]*?\n}/)[0];
        expect(viewHook).not.toContain("true)");
        // ...and useDraftState always does (read/write/remove all pass session=true).
        // \r?\n throughout: the checkout's line endings are left to core.autocrlf,
        // so a hard \n only matches on the CI's LF checkout, not on a Windows one.
        const draftHook = persistedState.match(/export function useDraftState[\s\S]*?\r?\n}\r?\n/)[0];
        expect(draftHook).toMatch(/read\(fullKey, initial, true\)/);
        expect(draftHook).toMatch(/write\(fullKey, value, true\)/);
        expect(draftHook).toMatch(/remove\(fullKey, true\)/);
    });

    it("survives a storage that throws (private mode, disabled cookies)", () => {
        // Every storage access sits in its own try/catch — an admin in private
        // browsing loses the convenience, not the page.
        const helpers = persistedState.match(/function (store|read|write|remove)(<T>)?\([\s\S]*?\n}/g);
        expect(helpers).toHaveLength(4);
        for (const helper of helpers) expect(helper).toContain("} catch {");
    });

    it("does not persist the defaults before the user chose anything", () => {
        // Both hooks skip the write triggered by their own mount, so an untouched
        // form/page leaves no stored state behind.
        const mountGuards = persistedState.match(/if \(!mounted\.current\) \{ mounted\.current = true; return; \}/g);
        expect(mountGuards).toHaveLength(2);
    });

    it("keeps a cleared draft cleared", () => {
        // clear() resets to the initial value, and that reset must not be written
        // straight back into storage — otherwise the finished form comes back.
        expect(persistedState).toContain("if (skipWrite.current) { skipWrite.current = false; return; }");
        const clear = persistedState.match(/const clear = \(\) => \{[\s\S]*?\n {4}\};/)[0];
        expect(clear).toContain("skipWrite.current = true");
        expect(clear).toContain("remove(fullKey, true)");
    });

    it("only accepts a remembered view that still exists", () => {
        // A tab id from an older build would otherwise select nothing at all.
        const hook = persistedState.match(/export function usePersistedSearchParam[\s\S]*?\r?\n}\r?\n/)[0];
        expect(hook).toContain("allowed as readonly string[]).includes(v)");
        expect(hook).toMatch(/pick\(searchParams\.get\(param\)\) \?\? pick\(read<string>\(fullKey, ""\)\) \?\? fallback/);
    });
});

describe("client state persistence", () => {
    // Pages whose tab/view selection has to outlive both a tab switch and the
    // visit, with the storage key each one uses.
    const TAB_PAGES = [
        ["pages/HistoryPage.tsx", "history-tab"],
        ["pages/HistoryCharPage.tsx", "history-char-tab"],
        ["pages/RaidDetailPage.tsx", "raid-detail-tab"],
        ["pages/ClaPage.tsx", "cla-view"],
        ["pages/RecruitmentPage.tsx", "recruitment-view"],
        ["pages/RaidsPage.tsx", "raids-category"],
        ["pages/SettingsPage.tsx", "settings-section"],
    ];

    it.each(TAB_PAGES)("%s remembers its open tab as %s", (file, key) => {
        const [dir, name] = file.split("/");
        const src = readClient(dir, name);
        expect(src).toMatch(/usePersisted(State|SearchParam)(<[^>]*>)?\(/);
        expect(src).toContain(`"${key}"`);
    });

    it("holds no tab or view selection in a plain useState", () => {
        // Such a selection is lost the moment the page unmounts, which is exactly
        // what switching tabs in the shell does.
        for (const [name, src] of clientSources()) {
            const offenders = src.match(/const \[(tab|view|activeTab|sort|filter)\w*, set\w+\] = useState/g) || [];
            expect({ file: name, offenders }).toEqual({ file: name, offenders: [] });
        }
    });

    it("keeps every loot import form as a draft", () => {
        // Re-pasting an export is the one step that cannot be redone from memory.
        for (const [name, src] of clientSources()) {
            if (!src.includes("importLoot(")) continue;
            expect({ file: name, draft: /useDraftState(<[^>]*>)?\(/.test(src) }).toEqual({ file: name, draft: true });
        }
    });

    it("gives per-event and per-template drafts their own key", () => {
        // One shared key would offer raid A's pasted export inside raid B.
        const detail = readClient("pages", "RaidDetailPage.tsx");
        expect(detail).toContain("`raid-loot-import:${eventId}`");
        expect(detail).toContain("`raid-softres:${eventId}`");
        const recruitment = readClient("pages", "RecruitmentPage.tsx");
        expect(recruitment).toContain("`recruitment-template:${editing?.id ?? \"new\"}`");
        expect(recruitment).toContain("`recruitment-post:${post.id}`");
    });

    it("never reuses a storage key across two features", () => {
        const seen = new Map();
        for (const [name, src] of clientSources().concat([["lib/persistedState.ts", ""]])) {
            for (const [, key] of src.matchAll(/usePersisted(?:State|SearchParam)(?:<[^>]*>)?\(\s*"([^"]+)"/g)) {
                expect(seen.has(key) ? `${key} also in ${seen.get(key)}` : key).toBe(key);
                seen.set(key, name);
            }
            for (const [, key] of src.matchAll(/useDraftState(?:<[^>]*>)?\(\s*"([^"]+)"/g)) {
                const full = `draft:${key}`;
                expect(seen.has(full) ? `${full} also in ${seen.get(full)}` : full).toBe(full);
                seen.set(full, name);
            }
        }
        // Sanity: the scan found the keys at all.
        expect(seen.size).toBeGreaterThan(8);
    });
});
