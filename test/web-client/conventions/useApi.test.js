// One way to load what a page shows (#437): hooks/useApi.ts over the pure
// rules in lib/asyncState.ts, drawn by components/ui/AsyncView.tsx. The race
// protection is what matters most and is tested here without React: a call is
// numbered when it starts, and only the newest call's answer counts.
// The rules themselves run in src/web-client/src/lib/useApi.test.ts (Vitest).
const fs = require("fs");
const path = require("path");
const { CLIENT, read, sourceFiles } = require("../clientSource");

// every .ts/.tsx of the app (the client's own tests left out)
const walk = (dir) => sourceFiles(path.relative(CLIENT, dir));

describe("hooks/useApi.ts", () => {
    const hook = read("hooks/useApi.ts");

    it("numbers every call and settles against the newest number", () => {
        expect(hook).toContain("const ticket = ++latest.current;");
        expect(hook).toMatch(/settled\(s, ticket, latest\.current, \{ ok: true, data \}\)/);
        expect(hook).toMatch(/settled\(s, ticket, latest\.current, \{ ok: false, error \}\)/);
        // leaving the page or changing the inputs makes every running call stale
        expect(hook).toMatch(/const counter = latest;[\s\S]*return \(\) => \{ counter\.current\+\+; \};/);
    });

    it("re-runs on the caller's deps and on enabled, and gives the page reload and setData", () => {
        expect(hook).toContain("}, [enabled, ...deps]);");
        expect(hook).toMatch(/export function useApi<T>\(fn: \(\) => Promise<T>, deps: DependencyList, \{ enabled = true, initial = null \}: UseApiOptions<T> = \{\}\): UseApi<T>/);
        expect(hook).toContain("return { ...state, reload, setData };");
        // the one exhaustive-deps exception in the hook is explained on the spot
        expect(hook.match(/eslint-disable-next-line react-hooks\/exhaustive-deps/g)).toHaveLength(1);
        expect(hook).toContain("the caller's deps are the request's inputs");
    });

    it("draws error, then loader, then data — the order the pages had by hand", () => {
        const view = read("components/ui/AsyncView.tsx");
        const order = [view.indexOf("if (state.error)"), view.indexOf("if (state.data === null)"), view.indexOf("children(state.data)")];
        expect(order.every((i) => i >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(read("components/ui/index.ts")).toContain("export { default as AsyncView } from \"./AsyncView\";");
    });
});

describe("the pages load through useApi", () => {
    const files = walk(CLIENT).map((f) => ({ rel: path.relative(CLIENT, f).split(path.sep).join("/"), src: fs.readFileSync(f, "utf8") }));

    it("keeps its own ApiError state only where the loading is a job, not a request", () => {
        // DropCheckPage and LootCouncilPage load through useJobs().run() (a job toast the
        // page survives); everything else asks useApi. A new page goes on that list only
        // with a reason.
        const allowed = ["pages/lootcouncil/DropCheckPage.tsx", "pages/LootCouncilPage.tsx"];
        const own = files.filter((f) => /useState<ApiError \| null>/.test(f.src)).map((f) => f.rel);
        expect(own.sort()).toEqual(allowed.sort());
    });

    it("has no .then(setX).catch(setError) load any more", () => {
        const hits = files.filter((f) => /\.then\(set\w+\)\.catch\(\(?\w*:?\s*\w*\)?\s*=>?\s*setError|\.then\(set\w+\)\.catch\(setError\)/.test(f.src)).map((f) => f.rel);
        expect(hits).toEqual([]);
    });

    it("explains every silent catch that is left", () => {
        // a request whose failure is deliberately not shown carries a comment on the lines above
        for (const f of files) {
            const lines = f.src.split("\n");
            lines.forEach((line, i) => {
                if (!line.includes(".catch(() => undefined)")) return;
                const above = lines.slice(Math.max(0, i - 10), i).join("\n");
                expect({ file: f.rel, line: i + 1, explained: /\/\/|\/\*/.test(above) }).toEqual({ file: f.rel, line: i + 1, explained: true });
            });
        }
    });

    it("uses useApi on the pages the issue named", () => {
        for (const rel of ["pages/roster/RosterPage.tsx", "pages/history/HistoryPage.tsx", "pages/RaidsPage.tsx", "pages/settings/SettingsPage.tsx", "pages/RaidDetailPage.tsx", "pages/DashboardPage.tsx"]) {
            const src = files.find((f) => f.rel === rel).src;
            expect({ rel, uses: /useApi\(/.test(src) }).toEqual({ rel, uses: true });
        }
        // HistoryPage's four loads are four hooks, one per answer
        expect(read("pages/history/HistoryPage.tsx").match(/useApi\(/g).length).toBe(4);
    });
});
