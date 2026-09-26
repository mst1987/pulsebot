// The controls of #264, held at the lines that break silently: the modals send
// the chosen target, the segment only appears with a talk ping channel, the
// role sync saves through the shared patch rule and never offers "remove a
// role", the drift is a small badge plus a fold-out, and the dashboard task
// links to the section. Logic is tested in settingsLogic.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

const api = read("api", "raidDetail.ts");
const settingsApi = read("api", "settings.ts");
const dashboardApi = read("api", "dashboard.ts");
const targetField = read("pages", "raid-detail", "modals", "TargetField.tsx");
const pingModal = read("pages", "raid-detail", "modals", "PingModal.tsx");
const notifyModal = read("pages", "raid-detail", "modals", "NotifyModal.tsx");
const roleSync = read("components", "SettingsRoleSync.tsx");
const reminders = read("components", "SettingsReminders.tsx");

describe("Wohin in the raid-detail modals", () => {
    it("sends the target with both calls", () => {
        expect(api).toContain("input: { event: string; text: string; target?: PingTarget }");
        expect(api).toMatch(/roleIds: string\[\]; target\?: PingTarget \}/);
        expect(pingModal).toContain("pingMissingRaiders({ event: eventId, text, target })");
        expect(notifyModal).toContain("roleIds, target });");
    });

    it("is one compact segment, rendered only when the server offers the talk server", () => {
        expect(targetField).toContain("const options = pingTargetOptions(info);");
        expect(targetField).toContain("if (!options.length) return null;");
        expect(targetField).toContain("<Segment size=\"sm\" ariaLabel={t(\"raidModals.target.label\")}");
        expect(require("./i18nHelper").makeT("de")("raidModals.target.label")).toBe("Wohin");
        for (const modal of [pingModal, notifyModal]) {
            expect(modal).toContain("<TargetField info={data.pingTargets} value={target} onChange={setTarget} />");
            expect(modal).toContain("useState<PingTarget>(\"event\")");
            // The head says where it goes; no extra line under the form.
            expect(modal).toContain("hint={targetHint(target, channel, data.pingTargets)}");
        }
    });
});

describe("Rollen-Abgleich part", () => {
    it("loads from the endpoint the router serves, full-admin gated in the access table", () => {
        expect(settingsApi).toContain("get<RoleSyncData>(\"/api/settings/role-sync\")");
        expect(settingsApi).toContain("get<RemindersData>(\"/api/settings/reminders\")");
        const { AREA_BY_PATH } = require("../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/settings/role-sync"]).toBe("settings");
        expect(AREA_BY_PATH["/api/settings/reminders"]).toBe("settings");
    });

    it("saves the list through the shared patch rule and edits in a modal", () => {
        expect(roleSync).toContain("updateSettings(roleSyncPatch(rules)");
        expect(roleSync).toContain("<RoleRuleModal");
        expect(roleSync).toContain("<Modal");
    });

    it("shows drift as a badge and a fold-out with profile links, never a remove action", () => {
        expect(roleSync).toContain("driftBadge(data.driftTotal, data.driftError)");
        expect(roleSync).toContain("<Expand open={driftOpen}");
        expect(roleSync).toContain("href={m.profileUrl}");
        expect(roleSync).not.toMatch(/Rolle entfernen"|removeRole|roles\.remove/);
    });

    it("says so when the bot may not manage roles", () => {
        expect(roleSync).toContain("„Rollen verwalten“ fehlt");
    });
});

describe("Erinnerungen part", () => {
    it("is one line per category with the summary, details in a modal", () => {
        expect(reminders).toContain("reminderSummary(rule)");
        expect(reminders).toContain("<ReminderModal");
        expect(reminders).toContain("remindersPatch(data.categoryReminders, editingCategory.id, rule)");
    });

    it("never shows a bare category id: an unknown category is named as such, the id in the tooltip", () => {
        expect(reminders).not.toContain("{c.name || c.id}");
        expect(reminders).toMatch(/data-tip="Unbekannte Kategorie" data-tip-sub=\{`Kategorie-ID \$\{c\.id\}/);
    });

    it("offers the target only with a talk ping channel", () => {
        expect(reminders).toContain("const targets = pingTargetOptions(data.pingTargets);");
        expect(reminders).toContain("{targets.length > 0 && (");
    });
});

describe("dashboard task", () => {
    it("knows the role-sync task id", () => {
        expect(dashboardApi).toContain("\"sheet\" | \"recommendations\" | \"logs\" | \"inbox\" | \"channels\" | \"rolesync\"");
    });
});
