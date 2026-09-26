// Guards for "Anmeldungen" (#256). The client is TSX without a React test
// renderer, so these are source scans of the invariants that break silently:
// one calm row per raid, Raid-Helper events link to Discord instead of opening
// the dialog, the dialog keeps to character/spec/status/"kann auch"/comment and
// respects the deadline, and the roster tab shows "kann auch" and the comment
// only in the tooltip.
const fs = require("fs");
const path = require("path");
const { SIGNUP_STATUSES } = require("../../src/utils/attendance");
const { makeT } = require("./i18nHelper");

const de = makeT("de");

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
            // "status?: SignupStatus" is a parameter called `status` — the "?" belongs to TypeScript, not to JS
            const params = splitParams(fn[2]).map((p) => p.trim().split(":")[0].trim().replace(/\?$/, "")).filter(Boolean);
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
        expect(page).toMatch(/<PageHead[\s\S]*tone="signups"[\s\S]*title=\{t\("signups\.page\.title"\)\}/);
        expect(de("signups.page.title")).toBe("Anmeldungen");
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
        expect(page).toContain("{own ? <OwnAction row={row} onOpen={onOpen} /> : row.discordUrl && (");
        expect(page).toContain("t(\"signups.row.inDiscord\")");
        expect(de("signups.row.inDiscord")).toBe("In Discord");
        expect(page).toContain("href={row.discordUrl}");
        // the dialog only ever opens for an own event
        expect(page).toMatch(/e\.id === openId && e\.source === "eventhelper"/);
    });

    it("keeps status and action in columns of their own, shared by every row", () => {
        // a row as its own flex line put the bar wherever badge and button left room
        expect(page).toContain("<div className=\"an-state\">");
        expect(page).toContain("<div className=\"an-act\">");
        expect(page).toContain("<span className=\"an-bar\"");
        expect(css).toMatch(/\.an-list \{[^}]*grid-template-columns: 18px auto minmax\(0, 1fr\) auto auto auto;/);
        expect(css).toMatch(/\.an-group \{[^}]*grid-template-columns: subgrid;/);
        expect(css).toMatch(/\.an-row \{[^}]*grid-template-columns: subgrid;/);
    });

    it("groups the raids by raid ID, Wednesday to Tuesday", () => {
        expect(page).toContain("import { weekBands } from \"../lib/raidTime\";");
        expect(page).toContain("{weekBands(data.events).map((band) => (");
        expect(page).toContain("<b>{band.label}</b>");
    });

    it("makes the whole row open the event — an own raid's public page, a Raid-Helper raid's Discord post", () => {
        expect(page).toContain("const href = own ? `/e/${encodeURIComponent(row.id)}` : row.discordUrl;");
        expect(page).toContain("const openRow = () => href && window.open(href, \"_blank\", \"noopener,noreferrer\");");
        expect(page).toMatch(/onClick=\{href \? openRow : undefined\}/);
        expect(page).toMatch(/role=\{href \? "link" : undefined\}/);
        expect(page).toMatch(/tabIndex=\{href \? 0 : undefined\}/);
        // interactive children stop the click from also firing the row's own
        expect(page).toContain("onChange={onToggle} onClick={(e) => e.stopPropagation()}");
        expect(page).toContain("rel=\"noreferrer\" onClick={(e) => e.stopPropagation()}");
        expect(page).toContain("onClick={(e) => { e.stopPropagation(); onOpen(); }}");
        expect(page).toContain("const open = (e: MouseEvent) => { e.stopPropagation(); onOpen(); };");
    });

    it("keeps the open dialog in the url so the Discord dialog's web button can link to it", () => {
        expect(page).toContain("params.get(\"event\")");
        const button = fs.readFileSync(path.join(__dirname, "..", "..", "src", "utils", "signup", "signupDialog.js"), "utf8");
        expect(button).toContain("/signups?event=");
    });
});

