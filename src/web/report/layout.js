// The page shell of the log-check pages and of every page built on them (docs,
// the public event page): <head> with /r-assets/report.css, the admin chrome
// or the public header, /r-assets/report.js at the end. Also esc() and the
// login bar. Part of the report pages (#423, see render.js).
const { assetUrl } = require("./assets");
const { ICONS, renderAdminChrome, CHROME_STYLE } = require("./adminChrome");

// Discord brand mark for the "Sign in with Discord" button
const DISCORD_LOGO = "<svg viewBox=\"0 0 24 18\" width=\"22\" height=\"17\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M20.317 1.492A19.79 19.79 0 0 0 15.4 0c-.21.38-.456.89-.626 1.295a18.27 18.27 0 0 0-5.548 0A12.6 12.6 0 0 0 8.6 0 19.74 19.74 0 0 0 3.677 1.492C.533 6.186-.32 10.763.099 15.276a19.9 19.9 0 0 0 6.063 3.058c.49-.666.927-1.375 1.302-2.118a12.9 12.9 0 0 1-2.05-.978c.172-.126.34-.258.502-.392a14.2 14.2 0 0 0 12.166 0c.164.14.332.272.502.392-.654.386-1.34.714-2.05.978.375.743.81 1.452 1.302 2.118a19.84 19.84 0 0 0 6.063-3.058c.5-5.234-.838-9.77-3.582-13.784ZM8.02 12.5c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z\"/></svg>";

function esc(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A theme-toggle button. static/report.js paints its icon and wires the click.
function themeToggleBtn() {
    return "<button class=\"theme-toggle\" id=\"themeBtn\" type=\"button\" aria-label=\"Design umschalten\" data-tip=\"Hell / Dunkel umschalten\"></button>";
}

/**
 * Full HTML page shell. Shared by the log-check pages and the admin chrome so both
 * get the same tokens + light/dark theming.
 * @param {object} opts { bare, extraStyle } — bare:true drops the centered .wrap +
 *   footer so a page (e.g. the admin sidebar chrome from adminChrome.js) can supply
 *   its own outer structure; extraStyle is an inline <style> after /r-assets/report.css.
 */
function layout(title, body, opts = {}) {
    const bare = !!opts.bare;
    const inner = bare
        ? body
        : `<div class="wrap">
${body}
<footer>EventHelper · Log-Check · Tooltips by Wowhead</footer>
</div>`;
    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<script>/* set theme before first paint to avoid a flash */
(function(){try{var t=localStorage.getItem("eh-theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}})();
</script>
<link rel="stylesheet" href="${assetUrl("report.css")}">${opts.extraStyle ? `
<style>
${opts.extraStyle}
</style>` : ""}
</head>
<body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>
${inner}
<script src="${assetUrl("report.js")}"></script>
<script>const whTooltips={colorLinks:true,iconizeLinks:${opts.wowheadIconize ? "true" : "false"},renameLinks:${opts.wowheadIconize ? "true" : "false"}};</script>
<script src="https://wow.zamimg.com/widgets/power.js"></script>
</body>
</html>`;
}

// Slim public header for anonymous/non-admin visitors — admins get the sidebar chrome instead.
function publicBar(user) {
    return `<header class="pubbar">
      <div class="crest">${ICONS.crest}</div>
      <div>
        <div class="pubbar-name">EventHelper</div>
        <div class="pubbar-sub">Log-Check</div>
      </div>
      <div class="pubbar-actions">${authBar(user)}${themeToggleBtn()}</div>
    </header>`;
}

/**
 * Wraps a report/player body in the right shell: the admin sidebar + topbar for
 * admins, the public header + centered column for everyone else.
 * @param {object} opts { user, body, crumbs } — crumbs are only used by the admin chrome.
 */
function shellPage(title, { user, body, crumbs = [] }) {
    if (user && user.isAdmin) {
        const chrome = renderAdminChrome({
            user,
            activeTab: "cla",
            crumbs: [{ label: "Menü", href: "/" }, { label: "Log-Auswertung", href: "/cla" }, ...crumbs],
            body,
            actions: themeToggleBtn(),
            esc,
        });
        return layout(title, chrome, { bare: true, extraStyle: CHROME_STYLE });
    }
    return layout(title, `${publicBar(user)}${body}`);
}

// Login state for the public header. Admins never see this — they get the admin
// chrome (sidebar + user footer) around the page instead.
function authBar(user) {
    if (user && user.name) {
        const admin = user.isAdmin ? " · <a class=\"mlink\" href=\"/\">Gildenmenü</a>" : "";
        return `<span class="sub" style="margin:0">Eingeloggt als <strong>${esc(user.name)}</strong>${admin} · <a class="mlink" href="/auth/logout">Logout</a></span>`;
    }
    return `<a class="discord-btn" href="/auth/login">${DISCORD_LOGO}<span>Mit Discord einloggen</span></a>`;
}

function renderNotFound() {
    return layout("Nicht gefunden", `${publicBar(null)}<h1 class="page-title" style="margin-top:24px">404</h1><p class="sub">Diese Seite existiert nicht (mehr). <a class="mlink" href="/">Zur Übersicht</a></p>`);
}

function renderError(title, message) {
    return layout(title, `${publicBar(null)}<h1 class="page-title" style="margin-top:24px">${esc(title)}</h1><p class="sub">${esc(message)}</p><p class="sub"><a class="mlink" href="/">Zur Übersicht</a> · <a class="mlink" href="/auth/login">Erneut einloggen</a></p>`);
}

module.exports = {
    esc, themeToggleBtn, layout, shellPage, authBar, renderNotFound, renderError,
};
