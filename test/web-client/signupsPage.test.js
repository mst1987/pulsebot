// Guards for "Anmeldungen" (#256). The client is TSX without a React test
// renderer, so these are source scans of the invariants that break silently:
// one calm row per raid, Raid-Helper events link to Discord instead of opening
// the dialog, the dialog keeps to character/spec/status/"kann auch"/comment and
// respects the deadline, and the roster tab shows "kann auch" and the comment
// only in the tooltip.
const fs = require("fs");
const path = require("path");
const { SIGNUP_STATUSES } = require("../../src/utils/attendance");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "SignupsPage.tsx");
const dialog = read("components", "SignupDialog.tsx");
const lib = read("lib", "signups.ts");
const app = read("App.tsx");
const api = read("api.ts");
const roster = read("pages", "raid-detail", "RosterTab.tsx");
const css = read("styles", "anmeldung.css");
const picksView = read("components", "SignupCharacterPicks.tsx");
const bulk = read("components", "BulkSignupDialog.tsx");

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

/** lib/signupPicks.ts without its TypeScript (`import type`, `export type`, one-line signatures), run for real. */
function loadPicks() {
    const lines = read("lib", "signupPicks.ts").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    for (const line of lines) {
        if (/^import type /.test(line) || /^export type .*;\s*$/.test(line)) continue;
        const fn = line.match(/^export function (\w+)\((.*)\)(: .*)? \{$/);
        if (fn) {
            const params = splitParams(fn[2]).map((p) => p.trim().split(":")[0].trim()).filter(Boolean);
            out.push(`function ${fn[1]}(${params.join(", ")}) {`);
            continue;
        }
        out.push(line.replace(/^export /, ""));
    }
    const js = out.join("\n");
    const names = [...js.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    return new Function(`${js}\nreturn { ${names.join(", ")} };`)();
}
const picksLib = loadPicks();

describe("SignupsPage", () => {
    it("is routed under /signups for the signup area and listed in the menu next to the profile", () => {
        expect(app).toMatch(/<Route path="signups" element=\{<Guard user=\{user\} areas=\{\["signup"\]\}><SignupsPage \/><\/Guard>\} \/>/);
        const { MENU } = require("../../src/config/menu");
        const ids = MENU.map((e) => e.id);
        expect(MENU.find((e) => e.id === "signups")).toMatchObject({ href: "/signups", areas: ["signup"], wowIcon: "inv_misc_book_09" });
        expect(Math.abs(ids.indexOf("signups") - ids.indexOf("profile"))).toBe(1);
    });

    it("uses the shared blocks, a loader while waiting and its own stylesheet", () => {
        expect(page).toMatch(/<PageHead[\s\S]*tone="signups"[\s\S]*title="Anmeldungen"/);
        expect(page).toContain("<RaidLoader");
        expect(page).toContain("import \"../styles/anmeldung.css\";");
        for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || []) {
            expect(sel).toMatch(/^\.(an-|wi$|field$|seg-opt$|is-on$|is-mine$)/);
        }
    });

    it("shows a row as icon, title, one small line, a fill bar and one action", () => {
        expect(page).toMatch(/className="an-title">\{row\.title\}/);
        expect(page).toMatch(/className="an-sub">\{rowSubline\(row\)\}/);
        expect(page).toContain("<Bar value={row.attending}");
        // role counts are the bar's tooltip, not a column of their own
        expect(page).toMatch(/const barTip = own \? roleCountText\(row\.counts\)/);
    });

    it("links a Raid-Helper event to Discord instead of offering the dialog", () => {
        expect(page).toMatch(/\{own \? <OwnAction row=\{row\} onOpen=\{onOpen\} \/> : \(/);
        expect(page).toContain("In Discord");
        expect(page).toContain("href={row.discordUrl}");
        // the dialog only ever opens for an own event
        expect(page).toMatch(/e\.id === openId && e\.source === "eventhelper"/);
    });

    it("keeps the open dialog in the url so the Discord dialog's web button can link to it", () => {
        expect(page).toContain("params.get(\"event\")");
        const button = fs.readFileSync(path.join(__dirname, "..", "..", "src", "utils", "signupDialog.js"), "utf8");
        expect(button).toContain("/signups?event=");
    });
});

describe("SignupDialog", () => {
    it("offers every status the backend knows, in the member's words", () => {
        for (const status of SIGNUP_STATUSES) expect(lib).toMatch(new RegExp(`\\b${status}: \\{ label: "`));
        for (const label of ["Dabei", "Vielleicht", "Spät", "Bank", "Abmelden"]) expect(lib).toContain(`label: "${label}"`);
        expect(lib).toMatch(/SIGNUP_STATUS_ORDER: SignupStatus\[\] = \["signed", "tentative", "late", "bench", "absence"\]/);
    });

    it("disables what the deadline no longer allows", () => {
        expect(dialog).toContain("const allowed = row.allowedStatuses.includes(s);");
        expect(dialog).toMatch(/disabled=\{!allowed/);
        expect(dialog).toContain("Anmeldeschluss vorbei");
    });

    it("picks character and spec from the profile, the spec with its gear level", () => {
        expect(dialog).toContain("<SignupCharacterPicks profile={profile}");
        expect(picksView).toContain("profile.characters.map((c) => <option");
        expect(picksView).toMatch(/\{s\.label\} · \{GEAR_LABEL\[s\.gear\]/);
    });

    it("sends every picked character in priority order (#293)", () => {
        expect(dialog).toContain("characters: picksToInput(profile, picks)");
        expect(dialog).toContain("initialPicks(profile, mine)");
        // numbered lines, the first the choice, arrows to reorder, at most three
        expect(picksView).toContain("an-rank-first");
        expect(picksView).toContain("\"1. Wahl\" : \"Kann auch mit\"");
        expect(picksView).toContain("movePick(picks, i, -1)");
        expect(picksView).toContain("movePick(picks, i, 1)");
        expect(picksView).toContain("Die Orga stellt dich mit genau einem auf.");
        expect(picksLib.MAX_CHARACTERS).toBe(require("../../src/web/signupCharacters").MAX_CHARACTERS);
    });

    it("prefills \"Ich kann auch\" from the profile and never offers the own role", () => {
        expect(dialog).toContain("Ich kann auch");
        expect(dialog).toContain("defaultCanAlso(profile,");
        expect(dialog).toMatch(/ROLE_ORDER\.filter\(\(r\) => r !== ownRole\)/);
        expect(lib).toMatch(/export function defaultCanAlso[\s\S]*r !== ownRole/);
    });

    it("hints at a wish partner who is signed up, with the explanation in the tooltip", () => {
        expect(dialog).toMatch(/row\.wishPartners\.length > 0[\s\S]*<Badge[\s\S]*tipSub=/);
        expect(dialog).toContain("auch angemeldet");
    });

    it("talks to the signup endpoint only", () => {
        expect(api).toMatch(/send\("PUT", "\/api\/signups"/);
        expect(api).toContain("\"/api/signups\"");
        expect(api).toContain("/api/signups/event?id=");
        expect(dialog).toContain("saveSignup(csrfToken,");
        expect(api).toMatch(/send\("POST", "\/api\/signups\/bulk"/);
        expect(bulk).toContain("saveSignupsBulk(csrfToken,");
    });
});

describe("character picks (lib/signupPicks.ts, #293)", () => {
    const spec = (key, gear = "ready") => ({ key, label: key, icon: "", role: "", gear });
    const profile = {
        canOfftank: false, canHeal: false,
        characters: [
            { key: "zibbo", name: "Zibbo", className: "Priest", main: true, specs: [spec("Priest-Shadow", "none"), spec("Priest-Holy")] },
            { key: "zibbowar", name: "Zibbowar", className: "Warrior", main: false, specs: [spec("Warrior-Protection")] },
            { key: "alt", name: "Alt", className: "Mage", main: false, specs: [spec("Mage-Frost")] },
            { key: "twink", name: "Twink", className: "Rogue", main: false, specs: [spec("Rogue-Combat")] },
            { key: "empty", name: "Empty", className: "Druid", main: false, specs: [] },
        ],
    };

    it("starts with the main's first geared spec, or with what was stored", () => {
        expect(picksLib.initialPicks(profile, null)).toEqual([{ characterKey: "zibbo", spec: "Priest-Holy" }]);
        const mine = { characters: [{ character: "Zibbowar", spec: "Warrior-Protection" }, { character: "Zibbo", spec: "Priest-Holy" }, { character: "Gone", spec: "Mage-Fire" }] };
        expect(picksLib.initialPicks(profile, mine)).toEqual([
            { characterKey: "zibbowar", spec: "Warrior-Protection" },
            { characterKey: "zibbo", spec: "Priest-Holy" },
        ]);
        // an old signup without the list still opens with its one character
        expect(picksLib.initialPicks(profile, { characters: [], character: "Zibbowar", spec: "Warrior-Protection" })).toEqual([{ characterKey: "zibbowar", spec: "Warrior-Protection" }]);
    });

    it("adds up to three characters, never one twice, and reorders them", () => {
        let picks = picksLib.initialPicks(profile, null);
        picks = picksLib.addPick(profile, picks);
        picks = picksLib.addPick(profile, picks);
        expect(picks.map((p) => p.characterKey)).toEqual(["zibbo", "zibbowar", "alt"]);
        expect(picksLib.canAddPick(profile, picks)).toBe(false);
        expect(picksLib.addPick(profile, picks)).toBe(picks);
        picks = picksLib.movePick(picks, 2, -1);
        expect(picks.map((p) => p.characterKey)).toEqual(["zibbo", "alt", "zibbowar"]);
        expect(picksLib.movePick(picks, 0, -1)).toBe(picks);
        // picking a character that is already listed keeps it only on the changed line
        const swapped = picksLib.setPickCharacter(profile, picks, 0, "zibbowar");
        expect(swapped).toEqual([{ characterKey: "zibbowar", spec: "Warrior-Protection" }, { characterKey: "alt", spec: "Mage-Frost" }]);
        expect(picksLib.removePick(swapped, 0)).toEqual([{ characterKey: "alt", spec: "Mage-Frost" }]);
    });

    it("hands the API names and specs, dropping what the profile no longer has", () => {
        const picks = [{ characterKey: "zibbowar", spec: "Warrior-Protection" }, { characterKey: "zibbo", spec: "Priest-Discipline" }, { characterKey: "zibbo", spec: "Priest-Holy" }];
        expect(picksLib.picksToInput(profile, picks)).toEqual([
            { character: "Zibbowar", spec: "Warrior-Protection" },
            { character: "Zibbo", spec: "Priest-Holy" },
        ]);
    });
});

describe("several raids at once on the page (#293)", () => {
    it("lets own raids that still take a signup be picked, with a compact bar at the bottom", () => {
        expect(page).toMatch(/e\.source === "eventhelper" && e\.allowedStatuses\.length > 0/);
        expect(page).toContain("type=\"checkbox\" checked={selected}");
        expect(page).toMatch(/className="an-bulk" role="toolbar"[\s\S]*Für alle gewählten anmelden/);
        expect(page).toContain("<BulkSignupDialog");
        // the dialog keeps its own copy of the raids: clearing the selection after saving must not close it
        expect(page).toContain("rows={bulkRows}");
        expect(page).toContain("setBulkRows(selectedRows)");
    });

    it("asks once for characters and status and lists every raid's result with the reason", () => {
        expect(bulk).toContain("<SignupCharacterPicks");
        expect(bulk).toContain("Status für alle");
        expect(bulk).toMatch(/results\.map\(\(r\) => <ResultRow/);
        expect(bulk).toContain("übersprungen: ${x.reason}");
        expect(bulk).toContain("result.error");
    });
});

describe("Raid detail roster", () => {
    it("lists an own event's signups in role columns with \"kann auch\" and comment in the tooltip", () => {
        expect(roster).toContain("data.ownSignups");
        expect(roster).toMatch(/function OwnSignupGroups[\s\S]*kann auch: \$\{also\}[\s\S]*s\.comment \? `„\$\{s\.comment\}“`/);
        expect(roster).toMatch(/data-tip-sub=\{sub \|\| undefined\}/);
    });
});
