// The in-app documentation page (#349) — static content, no store/API calls,
// so these tests hold the structure together: every group has a color, every
// group card renders, and the page reacts to whether someone is logged in.
const { renderDocsPage, DISCORD_GROUPS, WEB_GROUPS, CAT } = require("../../src/web/docsPage");
const { esc } = require("../../src/web/render");

describe("docsPage", () => {
    it("maps every group's category to a defined color token", () => {
        for (const group of [...DISCORD_GROUPS, ...WEB_GROUPS]) {
            expect(CAT[group.cat]).toEqual({ varName: expect.stringMatching(/^--(area|doc)-[a-z]+$/), label: expect.stringMatching(/\S/) });
        }
        expect(CAT.raids).toEqual({ varName: "--area-raids", label: "Raids" });
        expect(CAT.auto).toEqual({ varName: "--doc-auto", label: "Automatik" });
    });

    it("renders a full HTML page with both section anchors", () => {
        const html = renderDocsPage(null);
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain("<h2 class=\"doc-section\" id=\"discord\">Discord-Befehle &amp; Abläufe</h2>");
        expect(html).toContain("<h2 class=\"doc-section\" id=\"web-admin\">Web-Admin-Bereiche</h2>");
    });

    it("renders exactly one card per group, colored with its category's token", () => {
        const html = renderDocsPage(null);
        const cards = html.match(/<details class="card doc-card"/g) || [];
        expect(cards).toHaveLength(DISCORD_GROUPS.length + WEB_GROUPS.length);
        for (const group of DISCORD_GROUPS) {
            expect(html).toContain(`border-left-color:var(${CAT[group.cat].varName})`);
            expect(html).toContain(esc(group.title));
        }
    });

    it("shows the login prompt for an anonymous visitor and the account for a logged-in one", () => {
        const anon = renderDocsPage(null);
        expect(anon).toContain("Mit Discord einloggen");
        expect(anon).not.toContain("Eingeloggt als");

        const user = renderDocsPage({ name: "Brokk", isAdmin: false });
        expect(user).toContain("Eingeloggt als");
        expect(user).toContain("Brokk");
    });

    it("never lets a command list break out of its <li> (raw HTML stays inside items)", () => {
        // Every item is trusted, hand-authored markup (not user input), so this
        // just guards against a stray unclosed tag creeping into a future edit.
        const html = renderDocsPage(null);
        const opens = (html.match(/<li>/g) || []).length;
        const closes = (html.match(/<\/li>/g) || []).length;
        expect(opens).toBe(closes);
    });
});
