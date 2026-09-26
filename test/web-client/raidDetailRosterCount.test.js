// Regression guard for #479: on an own event, the Roster tab's counter read
// `data.setup?.total`, which is always empty for an own event (its Raid-Helper
// raidplan is deliberately built from `[]`, see raidDetailView.js's setupPart)
// — so the badge showed "0" no matter how many people had signed up. The
// signups the page actually renders for an own event live in `data.ownSignups`
// (RosterTab.tsx's <OwnSignupGroups>), so the counter must switch to that once
// it is one.
//
// No React renderer here (this suite predates Vitest in the client, #435 adds
// it in test/web-client separately) — the invariant is checked in the source,
// same style as test/web-client/raidDetail.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const page = fs.readFileSync(path.join(CLIENT, "pages", "RaidDetailPage.tsx"), "utf8");

describe("raid detail roster tab count (#479)", () => {
    it("counts an own event's roster from its signups, not the (always empty) raidplan setup", () => {
        const counts = page.match(/const counts: Record<Tab, number> = \{([\s\S]*?)\n\s*\};/);
        expect(counts).not.toBeNull();
        const body = counts[1];
        expect(body).toContain("roster: ownEvent ? (data.ownSignups?.length || 0) : (data.setup?.total || 0),");
        // A Raid-Helper event (ownEvent === false) must keep reading the raidplan
        // total exactly as before — no regression on the working half of the bug.
        expect(body).toMatch(/roster:.*data\.setup\?\.total \|\| 0/);
    });
});