describe("SignupDialog", () => {
    it("offers every status the backend knows, in the member's words", () => {
        for (const status of SIGNUP_STATUSES) expect(lib).toContain(`get label() { return t("signups.status.${status}"); }`);
        expect(["signed", "tentative", "late", "bench", "absence"].map((s) => de(`signups.status.${s}`)))
            .toEqual(["Angemeldet", "Vielleicht", "Spät", "Bank", "Abmelden"]);
        expect(makeT("en")("signups.status.signed")).toBe("Signed up");
        expect(lib).toMatch(/SIGNUP_STATUS_ORDER: SignupStatus\[\] = \["signed", "tentative", "late", "bench", "absence"\]/);
    });

    it("disables what the deadline no longer allows", () => {
        expect(dialog).toContain("const allowed = row.allowedStatuses.includes(s);");
        expect(dialog).toMatch(/disabled=\{!allowed/);
        expect(dialog).toContain("t(\"signups.dialog.deadlineHint\")");
        expect(de("signups.dialog.deadlineHint")).toContain("Anmeldeschluss vorbei");
    });

    it("picks character and spec from the profile, the spec with its gear level", () => {
        expect(dialog).toMatch(/<SignupCharacterPicks\s+profile=\{profile\}/);
        expect(picksView).toContain("profile.characters.map((c) => <option");
        expect(picksView).toMatch(/\{specLabel\(s\.key, s\.label\)\} · \{GEAR_LABEL\[s\.gear\]/);
    });

    it("sends every picked character in priority order (#293)", () => {
        expect(dialog).toContain("characters: picksToInput(profile, picks)");
        expect(dialog).toContain("initialPicks(profile, mine, open)");
        // numbered lines, the first the choice, arrows to reorder, at most three
        expect(picksView).toContain("an-rank-first");
        expect(picksView).toContain("t(\"signups.picks.firstChoice\") : t(\"signups.picks.canAlsoWith\")");
        expect([de("signups.picks.firstChoice"), de("signups.picks.canAlsoWith")]).toEqual(["1. Wahl", "Kann auch mit"]);
        expect(picksView).toContain("movePick(picks, i, -1)");
        expect(picksView).toContain("movePick(picks, i, 1)");
        expect(picksView).toContain("t(\"signups.picks.hint\")");
        expect(de("signups.picks.hint")).toContain("Die Orga stellt dich mit genau einem auf.");
        expect(picksLib.MAX_CHARACTERS).toBe(require("../../src/web/signupCharacters").MAX_CHARACTERS);
    });

    it("prefills \"Ich kann auch\" from the profile and never offers the own role", () => {
        expect(dialog).toContain("t(\"signups.dialog.canAlso\")");
        expect(de("signups.dialog.canAlso")).toBe("Ich kann auch");
        expect(dialog).toContain("defaultCanAlso(profile,");
        expect(dialog).toMatch(/ROLE_ORDER\.filter\(\(r\) => r !== ownRole\)/);
        expect(lib).toMatch(/export function defaultCanAlso[\s\S]*r !== ownRole/);
    });

    it("hints at a wish partner who is signed up, with the explanation in the tooltip", () => {
        expect(dialog).toMatch(/row\.wishPartners\.length > 0[\s\S]*<Badge[\s\S]*tipSub=/);
        expect(dialog).toContain("t(\"signups.dialog.wishSignedUp\", { count: row.wishPartners.length");
        expect(de("signups.dialog.wishSignedUp", { count: 1, names: "Zibbo" })).toBe("Zibbo ist auch angemeldet");
        expect(de("signups.dialog.wishSignedUp", { count: 2, names: "Zibbo, Alt" })).toBe("Zibbo, Alt sind auch angemeldet");
    });

    it("offers the calendar file and the public event page (#308)", () => {
        expect(dialog).toContain("/r/cal/${encodeURIComponent(row.id)}.ics");
        expect(dialog).toContain("/e/${encodeURIComponent(row.id)}");
        expect(dialog).toContain("t(\"signups.dialog.calendar\")");
        expect(de("signups.dialog.calendar")).toBe("In Kalender eintragen");
        expect(css).toContain(".an-links");
    });

    it("turns the comment into a message to the raid lead with Vielleicht/Absagen, per category", () => {
        expect(dialog).toContain("const noteStatus = absent || signupStatusOf(picks, status) === \"tentative\";");
        expect(dialog).toContain("row.noteMode || \"optional\"");
        expect(dialog).toContain("t(\"signups.dialog.note\")");
        expect(makeT("de")("signups.dialog.note")).toBe("Nachricht an die Raidleitung");
        expect(makeT("en")("signups.dialog.note")).toBe("Message to the raid lead");
        // "required" blocks the button until a message is there
        expect(dialog).toMatch(/noteMissing = noteMode === "required" && comment\.trim\(\)\.length < 2/);
        expect(dialog).toMatch(/canSubmit = [^;]*!noteMissing/);
        expect(api).toMatch(/noteMode\?: "required" \| "optional" \| "none"/);
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

// #320: the web sets the status per character, the way Discord has since #302.
describe("a status per character in the dialog (lib/signupPicks.ts, #320)", () => {
    const spec = (key, gear = "ready") => ({ key, label: key, icon: "", role: "", gear });
    const profile = {
        canOfftank: false, canHeal: false,
        characters: [
            { key: "zibbo", name: "Zibbo", className: "Priest", main: true, specs: [spec("Priest-Shadow", "none"), spec("Priest-Holy")] },
            { key: "zibbowar", name: "Zibbowar", className: "Warrior", main: false, specs: [spec("Warrior-Protection"), spec("Warrior-Fury")] },
            { key: "alt", name: "Alt", className: "Mage", main: false, specs: [spec("Mage-Frost")] },
        ],
    };
    const picks = () => [
        { characterKey: "zibbo", spec: "Priest-Holy", status: "signed" },
        { characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" },
    ];

    it("changes only the character whose status was picked", () => {
        const out = picksLib.setPickStatus(picks(), 0, "late");
        expect(out.map((p) => p.status)).toEqual(["late", "signed"]);
        // the others are untouched down to their character and spec
        expect(out[1]).toEqual({ characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" });
    });

    it("sets them all with the big switch", () => {
        expect(picksLib.setAllStatuses(picksLib.setPickStatus(picks(), 0, "late"), "bench").map((p) => p.status))
            .toEqual(["bench", "bench"]);
    });

    it("reports the shared status, and none while they differ", () => {
        expect(picksLib.commonStatus(picks(), "signed")).toBe("signed");
        expect(picksLib.commonStatus(picksLib.setPickStatus(picks(), 1, "bench"), "signed")).toBe("");
        expect(picksLib.commonStatus([], "late")).toBe("late");
    });

    it("mirrors the signup's own status on the first character, and keeps an absence for the person", () => {
        expect(picksLib.signupStatusOf(picksLib.setPickStatus(picks(), 0, "late"), "signed")).toBe("late");
        expect(picksLib.signupStatusOf(picksLib.setPickStatus(picks(), 1, "late"), "signed")).toBe("signed");
        expect(picksLib.signupStatusOf(picks(), "absence")).toBe("absence");
        expect(picksLib.signupStatusOf([], "signed")).toBe("signed");
    });

    it("keeps a character's status through a spec, character or order change, and gives a new one the first's", () => {
        const mixed = picksLib.setPickStatus(picks(), 1, "late");
        expect(picksLib.setPickSpec(mixed, 1, "Warrior-Fury")[1].status).toBe("late");
        expect(picksLib.setPickCharacter(profile, mixed, 1, "alt")[1].status).toBe("late");
        expect(picksLib.movePick(mixed, 0, 1).map((p) => p.status)).toEqual(["late", "signed"]);
        expect(picksLib.addPick(profile, mixed)[2].status).toBe("signed");
    });

    it("opens with the stored status per character, and sends each one along", () => {
        const mine = {
            status: "late",
            characters: [{ character: "Zibbo", spec: "Priest-Holy", status: "late" }, { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" }],
        };
        const opened = picksLib.initialPicks(profile, mine, "late");
        expect(opened).toEqual([
            { characterKey: "zibbo", spec: "Priest-Holy", status: "late" },
            { characterKey: "zibbowar", spec: "Warrior-Protection", status: "signed" },
        ]);
        expect(picksLib.picksToInput(profile, opened)).toEqual([
            { character: "Zibbo", spec: "Priest-Holy", status: "late" },
            { character: "Zibbowar", spec: "Warrior-Protection", status: "signed" },
        ]);
        // several raids at once share one status, so no character brings its own
        expect(picksLib.picksToInput(profile, picksLib.initialPicks(profile, null))).toEqual([{ character: "Zibbo", spec: "Priest-Holy" }]);
    });

    it("is one quiet dot per line, not a second block of switches", () => {
        // the line's own status, only where a single signup is edited and there is more than one character
        expect(picksView).toContain("const showStatus = statuses && !disabled && picks.length > 1;");
        expect(picksView).toContain("setPickStatus(picks, i, e.target.value as SignupStatus)");
        expect(picksView).toContain("an-pick-status");
        expect(picksView).toMatch(/CHARACTER_STATUS_ORDER\.filter\(\(s\) => allowedStatuses\.includes\(s\) \|\| s === p\.status\)/);
        expect(css).toContain(".an-pick-status");
        // the absence is not a character's business (the server's CHARACTER_STATUSES)
        expect(lib).toMatch(/CHARACTER_STATUS_ORDER: SignupStatus\[\] = \["signed", "tentative", "late", "bench"\]/);
        expect(require("../../src/web/signupCharacters").CHARACTER_STATUSES).toEqual(["signed", "tentative", "late", "bench"]);
        // the dialog's segment stays the one that sets them all
        expect(dialog).toContain("statuses allowedStatuses={row.allowedStatuses}");
        expect(dialog).toContain("if (s !== \"absence\") setPicks((list) => setAllStatuses(list, s));");
        expect(dialog).toMatch(/const shared = absent \? "absence" : commonStatus\(picks, status\);/);
        expect(dialog).toContain("aria-checked={shared === s}");
        expect(dialog).toContain("status: signupStatusOf(picks, status)");
        expect(dialog).toContain("t(\"signups.statusForAll\")");
        expect(de("signups.statusForAll")).toBe("Status für alle");
        // and the bulk dialog keeps its one status for every raid
        expect(bulk).not.toContain("statuses");
    });
});

describe("several raids at once on the page (#293)", () => {
    it("lets own raids that still take a signup be picked, with a compact bar at the bottom", () => {
        expect(page).toMatch(/e\.source === "eventhelper" && e\.allowedStatuses\.length > 0/);
        expect(page).toContain("type=\"checkbox\" checked={selected}");
        expect(page).toMatch(/className="an-bulk" role="toolbar"[\s\S]*t\("signups\.bulkTitle"\)/);
        expect(de("signups.bulkTitle")).toBe("Für alle gewählten anmelden");
        expect(page).toContain("<BulkSignupDialog");
        // the dialog keeps its own copy of the raids: clearing the selection after saving must not close it
        expect(page).toContain("rows={bulkRows}");
        expect(page).toContain("setBulkRows(selectedRows)");
    });

    it("asks once for characters and status and lists every raid's result with the reason", () => {
        expect(bulk).toContain("<SignupCharacterPicks");
        expect(bulk).toContain("t(\"signups.statusForAll\")");
        expect(bulk).toMatch(/results\.map\(\(r\) => <ResultRow/);
        expect(bulk).toContain("t(\"signups.bulk.skipped\", { character: x.character, reason: x.reason })");
        expect(de("signups.bulk.skipped", { character: "Zibbo", reason: "zu spät" })).toBe("Zibbo übersprungen: zu spät");
        expect(bulk).toContain("result.error");
    });
});

describe("Raid detail roster", () => {
    it("lists an own event's signups in role columns with \"kann auch\" and comment in the tooltip", () => {
        expect(roster).toContain("data.ownSignups");
        expect(roster).toMatch(/function OwnSignupGroups[\s\S]*t\("raidDetail\.roster\.canAlso", \{ roles: also \}\)[\s\S]*s\.comment \? t\("common\.quoted", \{ text: s\.comment \}\)/);
        expect(makeT("de")("raidDetail.roster.canAlso", { roles: "Heiler" })).toBe("kann auch: Heiler");
        expect(roster).toMatch(/data-tip-sub=\{sub \|\| undefined\}/);
    });

    it("says how many wait on the bench, with the names in the tooltip (#306)", () => {
        expect(roster).toContain("s.status === \"bench\"");
        expect(roster).toContain("t(\"raidDetail.roster.benchCount\", { count: bench.length })");
        expect(makeT("de")("raidDetail.roster.benchCount", { count: 2 })).toBe("2 auf der Warteliste");
        // nobody moves up by itself — the badge says who decides
        expect(makeT("de")("raidDetail.roster.benchSub", { names: "A" })).toContain("wer nachrückt, entscheidest du im Setup");
    });
});

// #306 — die Warteliste muss beim Raider ankommen, nicht nur im Roster stehen.
describe("Warteliste im Web (#306)", () => {
    it("zeigt den Hinweis des Servers direkt nach dem Speichern", () => {
        expect(dialog).toContain("res.notice");
        expect(dialog).toMatch(/if \(res\.notice\) toast\(res\.notice/);
        expect(api).toContain("waitlisted");
    });

    it("badget in der Sammelanmeldung die Raids, in denen es nur die Bank wurde", () => {
        expect(bulk).toContain("result.waitlisted");
        expect(bulk).toMatch(/result\.waitlisted \? t\("signups\.bulk\.waitlisted"\) : t\("signups\.bulk\.saved"\)/);
        expect(de("signups.bulk.waitlisted")).toBe("Warteliste");
        expect(bulk).toContain("result.notice");
    });
});
