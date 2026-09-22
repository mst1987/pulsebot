// Guards for "Mein Profil" (#255). The client is TSX without a React test
// renderer, so these are source scans of the invariants that break silently:
// the page stays calm (folded parts, one head action), the three ways to add a
// character sit in one dialog, the wishes are marked as orga-only, and the
// route is open to the "signup" area only.
const fs = require("fs");
const path = require("path");
const { makeT } = require("./i18nHelper");

const de = makeT("de");
const en = makeT("en");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "ProfilePage.tsx");
const dialog = read("components", "profile", "AddCharacterDialog.tsx");
const app = read("App.tsx");
const api = read("api.ts");
const roster = read("pages", "RosterPage.tsx");
const css = read("styles", "profil.css");

describe("ProfilePage", () => {
    it("is routed under /profile for the signup area and listed in the menu", () => {
        expect(app).toMatch(/<Route path="profile" element=\{<Guard user=\{user\} areas=\{\["signup"\]\}><ProfilePage \/><\/Guard>\} \/>/);
        const { MENU } = require("../../src/config/menu");
        expect(MENU.find((e) => e.id === "profile")).toMatchObject({ href: "/profile", areas: ["signup"] });
    });

    it("uses the shared building blocks and its own stylesheet", () => {
        expect(page).toMatch(/<PageHead[\s\S]*tone="profile"/);
        expect(page).toContain("import \"../styles/profil.css\";");
        expect(page).not.toContain("<div className=\"empty\">Lade");
        for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]*/g) || []) {
            expect(sel).toMatch(/^\.(pf-|wi$|kicker$|part-head$|ph-act$|field$|is-|switch)/);
        }
    });

    it("sizes every icon it asks for above the shared 18 px .wi in its stylesheet", () => {
        // WowIcon's size only picks the image; the shared `.wi` rule draws it at
        // 18 px unless the page's CSS says otherwise — the UI review found all
        // spec, role and "first character" icons shrunk to 18 px.
        const owners = { "pf-way": page, "pf-spec": page, "pf-role": page, "pf-chip": page, "pf-logrow": dialog, "pf-class": dialog };
        for (const [scope, source] of Object.entries(owners)) {
            expect(source).toContain(scope);
            expect(css).toMatch(new RegExp(`\\.${scope} \\.wi[^{]*\\{ width: \\d{2}px; height: \\d{2}px; \\}`));
        }
    });

    it("folds availability, raids, wishes, avoid, note and the calendar so only one part is open at a time", () => {
        const folds = [...page.matchAll(/<FoldPart\s+id="(\w+)"/g)].map((m) => m[1]);
        expect(folds).toEqual(["days", "raids", "wishes", "avoid", "note", "calendar"]);
        expect(page).toMatch(/const isOpen = open === id;/);
        expect(page).toMatch(/\{isOpen && <div className="pf-fold-body">/);
    });

    it("keeps „kann offtanken / heilen“ on the selected character, saved per character", () => {
        const card = page.slice(page.indexOf("function CharacterCard"), page.indexOf("type RoleField"));
        expect(card).toContain("<RolesRow character={character} onChange={onRoles} />");
        expect(page).toMatch(/onRoles=\{\(field, value\) => patch\(\s*\{ characters: \[\{ key: selected\.key, \[field\]: value \}\] \}/);
        // no profile-wide switch any more
        expect(page).not.toMatch(/patch\(\{ \[field\]: value \}/);
        expect(page).toContain("checked={character[r.field]}");
    });

    it("gives every weekday its own colour, in the buttons and in the folded summary, readable in light and dark", () => {
        for (const day of ["mo", "di", "mi", "do", "fr", "sa", "so"]) {
            expect(css).toMatch(new RegExp(`\\[data-day="${day}"\\] \\{ --day: #[0-9a-f]{6}; --day-dark: #[0-9a-f]{6}; \\}`));
        }
        expect(page).toMatch(/className="pf-day-tag" data-day=\{d\.id\}/);
        expect(page).toMatch(/data-day=\{d\.id\} className=\{`pf-day/);
        expect(css).toMatch(/:root\[data-theme="light"\] \.pf-day, :root\[data-theme="light"\] \.pf-day-tag \{ --day-ink: var\(--day-dark\); \}/);
    });

    describe("Nicht mit X raiden", () => {
        const fold = page.slice(page.indexOf("id=\"avoid\""), page.indexOf("id=\"note\""));

        it("is off at first and asks before it is switched on, reminding that everyone deserves a chance", () => {
            expect(fold).toMatch(/if \(on && !\(await ask\(\{\s*title: t\("profile\.avoid\.confirmTitle"\)/);
            expect(de("profile.avoid.confirmText")).toMatch(/jeder eine Chance/);
            expect(en("profile.avoid.confirmText")).toMatch(/everyone should get a chance/);
            expect(de("profile.fold.avoidOff")).toBe("aus");
            // the list appears only once it is on
            expect(page).toMatch(/\{profile\.avoidEnabled\s*\? \(\s*<WishPicker/);
        });

        it("is marked orga-only and never offers somebody who is already a wish", () => {
            expect(fold).toContain("badge={<Badge icon={<EyeOffIcon />}");
            expect(fold).toContain("tipSub={t(\"profile.avoid.orgaOnlySub\")}");
            expect(de("profile.avoid.orgaOnlySub")).toMatch(/Nur die Orga/);
            expect(page).toContain("exclude={profile.wishes}");
            expect(page).toContain("exclude={profile.avoid}");
        });
    });

    // Kalender-Abo (#312): one calm folded line, not a second page and not a
    // block that pushes the rest of the profile down.
    describe("Kalender-Abo (#312)", () => {
        it("is one folded line with the link shown once and a way to revoke it", () => {
            expect(page).toMatch(/<FoldPart\s+id="calendar"[\s\S]*?title=\{t\("profile\.fold\.calendar"\)\}/);
            expect(de("profile.fold.calendar")).toBe("Kalender-Abo");
            expect(en("profile.fold.calendar")).toBe("Calendar subscription");
            expect(page).toContain("<CalendarPart");
            expect(page).toContain("t(\"profile.cal.onlyNow\")");
            expect(de("profile.cal.onlyNow")).toBe("nur jetzt sichtbar");
            expect(page).toContain("t(\"profile.cal.create\")");
            expect(de("profile.cal.create")).toBe("Link erzeugen");
            expect(page).toContain("tip={t(\"profile.cal.revoke\")}");
        });

        it("warns that the link is secret", () => {
            expect(page).toContain("<strong>{t(\"profile.cal.secret\")}</strong>");
            expect(de("profile.cal.secret")).toBe("Der Link ist geheim:");
            expect(en("profile.cal.secret")).toBe("The link is secret:");
        });

        // The secret only ever exists in the answer that created it, so the page
        // may create and revoke, and must never ask for one back.
        it("creates and revokes through the one profile endpoint", () => {
            expect(page).toContain("getCalendarTokens()");
            expect(page).toContain("createCalendarToken(csrfToken)");
            expect(page).toContain("revokeCalendarToken(csrfToken, token.id)");
            expect(api).toContain("/api/profile/calendar");
            expect(api).toMatch(/send\("POST", "\/api\/profile\/calendar"/);
        });
    });

    it("shows the gear level as a segment and the log evidence as a badge with a tooltip", () => {
        expect(page).toMatch(/<Segment<GearLevel>[\s\S]*data\.gearLevels\.map/);
        expect(page).toMatch(/<Badge tone=\{logTone\} tip=\{logLabel\} tipSub=/);
        expect(de("profile.logs.seen")).toBe("laut Logs");
        expect(en("profile.logs.seen")).toBe("per logs");
    });

    it("marks the wishes as visible to the orga only and never shows whether one is mutual", () => {
        expect(page).toContain("{t(\"profile.fold.orgaOnly\")}");
        expect(de("profile.fold.orgaOnly")).toBe("nur Orga");
        expect(page).not.toMatch(/mutual|gegenseitig/);
    });

    it("warns about a character another account claimed instead of hiding it", () => {
        expect(page).toContain("claimedBy.length > 0");
        expect(page).toContain("t(\"profile.char.claimedBy\"");
        expect(de("profile.char.claimedBy", { name: "Ann" })).toBe("vergeben an Ann");
    });

    it("offers the three ways in one dialog", () => {
        expect(dialog).toMatch(/value: "log"[\s\S]*value: "armory"[\s\S]*value: "manual"/);
        expect(dialog).toContain("t(\"profile.add.thatsMe\")");
        expect(de("profile.add.thatsMe")).toBe("Das bin ich");
        expect(dialog).toContain("class_required");
        expect(page).toContain("<AddCharacterDialog");
    });

    it("talks to the profile endpoints only", () => {
        for (const p of ["/api/profile\"", "/api/profile/log-characters", "/api/profile/characters", "/api/profile/raiders", "/api/roster/character-claims"]) {
            expect(api).toContain(p);
        }
        expect(api).toMatch(/send\("PUT", "\/api\/profile"/);
    });
});

describe("Roster hint", () => {
    it("shows double-claimed characters as one badge with the list in its tooltip", () => {
        expect(roster).toContain("getCharacterClaims()");
        expect(roster).toMatch(/function ClaimsBadge[\s\S]*<Badge[\s\S]*tone="mid"[\s\S]*tipSub=/);
        expect(roster).toContain("{claims.length > 0 && <div className=\"ph-meta\"><ClaimsBadge claims={claims} /></div>}");
    });
});
