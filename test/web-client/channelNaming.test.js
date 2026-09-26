// #285: the web shows where a channel name comes from — one badge with the
// details in its tooltip — in the create dialog, quick-create and the bulk rename.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("web client — visible channel naming (#285)", () => {
    it("has one badge component: the label on it, detail and design in the tooltip", () => {
        const badge = read("components", "channels", "NamingBadge.tsx");
        expect(badge).toContain("tip={naming.label}");
        expect(badge).toContain("tipSub={[naming.detail, naming.design].filter(Boolean).join(\" · \")}");
        expect(badge).toContain("t(`raidCreate.naming.${naming.source}`)");
        expect(require("./i18nHelper").makeT("de")("raidCreate.naming.previous")).toBe("abgeleitet");
    });

    it("asks the server for the create dialog's name suggestion and shows where it comes from", () => {
        const api = read("api", "raids.ts");
        expect(api).toContain("`/api/raids/channel-name?${q.toString()}`");
        const dialog = read("components", "RaidCreateDialog.tsx");
        expect(dialog).toContain("getChannelNameSuggestion({ categoryId, date, instanceIds: plan.instanceIds, sourceEventId: namingSourceId })");
        expect(dialog).toContain("if (naming?.name) return naming.name;");
        expect(dialog).toContain("<NamingBadge naming={naming} />");
        // a hand-typed name says so instead of claiming a derivation
        expect(dialog).toContain(">{t(\"raidCreate.kanal.manual\")}</Badge>");
    });

    it("shows it in quick-create above the preview and per row in the bulk rename", () => {
        const quick = read("components", "channels", "QuickCreateDialog.tsx");
        expect(quick).toContain("setNaming(r.naming || null)");
        expect(quick).toContain("<NamingBadge naming={naming} />");
        expect(quick).toContain("placeholder=\"leer = wie der letzte Event-Kanal\"");
        const bulk = read("components", "channels", "ChannelBulk.tsx");
        expect(bulk).toContain("<NamingBadge naming={r.naming} short />");
        expect(bulk).toContain("placeholder=\"leer = wie der letzte Event-Kanal\"");
    });

    it("routes the suggestion through the raids area", () => {
        const { AREA_BY_PATH } = require("../../src/web/http/apiAccess");
        expect(AREA_BY_PATH["/api/raids/channel-name"]).toBe("raids");
    });
});
