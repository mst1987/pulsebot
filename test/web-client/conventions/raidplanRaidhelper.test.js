// The raid plan of a Raid-Helper event in the client (docs/raidplan.md, "Raid-Helper-Events"): the pages checked on their source.
// The libs (the slim menu, the activation dialog's start values, the head line of the plan, how a Raid-Helper name reads) run in
// Vitest: src/web-client/src/lib/raidplanRaidhelper.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the activation dialog", () => {
    it("the page: the menu for a Raid-Helper event with raidplan write, the dialog, the confirmation before switching off", () => {
        const page = read("pages", "raid-detail", "RaidDetailPage.tsx");
        // the switch sits in Verwalten, the orga's menu (Oct 2026): raidplan write alone is not enough
        expect(page).toContain("const canSwitchPlan = orga && !ownEvent && !archived && planning !== \"sheet\" && canAccess(user, \"raidplan\", \"write\");");
        // the switch is the menu's entry for raidplan write; the loot system (raids write) may stand beside it
        expect(page).toContain("...(canSwitchPlan ? raidhelperMenu({ planEnabled: !!data.event.raidplanEnabled, disabled: !!data.event.raidhelperDisabled }) : []),");
        expect(page).toContain("entries={raidhelperEntries}");
        expect(page).toMatch(/action === "raidplanOff"\) \{\n\s+const ok = await ask\(/);
        const modal = read("pages", "raid-detail", "manage", "RaidplanLinkModal.tsx");
        expect(modal).toContain("hint={t(\"raidDetail.raidplanLink.readOnly\")}");
        expect(modal).toContain("t(\"raidBoard.rh.noGroups\")");
    });
});

describe("how a Raid-Helper name reads", () => {
    it("the name is set apart, the search finds both names", () => {
        const board = read("components", "raidplan", "PlanBoard.tsx");
        expect(board).toContain("player.nameFromRh ? \"rp-pname-rh\" : \"\", player.gone ? \"rp-pname-gone\" : \"\"");
        expect(read("lib", "raidplan", "assignModal.ts")).toContain("e.player && e.player.rhName ? e.player.rhName : \"\"");
        expect(read("components", "raidplan", "editor", "AssignRosterModal.tsx")).toContain("c.player.rhName || \"\"");
        const tab = read("pages", "raid-detail", "RaidplanTab.tsx");
        expect(tab).toContain("{view.rosterSource && <RhSource src={view.rosterSource} busy={reloading} onReload={reloadRoster} />}");
        expect(tab).toContain("getRaidplan(eventId, true)");
    });
});
