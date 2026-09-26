// The menu's deploy line (#314): a scan that the Shell keeps it to one quiet
// line with the details in its tooltip. lib/deployVersion.ts itself runs in
// Vitest (src/web-client/src/lib/deployVersion.test.ts).

const { read } = require("../clientSource"); // inlines the @imports of index.css (#441)

describe("the menu's version line", () => {
    const shell = read("components", "Shell.tsx");

    it("sits in the sidebar as one line with the details in its tooltip", () => {
        expect(shell).toContain("side-version");
        expect(shell).toContain("data-tip-sub");
        expect(shell).toContain("<DeployLine user={user} />");
    });

    it("is only fetched for settings readers, so a member's page load asks GitHub nothing", () => {
        expect(shell).toMatch(/const maySee = canAccess\(user, "settings"\);/);
        expect(shell).toMatch(/useApi\(\(\) => getVersion\(\), \[\], \{ enabled: maySee \}\)/);
    });

    it("disappears rather than showing an error", () => {
        // only the answer is read: a failure leaves `version` null, and the line out
        expect(shell).toMatch(/useApi\(\(\) => getVersion\(\), \[\], \{ enabled: maySee \}\)\.data;/);
        expect(shell).toMatch(/if \(!version\) return null;/);
    });

    it("has a style for each tone in the bundle", () => {
        const css = read("index.css");
        for (const cls of [".side-version", ".side-version.v-ok", ".side-version.v-mid", ".side-version.v-bad"]) {
            expect(css).toContain(cls);
        }
    });

    it("lets the dashboard task open an address outside the menu", () => {
        const page = read("pages", "DashboardPage.tsx");
        expect(page).toContain("https?:\\/\\/");
        expect(page).toContain("target=\"_blank\"");
    });
});
