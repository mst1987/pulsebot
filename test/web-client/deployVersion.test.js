// The menu's deploy line (#314): src/web-client/src/lib/deployVersion.ts run for
// real, plus a scan that the Shell keeps it to one quiet line with the details
// in its tooltip.
const fs = require("fs");
const path = require("path");
const { makeT } = require("./i18nHelper");

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

/** The lib without its TypeScript: `export type` blocks and one-line signatures only; `t` injected for one language. */
function load(lang = "de") {
    const lines = read("lib", "deployVersion.ts").split("\n");
    const out = [];
    let inType = false;
    for (const line of lines) {
        if (/^import /.test(line)) continue;
        if (inType) {
            if (/^};?$/.test(line.trim())) inType = false;
            continue;
        }
        if (/^export type /.test(line)) {
            if (!/;\s*$/.test(line)) inType = true;
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, "").replace(/: string\[\] = \[\]/, " = []"));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function("t", `${js}\nreturn { ${names.join(", ")} };`)(makeT(lang));
}

const { deployLine, shortDay, daysAgo, reasonText } = load();

const NOW = Date.parse("2026-09-20T12:00:00Z");
const base = (over) => ({
    commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    short: "a1b2c3d",
    committedAt: "2026-09-12T10:00:00Z",
    subject: "Farbe und Bild je Raid-Vorlage",
    startedAt: "2026-09-12T10:05:00Z",
    behind: 0, behindSince: "", latest: null, status: "current", reason: "", checkedAt: "2026-09-20T11:55:00Z",
    ...over,
});

describe("web-client/lib/deployVersion", () => {
    it("formats a day the German way", () => {
        expect(shortDay("2026-09-12T10:00:00Z")).toBe("12.09.");
        expect(shortDay("")).toBe("");
        expect(shortDay("nonsense")).toBe("");
    });

    it("counts whole days", () => {
        expect(daysAgo("2026-09-14T12:00:00Z", NOW)).toBe(6);
        expect(daysAgo("2026-09-20T09:00:00Z", NOW)).toBe(0);
        expect(daysAgo("", NOW)).toBe(0);
    });

    it("says which commit runs and that it is current", () => {
        const line = deployLine(base(), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · aktuell mit main");
        expect(line.tone).toBe("ok");
    });

    it("says how far behind main it is", () => {
        const line = deployLine(base({ status: "behind", behind: 9, behindSince: "2026-09-14T12:00:00Z", latest: { short: "9f8e7d6" } }), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · main ist 9 Commits weiter");
        expect(line.tone).toBe("mid");
        expect(line.tipSub).toContain("9 Commits hinter main");
        expect(line.tipSub).toContain("seit 6 Tagen");
        expect(line.tipSub).toContain("main auf 9f8e7d6");
    });

    it("turns red once the backlog is a week old", () => {
        const week = base({ status: "behind", behind: 20, behindSince: "2026-09-13T11:00:00Z" });
        expect(deployLine(week, NOW).tone).toBe("bad");
        expect(deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-19T11:00:00Z" }), NOW).tone).toBe("mid");
    });

    it("uses the singular for one commit", () => {
        const line = deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-20T10:00:00Z" }), NOW);
        expect(line.text).toContain("main ist 1 Commit weiter");
    });

    it("says 'nicht prüfbar' instead of an error when the comparison failed", () => {
        const line = deployLine(base({ status: "unknown", reason: "unreachable" }), NOW);
        expect(line.text).toBe("Server läuft auf a1b2c3d vom 12.09. · Abstand zu main nicht prüfbar");
        expect(line.tone).toBe("muted");
        expect(line.tipSub).toContain("GitHub war nicht erreichbar");
    });

    it("copes with a process that does not know its own commit", () => {
        const line = deployLine(base({ short: "", commit: "", committedAt: "", status: "unknown", reason: "no_commit" }), NOW);
        expect(line.text).toBe("Server-Stand unbekannt · Abstand zu main nicht prüfbar");
        expect(line.tipSub).toContain("GIT_COMMIT");
    });

    it("leaves the day out when git gave no commit date (GIT_COMMIT fallback)", () => {
        expect(deployLine(base({ committedAt: "", subject: "" }), NOW).text).toBe("Server läuft auf a1b2c3d · aktuell mit main");
    });

    it("renders nothing at all without data", () => {
        expect(deployLine(null, NOW).text).toBe("");
    });

    it("explains every reason in one sentence", () => {
        for (const reason of ["no_commit", "not_found", "unreachable", ""]) {
            expect(reasonText(reason).length).toBeGreaterThan(20);
        }
        expect(reasonText("not_found")).toContain("100 Commits");
    });

    it("speaks English when the menu does", () => {
        const en = load("en");
        expect(en.shortDay("2026-09-12T10:00:00Z")).toBe("12/09");
        const line = en.deployLine(base({ status: "behind", behind: 1, behindSince: "2026-09-14T12:00:00Z" }), NOW);
        expect(line.text).toBe("Server runs a1b2c3d from 12/09 · main is 1 commit ahead");
        expect(line.tipSub).toContain("1 commit behind main (for 6 days)");
    });
});

describe("the menu's version line", () => {
    const shell = read("components", "Shell.tsx");

    it("sits in the sidebar as one line with the details in its tooltip", () => {
        expect(shell).toContain("side-version");
        expect(shell).toContain("data-tip-sub");
        expect(shell).toContain("<DeployLine user={user} />");
    });

    it("is only fetched for settings readers, so a member's page load asks GitHub nothing", () => {
        expect(shell).toMatch(/canAccess\(user, "settings"\)/);
        expect(shell).toMatch(/if \(!maySee\) return;/);
    });

    it("disappears rather than showing an error", () => {
        expect(shell).toMatch(/catch\(\(\) => \{\}\)/);
        expect(shell).toMatch(/if \(!version\) return null;/);
    });

    it("has a style for each tone in the bundle", () => {
        const css = read("index.css");
        for (const cls of [".side-version", ".side-version.v-ok", ".side-version.v-mid", ".side-version.v-bad"]) {
            expect(css).toContain(cls);
        }
    });

    it("lets the dashboard task open an address outside the menu", () => {
        const page = read("pages", "DashboardPage.tsx");
        expect(page).toContain("https?:\\/\\/");
        expect(page).toContain('target="_blank"');
    });
});
