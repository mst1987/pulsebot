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

    it("keeps the open dialog in the url so the Discord button can link to it", () => {
        expect(page).toContain("params.get(\"event\")");
        const button = fs.readFileSync(path.join(__dirname, "..", "..", "src", "commands", "setup", "eventSignup.js"), "utf8");
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
        expect(dialog).toContain("profile.characters.map((c) => <option");
        expect(dialog).toMatch(/\{s\.label\} · \{GEAR_LABEL\[s\.gear\]/);
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
    });
});

describe("Raid detail roster", () => {
    it("lists an own event's signups in role columns with \"kann auch\" and comment in the tooltip", () => {
        expect(roster).toContain("data.ownSignups");
        expect(roster).toMatch(/function OwnSignupGroups[\s\S]*kann auch: \$\{also\}[\s\S]*s\.comment \? `„\$\{s\.comment\}“`/);
        expect(roster).toMatch(/data-tip-sub=\{sub \|\| undefined\}/);
    });
});
