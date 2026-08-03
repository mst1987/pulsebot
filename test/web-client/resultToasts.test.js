// Guards that every admin action reports its result through the shared toast
// channel (src/web-client/src/components/Jobs.tsx's useToast/notify).
//
// The client is TSX and this project has no React test renderer, so what is
// checked here is the invariant behind the bug that prompted this: a page used
// to keep its own `flash` state and render it as a line of text under its
// heading. From the bottom of a long table — "Klassen & Specs ergänzen" sits
// below the whole character list — that line is off-screen, so a finished action
// looked like it had done nothing at all. Pages must not grow their own
// feedback line again, and an action's catch branch must not swallow the error.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");

function readClient(...parts) {
    return fs.readFileSync(path.join(CLIENT, ...parts), "utf8");
}

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

describe("action results are toasts", () => {
    it("exposes one shared toast channel", () => {
        const jobs = readClient("components", "Jobs.tsx");
        expect(jobs).toContain("export function useToast()");
        // The provider has to sit above the router, or a toast would be torn down
        // by the very navigation the action triggers (RaidCreatePage relies on it).
        expect(readClient("App.tsx")).toMatch(/<JobsProvider>[\s\S]*<Routes>/);
    });

    it("keeps no page-level flash state anywhere", () => {
        const offenders = clientSources()
            .filter(([, src]) => /setFlash|type Flash =/.test(src))
            .map(([name]) => name);
        expect(offenders).toEqual([]);
    });

    it("renders no hand-rolled success/error line next to a form", () => {
        // The two inline colours the old flash lines used. `var(--high)` is still
        // legitimate for *state* (a failed page load, a missing intent), so only
        // the pattern that reported an action's outcome is banned.
        const offenders = clientSources()
            .filter(([, src]) => /\{(error|flash|msg|postError|saveError)\s*&&\s*</.test(src))
            .map(([name]) => name);
        expect(offenders).toEqual([]);
    });

    it("reports every failed action instead of dropping it", () => {
        // A catch that neither toasts nor hands the message to a callback leaves
        // the admin staring at an unchanged screen — exactly the reported bug.
        // Jobs.tsx is exempt: it *is* the channel, and reports a failed job by
        // writing the message into the job's own toast.
        const offenders = [];
        for (const [name, src] of clientSources()) {
            if (name === "components/Jobs.tsx") continue;
            const catches = src.match(/catch \(err\) \{[\s\S]*?\n {4,}\}/g) || [];
            for (const block of catches) {
                const reports = /toast\(|notify\(|onChanged\(|onDone\(|onImported\(|setError\(/.test(block);
                if (!reports) offenders.push(`${name}: ${block.split("\n")[0]}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("routes the character class lookup's result to a toast", () => {
        // The action from the bug report: its button lives under the character
        // table, far below where the old flash line was drawn.
        const src = readClient("pages", "HistoryPage.tsx");
        const resolve = src.match(/const resolve = async \(\) => \{[\s\S]*?\n {4}\};/)[0];
        expect(resolve).toContain("resolveCharacters(csrfToken)");
        // Success goes through onChanged (toast + reload), failure straight to a
        // toast — never onChanged, which would reload as if it had worked.
        expect(resolve).toContain("onChanged(r.message)");
        expect(resolve).toMatch(/toast\(\(err as ApiError\)\.message, "err"\)/);
    });
});
