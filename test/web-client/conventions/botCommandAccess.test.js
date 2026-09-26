// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): the view in
// components/BotCommandAccess.tsx, checked on its source. The rules in
// lib/botCommandAccess.ts run in Vitest (src/web-client/src/lib/botCommandAccess.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const view = read("components", "BotCommandAccess.tsx");
const page = read("pages", "SettingsPage.tsx");
const api = read("api", "botCommands.ts");

describe("Bot-Befehle view", () => {
    it("loads its own data and saves the whole map through PATCH /api/settings", () => {
        expect(api).toMatch(/getBotCommands[\s\S]*"\/api\/bot-commands"/);
        expect(view).toMatch(/getBotCommands\(\)/);
        expect(view).toMatch(/updateSettings\(\{ botCommandAccess: next \}\)/);
    });

    it("folds each group to one line with the shared Details button", () => {
        expect(view).toMatch(/<Expand open=\{isOpen\}/);
        expect(view).toMatch(/groupSummary\(commands, map, roleName\)/);
        expect(view).toMatch(/\{isOpen && \(/);
    });

    it("edits a command in a modal: segment, role picker, default with reset, group action", () => {
        expect(view).toMatch(/<Modal[\s\S]*title=\{commandLabel\(command\)\}/);
        expect(view).toMatch(/<Segment<BotAccessMode>/);
        expect(view).toMatch(/const MODES: BotAccessMode\[\] = \["everyone", "roles", "admins"\]/);
        expect(view).toMatch(/Zurücksetzen/);
        expect(view).toMatch(/Standard/);
        expect(view).toMatch(/für alle \{groupSize\} Befehle der Gruppe übernehmen/);
        expect(view).toMatch(/withGroupRule\(map, data\.commands, editCommand\.group, rule\)/);
    });

    it("explains roles in the tooltip box (name and member count), never a native title", () => {
        expect(view).toMatch(/memberCount/);
        expect(view).toMatch(/tipSub=\{sub\}/);
        // on a plain element; `title` on PartHead/Modal is their heading
        expect(view).not.toMatch(/<[a-z]+\b[^>]*\stitle=/);
    });

    it("is a second view of the Berechtigungen section, kept in the url", () => {
        expect(page).toMatch(/usePersistedSearchParam<PermView>\("settings-perm-view", "perm", "areas", PERM_VIEWS\)/);
        expect(page).toMatch(/permView === "bot" \? \(\s*<BotCommandAccess/);
        expect(page).toMatch(/label: "Bot-Befehle"/);
    });
});
