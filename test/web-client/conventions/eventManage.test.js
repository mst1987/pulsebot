// Event verwalten (#288): the rule a render cannot see — everything is styled
// in its own stylesheet under em-. The menu, the dialogs and the head's badges
// are rendered in Vitest (src/web-client/src/pages/RaidDetailPage.manage.test.tsx),
// the rules behind them run in lib/eventManage.test.ts.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("event manage conventions", () => {
    it("styles everything in its own stylesheet under em-", () => {
        const css = read("styles", "event-manage.css").replace(/\/\*[\s\S]*?\*\//g, "");
        const classes = [...css.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]).filter((c) => !["btn", "wi", "badge", "danger", "on", "is-loading"].includes(c));
        for (const c of classes) expect({ c, ok: c.startsWith("em-") }).toEqual({ c, ok: true });
        expect(read("pages", "RaidDetailPage.tsx")).toContain("import \"../styles/event-manage.css\";");
    });
});
