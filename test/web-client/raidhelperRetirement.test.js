// Umstieg von Raid-Helper (#291) in Einstellungen → Verbindungen: the card's
// rules (src/web-client/src/lib/raidhelperRetirement.ts) run for real, and its
// structure checked on the source — a compact line per item with the rest in
// tooltips, the switch only for full admins, the import as a dry run first,
// and the category list saying which categories still use Raid-Helper.
const fs = require("fs");
const path = require("path");

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

/** The lib without its TypeScript: `import type`, `export type` and one-line signatures only. */
function load() {
    const lines = read("lib", "raidhelperRetirement.ts").split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^import type /.test(line)) continue;
        if (/^export type /.test(line)) {
            let depth = 0;
            for (; i < lines.length; i++) {
                for (const c of lines[i]) { if ("({[".includes(c)) depth++; if (")}]".includes(c)) depth--; }
                if (depth === 0 && /;\s*$/.test(lines[i])) break;
            }
            continue;
        }
        const fn = line.match(/^(export )?function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[3]).map((p) => p.trim().split(":")[0].replace("?", "").trim()).filter(Boolean);
            out.push(`function ${fn[2]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}

const lib = load();
const item = (over = {}) => ({ id: "categories", label: "Alle Event-Kategorien auf EventHelper", status: "ok", value: "2 / 2", why: "Weil.", detail: [], required: true, ...over });
const checklist = (over = {}) => ({ disabled: false, disabledAt: 0, disabledBy: "", items: [item()], done: 1, total: 1, ready: true, blockers: [], ...over });

describe("the checklist's rules", () => {
    it("gives every status a badge", () => {
        expect(lib.statusLook("ok")).toEqual({ tone: "ok", label: "erledigt" });
        expect(lib.statusLook("bad")).toEqual({ tone: "bad", label: "offen" });
        expect(lib.statusLook("mid").tone).toBe("mid");
        expect(lib.statusLook("unknown")).toEqual({ tone: "", label: "nicht prüfbar" });
        expect(lib.statusLook("info").label).toBe("Hinweis");
    });

    it("puts why, what is open, the command and Pflicht/Empfehlung into the tooltip", () => {
        const tip = lib.itemTip(item({ detail: ["Sonntag – noch Raid-Helper"], hint: "npm run register" }));
        expect(tip).toMatch(/^Weil\./);
        expect(tip).toMatch(/Sonntag – noch Raid-Helper/);
        expect(tip).toMatch(/Befehl: npm run register/);
        expect(tip).toMatch(/Pflicht vor dem Abschalten/);
        expect(lib.itemTip(item({ required: false }))).toMatch(/Empfehlung/);
    });

    it("opens the switch only when ready and names what blocks it", () => {
        expect(lib.switchState(checklist())).toMatchObject({ checked: false, enabled: true });
        const blocked = lib.switchState(checklist({ ready: false, blockers: ["categories"] }));
        expect(blocked.enabled).toBe(false);
        expect(blocked.reason).toBe("Erst erledigen: Alle Event-Kategorien auf EventHelper.");
        // switching back on is always possible
        expect(lib.switchState(checklist({ disabled: true, ready: false, blockers: ["categories"] }))).toMatchObject({ checked: true, enabled: true });
    });

    it("reads the head and the disabled state", () => {
        expect(lib.headLook(checklist())).toEqual({ tone: "ok", label: "1 von 1 erledigt" });
        expect(lib.headLook(checklist({ done: 2, total: 5, ready: false }))).toEqual({ tone: "bad", label: "2 von 5 erledigt" });
        expect(lib.headLook(checklist({ done: 2, total: 5 })).tone).toBe("mid");
        expect(lib.headLook(checklist({ disabled: true }))).toEqual({ tone: "accent", label: "abgeschaltet" });
        const now = Date.UTC(2026, 8, 16);
        expect(lib.disabledSince(checklist({ disabled: true, disabledAt: now - 3 * 86400000, disabledBy: "Orga" }), now)).toBe("vor 3 Tagen von Orga");
        expect(lib.disabledSince(checklist({ disabled: true, disabledAt: now }), now)).toBe("heute");
        expect(lib.disabledSince(checklist(), now)).toBe("");
    });

    it("words the import result for a dry run, a stored run and nothing new", () => {
        const base = { dryRun: true, stored: null, summary: { events: 4, skippedEvents: 0, entries: 60, users: 18, unmapped: { Unholy_DPS: 2 } } };
        expect(lib.importSummary(base)).toBe("4 Events · 60 Einträge für 18 Raider würden gespeichert.");
        expect(lib.importSummary({ ...base, dryRun: false, stored: { events: 4, entries: 60, users: 18 } })).toBe("4 Events · 60 Einträge für 18 Raider gespeichert.");
        expect(lib.importSummary({ ...base, summary: { ...base.summary, events: 0, skippedEvents: 4 } })).toMatch(/Nichts Neues – 4 Events/);
        expect(lib.importSummary({ ...base, summary: { ...base.summary, events: 0 } })).toBe("Keine Raid-Helper-Events gefunden.");
        expect(lib.unmappedText(base)).toBe("Nicht zuordenbar: Unholy_DPS (2×)");
        expect(lib.unmappedText({ ...base, summary: { ...base.summary, unmapped: {} } })).toBe("");
    });
});

describe("the profile's suggestion from Raid-Helper", () => {
    it("takes the most played spec's class, its specs by count and the latest name", () => {
        expect(lib.specSuggestion([
            { spec: "Priest-Holy", count: 2, lastAt: 50, character: "Heiler" },
            { spec: "Priest-Shadow", count: 7, lastAt: 40, character: "Schatten" },
            { spec: "Mage-Fire", count: 3, lastAt: 90, character: "Twink" },
        ])).toEqual({ className: "Priest", specs: ["Priest-Shadow", "Priest-Holy"], name: "Heiler" });
        expect(lib.specSuggestion([])).toBeNull();
        expect(lib.specSuggestion(undefined)).toBeNull();
    });

    it("prefills only the manual way and says where it came from", () => {
        const dialog = read("components", "profile", "AddCharacterDialog.tsx");
        expect(dialog).toContain("if (way === \"manual\") applySuggestion();");
        expect(dialog).toContain("t(\"profile.add.fromRaidhelper\")");
        expect(require("./i18nHelper").makeT("de")("profile.add.fromRaidhelper")).toBe("aus Raid-Helper");
        expect(read("pages", "ProfilePage.tsx")).toContain("suggestion={specSuggestion(data.specHistory)}");
    });
});

describe("the card on the page", () => {
    const card = read("components", "SettingsRaidhelperRetirement.tsx");
    const connections = read("components", "SettingsConnections.tsx");

    it("sits under the connection cards, for full admins only", () => {
        expect(connections).toContain("{data.canManageAccess && <RaidhelperRetirementCard csrfToken={csrfToken} />}");
    });

    it("is one line per item with the explanation in the label's tooltip, not in a paragraph", () => {
        expect(card).toContain("data-tip-sub={itemTip(item)}");
        expect(card).not.toMatch(/<p[\s>]/);
    });

    it("asks before switching and runs the import as a dry run first", () => {
        expect(card).toMatch(/await ask\(off \?/);
        expect(card).toContain("disabled={busy || !canStore}");
        expect(card).toContain("result.dryRun && result.summary.events > 0");
    });

    it("shows the categories still on Raid-Helper in the category list's head", () => {
        const matrix = read("components", "CategoryMatrix.tsx");
        expect(matrix).toContain("noch Raid-Helper");
        expect(matrix).toContain("categorySignupSource[cat.id] || signupSourceDefault");
        expect(matrix).not.toContain("categorySignupSource[cat.id] || \"raidhelper\"");
    });
});
