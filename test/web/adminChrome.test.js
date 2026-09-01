const { renderAdminChrome, CHROME_STYLE, TABS } = require("../../src/web/adminChrome.js");

// The chrome renderer takes the caller's escaper (render.js owns it).
function esc(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function render(opts = {}) {
    return renderAdminChrome({
        user: { name: "Admin" },
        activeTab: "cla",
        crumbs: [{ label: "Menü", href: "/" }, { label: "CLA / Logcheck", href: "/cla" }, { label: "Test Raid" }],
        body: "<p>inhalt</p>",
        actions: "<button id=\"themeBtn\"></button>",
        esc,
        ...opts,
    });
}

describe("web/adminChrome", () => {
    it("renders the brand, every nav tab and the page body", () => {
        const html = render();
        expect(html).toContain("EventHelper");
        // Same wording as the React shell's brand-sub (Shell.tsx).
        expect(html).toContain("Gildenmenü");
        for (const tab of TABS) {
            expect(html).toContain(`href="${tab.href}"`);
            expect(html).toContain(`<span>${tab.label}</span>`);
        }
        expect(html).toContain("<div class=\"content\"><p>inhalt</p></div>");
    });

    // Both the SSR chrome and the React client are served from the root now, so
    // a link that still carried /admin would take a needless redirect hop.
    it("uses the same hrefs as the React routes, at the root", () => {
        const html = render();
        expect(html).toContain("href=\"/\"");
        expect(html).toContain("href=\"/history\"");
        expect(html).toContain("href=\"/cla\"");
        expect(html).not.toContain("href=\"/admin");
    });

    it("marks only the active tab", () => {
        const html = render();
        expect(html).toContain("nav-item area-cla active");
        expect(html).toContain("class=\"nav-item area-raids\"");
    });

    it("renders breadcrumbs with links for all but the last segment", () => {
        const html = render();
        expect(html).toContain("<a href=\"/\">Menü</a>");
        expect(html).toContain("<a href=\"/cla\">CLA / Logcheck</a>");
        expect(html).toContain("<b>Test Raid</b>");
    });

    it("shows the logged-in admin with an initial avatar and a logout link", () => {
        const html = render({ user: { name: "marc" } });
        expect(html).toContain("<div class=\"avatar\">M</div>");
        expect(html).toContain("<div class=\"u-name\">marc</div>");
        expect(html).toContain("Administrator");
        expect(html).toContain("href=\"/auth/logout\"");
    });

    it("falls back to a generic name when the user has none", () => {
        const html = render({ user: null });
        expect(html).toContain("<div class=\"u-name\">Admin</div>");
    });

    it("escapes user-supplied text", () => {
        const html = render({ user: { name: "<b>x</b>" }, crumbs: [{ label: "<script>" }] });
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).toContain("<b>&lt;script&gt;</b>");
        expect(html).not.toContain("<script>x");
    });

    it("wires the mobile sidebar toggle and ships the shell styles", () => {
        const html = render();
        expect(html).toContain("id=\"menuBtn\"");
        expect(html).toContain("id=\"sideNav\"");
        expect(html).toContain("side.classList.toggle(\"open\")");
        expect(CHROME_STYLE).toContain(".nav-item");
        expect(CHROME_STYLE).toContain(".topbar");
    });

    it("places the topbar actions (theme toggle) in the top bar", () => {
        const html = render();
        expect(html).toContain("<div class=\"top-actions\"><button id=\"themeBtn\"></button></div>");
    });
});
