// "Ansicht als Rolle" in the menu (components/ViewAs.tsx). The client has no
// React test renderer, so these are source scans for what matters: the button
// only for a real full admin, the bar with its way back on every page, and a
// reload so the new rights reach every part of the menu.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("Ansicht als Rolle (client)", () => {
    const view = read("components", "ViewAs.tsx");
    const shell = read("components", "Shell.tsx");

    it("sits in the shell: the button in the top bar, the bar above every page", () => {
        expect(shell).toContain("<ViewAsButton user={user} />");
        const content = shell.slice(shell.indexOf("<div className=\"content\""));
        expect(content.indexOf("<ViewAsBanner")).toBeGreaterThan(-1);
        expect(content.indexOf("<ViewAsBanner")).toBeLessThan(content.indexOf("<Outlet"));
    });

    it("offers the button only to a real full admin and not while a view runs", () => {
        expect(view).toContain("if (!user.canViewAs || user.viewAs) return null;");
    });

    it("always offers the way back — Beenden does not depend on the viewed role's rights", () => {
        const banner = view.slice(view.indexOf("export function ViewAsBanner"));
        expect(banner).toContain("setViewAs({ stop: true })");
        // "Beenden" is not behind canViewAs, only "Ändern" is
        expect(banner).toMatch(/<Button size="sm" onClick=\{stop\}/);
        expect(banner).toMatch(/\{user\.canViewAs && <Button variant="ghost" size="sm"/);
    });

    it("reloads the menu from the start after starting or stopping", () => {
        expect(view).toContain("window.location.assign(\"/\")");
        expect(view.match(/reloadMenu\(\);/g).length).toBe(2);
    });

    it("has its texts in both languages", () => {
        const de = JSON.parse(read("i18n", "locales", "de", "shell.json")).viewAs;
        const en = JSON.parse(read("i18n", "locales", "en", "shell.json")).viewAs;
        expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
        for (const key of [...view.matchAll(/t\("shell\.viewAs\.(\w+)"/g)].map((m) => m[1])) {
            expect({ key, de: !!de[key], en: !!en[key] }).toEqual({ key, de: true, en: true });
        }
    });
});
