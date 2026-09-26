// HTML rendering for the logcheck report website — the entry point the server,
// docsPage.js and eventPublicPage.js require. The pages themselves live in
// src/web/report/ (#423): layout.js (the shell), widgets.js, panels/*.js,
// fightTopics.js / fight.js, bossView.js, raidGroups.js, raiderView.js,
// recommendations.js, context.js, reportPage.js and playerPage.js. Their CSS
// and client JS are static files under src/web/static/, served as /r-assets/
// by report/assets.js. See docs/logcheck.md.
//
// Report pages are public (their links are posted to Discord), so they stay
// server-rendered. Visitors with admin rights get the same sidebar/topbar chrome
// as the React admin around them (see adminChrome.js) so a log-check is a normal
// stop inside the admin menu instead of a dead end.

const { layout, esc, authBar, themeToggleBtn, renderNotFound, renderError } = require("./report/layout");
const { renderReportPage } = require("./report/reportPage");
const { renderPlayerPage } = require("./report/playerPage");

module.exports = { renderReportPage, renderPlayerPage, renderNotFound, renderError, layout, esc, authBar, themeToggleBtn };
