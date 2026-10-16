// The accent of the server-rendered pages follows the game version (#742): a log report
// carries its log's version on <html>, the public event page its event's, any other page
// none (so it keeps the brand colour). report-version.css holds the same default colours
// as the web client's tokens.css.
const fs = require("fs");
const path = require("path");
const { layout, setPageVersion } = require("../../../src/web/report/layout");
const { withReportVersion } = require("../../../src/web/report/widgets");
const { publicEventView, renderPublicEventPage } = require("../../../src/web/pages/eventPublicPage");
const { ownEvent } = require("../../factories/events");
const { VERSIONS } = require("../../../src/config/gameVersions");

const STATIC = path.join(__dirname, "..", "..", "..", "src", "web", "static");
const CLIENT_TOKENS = path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "styles", "tokens.css");

describe("web/report/layout — data-version (#742)", () => {
    it("has no version on a plain page and links the version stylesheet", () => {
        const html = layout("T", "<p>x</p>");
        expect(html).toContain("<html lang=\"de\">");
        expect(html).toMatch(/href="\/r-assets\/report-version\.css\?v=[0-9a-f]+"/);
    });

    it("marks the version of the report being rendered, only while it renders", () => {
        let inside;
        withReportVersion({ versionId: "forever" }, () => { inside = layout("T", "<p>x</p>"); });
        expect(inside).toContain("<html lang=\"de\" data-version=\"forever\">");
        expect(layout("T", "<p>x</p>")).toContain("<html lang=\"de\">");
    });

    it("takes an explicit version over the rendering one, and refuses anything that is no id", () => {
        expect(layout("T", "", { version: "tbc" })).toContain("data-version=\"tbc\"");
        expect(layout("T", "", { version: "\"><script>" })).not.toContain("<script>alert");
        expect(layout("T", "", { version: "\"><x" })).toContain("<html lang=\"de\">");
        expect(setPageVersion("x y")).toBe("");
    });

    it("gives the public event page the version of its event", () => {
        const html = renderPublicEventPage(publicEventView(ownEvent({ versionId: "forever" }), [], { lang: "en" }), { lang: "en" });
        expect(html).toContain("<html lang=\"en\" data-version=\"forever\">");
    });
});

describe("static/report-version.css", () => {
    const css = fs.readFileSync(path.join(STATIC, "report-version.css"), "utf8");
    const client = fs.readFileSync(CLIENT_TOKENS, "utf8");

    it("carries the web client's default colour of every version, dark and light", () => {
        for (const v of VERSIONS) {
            expect(css).toContain(`--ver-${v.id}:${v.color};`);
            const light = new RegExp(`--ver-${v.id}: var\\(--vc-${v.id}-light, (#[0-9a-f]{6})\\)`).exec(client)[1];
            expect(css).toContain(`--ver-${v.id}:${light};`);
        }
    });

    it("turns the accent into the version colour for the three versions", () => {
        expect(css).toMatch(/:root\[data-version="forever"\], :root\[data-version="tbc"\], :root\[data-version="classic"\] \{\s*--accent:var\(--version-color\)/);
    });
});
