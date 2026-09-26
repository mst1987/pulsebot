// Einstellungen → Berechtigungen → Bot-Befehle (issue #252): the view in
// pages/settings/BotCommandAccess.tsx, checked on its source. The rules in
// lib/botCommandAccess.ts run in Vitest (src/web-client/src/lib/botCommandAccess.test.ts).
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const view = read("pages", "settings", "BotCommandAccess.tsx");
const page = read("pages", "settings", "SettingsPage.tsx");
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
        // the texts live in the dictionaries since #440; the source names their keys
        const de = require("../clientSource").dictionary("de");
        expect(view).toMatch(/\{t\("common\.reset"\)\}/);
        expect(de["common.reset"]).toBe("Zurücksetzen");
        expect(view).toMatch(/\{t\("settings\.botCommands\.default"\)\}/);
        expect(de["settings.botCommands.default"]).toBe("Standard");
        expect(view).toMatch(/tParts\("settings\.botCommands\.wholeGroup", \{ count: groupSize \}\)/);
        expect(de["settings.botCommands.wholeGroup"]).toBe("für alle {count} Befehle der Gruppe übernehmen");
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
        expect(page).toMatch(/label: t\("settings\.page\.permView\.bot"\)/);
        expect(require("../clientSource").dictionary("de")["settings.page.permView.bot"]).toBe("Bot-Befehle");
    });
});
