// The in-app documentation page (#349): GET /docs, server-rendered like the
// report pages and reachable **without a login** — a link anyone can send a
// raider, and the "Dokumentation" icon in the web menu's topbar (Shell.tsx)
// points here too. Two guides in one page: Discord for raiders, the web admin
// for the orga. Since #474 the content is read from the guides themselves
// (docs/guide-discord.md, docs/guide-web-admin.md, see guideMarkdown.js) —
// there is no second copy here any more; a change belongs in the guide only.
// Styled with the same --area-* tokens the real sidebar/dashboard use
// (render.js), so a card's color matches the nav icon of the area it describes.
const fs = require("fs");
const path = require("path");
const { layout, esc, themeToggleBtn, authBar } = require("../report/render");
const { parseGuide } = require("./guideMarkdown");
const log = require("../../logger").child("docs");

const DOCS_DIR = path.join(__dirname, "..", "..", "..", "docs");
// Links from a guide to the technical docs open them on GitHub (the repo is public).
const REPO_DOCS_URL = "https://github.com/mst1987/pulsebot/blob/main/docs/";

// Category -> the CSS custom property carrying its color. One (auto) has no
// admin-area equivalent — see DOCS_STYLE below, where it gets its own small
// token pair instead of reusing --area-*.
const CAT = {
    raids: { varName: "--area-raids", label: "Raids" },
    signup: { varName: "--area-signups", label: "Anmeldung" },
    absences: { varName: "--area-absences", label: "Abwesenheiten" },
    profile: { varName: "--area-profile", label: "Mein Profil" },
    roster: { varName: "--area-roster", label: "Roster" },
    kader: { varName: "--area-kader", label: "Kaderplaner" },
    lootcouncil: { varName: "--area-lootcouncil", label: "Loot-Council" },
    history: { varName: "--area-history", label: "Historie & Loot" },
    bank: { varName: "--area-bank", label: "Gildenbank" },
    cla: { varName: "--area-cla", label: "Log-Auswertung" },
    channels: { varName: "--area-channels", label: "Kanäle" },
    settings: { varName: "--area-settings", label: "Einstellungen" },
    system: { varName: "--area-system", label: "System" },
    home: { varName: "--area-home", label: "Übersicht" },
    auto: { varName: "--doc-auto", label: "Automatik" },
};

// The two guides, in page order. `sectionCat` colors a `##` section by its
// anchor (the GitHub slug of the heading); a section missing here — a new one
// in a guide — gets `fallbackCat`, so adding a section never breaks the page.
const GUIDES = [
    {
        id: "discord",
        file: "guide-discord.md",
        heading: "Discord-Befehle & Abläufe",
        fallbackCat: "home",
        sectionCat: {
            "sprache": "profile",
            "anmeldung": "signup",
            "setup-gruppeneinteilung": "raids",
            "übersicht--nachschlagen": "home",
            "event-verwaltung-nur-orga": "raids",
            "was-der-bot-sonst-noch-automatisch-macht": "auto",
            "rollen-nachrichten": "auto",
            "neue-spielversion": "settings",
            "umstieg-von-raid-helper": "settings",
        },
    },
    {
        id: "web-admin",
        file: "guide-web-admin.md",
        heading: "Web-Admin-Bereiche",
        fallbackCat: "home",
        sectionCat: {
            "grundlagen": "home",
            "übersicht--dashboard": "home",
            "raid-events": "raids",
            "setup-editor": "raids",
            "raidplan": "raids",
            "raidplan-vorlagen": "raids",
            "serien-wiederkehrende-events": "raids",
            "raid-vorlagen": "raids",
            "anmeldungen": "signup",
            "abwesenheiten": "absences",
            "mein-profil": "profile",
            "roster": "roster",
            "kaderplaner": "kader",
            "loot-council": "lootcouncil",
            "historie--loot": "history",
            "gildenbank": "bank",
            "dungeon-bestzeiten": "roster",
            "addons": "system",
            "log-auswertung-clarpb": "cla",
            "kanäle": "channels",
            "systemstatus": "system",
            "einstellungen": "settings",
            "raidplan-im-detail": "raids",
        },
    },
];

/**
 * Where a link in a guide points on this page. Links inside a guide and to the
 * other guide become in-page anchors; links to other docs/*.md open on GitHub;
 * http(s) links stay; anything else keeps only its text.
 */
function resolveLink(guideId, href) {
    if (/^https?:\/\//i.test(href)) return { href, external: true };
    if (href.startsWith("#")) return { href: `#${guideId}-${href.slice(1)}` };
    const m = /^(?:\.\/)?([a-z0-9-]+\.md)(?:#(.*))?$/i.exec(href);
    if (!m) return null;
    const other = GUIDES.find((g) => g.file === m[1]);
    if (other) return { href: m[2] ? `#${other.id}-${m[2]}` : `#${other.id}` };
    return { href: `${REPO_DOCS_URL}${m[1]}${m[2] ? `#${m[2]}` : ""}`, external: true };
}

// Files already reported as unreadable — one log line per file and process,
// not one per page view (a missing guide is retried on every request).
const warnedMissing = new Set();

/** Reads one guide; null (and a log line, once per file) when the file is missing. */
function loadGuide(file, dir = DOCS_DIR) {
    try {
        return fs.readFileSync(path.join(dir, file), "utf8");
    } catch (err) {
        if (!warnedMissing.has(file)) {
            warnedMissing.add(file);
            log.warn(`Guide ${file} nicht lesbar: ${err.message}`);
        }
        return null;
    }
}

/**
 * A guide as page sections. The intro's first paragraph becomes the lead under
 * the heading, the rest of the intro the first card ("Grundlagen").
 */
function guideSections(guide, markdown) {
    const parsed = parseGuide(markdown, { idPrefix: guide.id, resolveLink: (href) => resolveLink(guide.id, href) });
    const [lead, ...rest] = parsed.intro;
    const sections = rest.length
        ? [{ id: `${guide.id}-grundlagen`, slug: "grundlagen", title: "Grundlagen", titleHtml: "Grundlagen", scope: null, scopeHtml: null, html: rest.join("\n") }, ...parsed.sections]
        : parsed.sections;
    return {
        lead: lead || "",
        sections: sections.map((s) => ({ ...s, cat: guide.sectionCat[s.slug] || guide.fallbackCat })),
    };
}

function legend(sections) {
    const seen = new Map();
    for (const s of sections) if (!seen.has(s.cat)) seen.set(s.cat, CAT[s.cat]);
    const items = [...seen.values()].map((c) => `<span class="doc-legend-item"><span class="doc-legend-dot" style="background:var(${c.varName})"></span>${esc(c.label)}</span>`).join("");
    return `<div class="doc-legend"><span class="doc-legend-label">Bereiche:</span>${items}</div>`;
}

function card(section, index) {
    const c = CAT[section.cat];
    const badge = section.scope ? `<span class="doc-badge" style="color:var(${c.varName});background:color-mix(in srgb, var(${c.varName}) 16%, transparent)">${section.scopeHtml}</span>` : "";
    return `<details class="card doc-card" id="${esc(section.id)}" style="border-left-color:var(${c.varName})">
      <summary>
        <span class="doc-idx" style="color:var(${c.varName});background:color-mix(in srgb, var(${c.varName}) 18%, transparent)">${String(index + 1).padStart(2, "0")}</span>
        <span class="doc-card-title">${section.titleHtml}</span>
        ${badge}
      </summary>
      <div class="doc-card-body">${section.html}</div>
    </details>`;
}

function guideBlock(guide, markdown) {
    if (markdown === null) {
        return `<h2 class="doc-section" id="${guide.id}">${esc(guide.heading)}</h2>
    <p class="doc-sub">Dieser Teil der Hilfe ist gerade nicht verfügbar.</p>`;
    }
    const { lead, sections } = guideSections(guide, markdown);
    return `<h2 class="doc-section" id="${guide.id}">${esc(guide.heading)}</h2>
    ${lead ? `<div class="doc-lead">${lead}</div>` : ""}
    ${legend(sections)}
    ${sections.map(card).join("")}`;
}

// Opens the card a link points to (#web-admin-roster, also from another page)
// and every card around a sub-heading anchor, then scrolls to it.
const OPEN_TARGET_SCRIPT = `<script>(function(){function show(){var id;try{id=decodeURIComponent(location.hash.slice(1));}catch(e){return;}
if(!id)return;var el=document.getElementById(id);if(!el)return;
for(var d=el;d;d=d.parentElement){if(d.tagName==="DETAILS")d.open=true;}el.scrollIntoView();}
window.addEventListener("hashchange",show);show();})();</script>`;

const DOCS_STYLE = `
  :root { --doc-auto:#7c3aed; }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) { --doc-auto:#6a4fe0; }
  }
  :root[data-theme="light"] { --doc-auto:#6a4fe0; }
  .doc-head { padding:22px 0 4px; }
  .doc-brand { font-weight:800; font-size:24px; letter-spacing:-.3px; }
  .doc-sub { color:var(--muted); margin:4px 0 18px; font-size:14px; }
  .doc-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 16px; }
  .doc-tab { font-weight:700; font-size:14px; padding:8px 16px; border-radius:8px; border:1px solid var(--line);
    background:var(--panel2); color:var(--muted); text-decoration:none; }
  .doc-tab:hover { color:var(--text); border-color:var(--accent); }
  .doc-lead p { color:var(--muted); margin:0 0 12px; font-size:14px; }
  .doc-lead strong { color:var(--text); }
  .doc-legend { display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; margin:0 0 10px; }
  .doc-legend-label { font-size:12px; color:var(--muted); margin-right:2px; }
  .doc-legend-item { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--muted); }
  .doc-legend-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
  .doc-legend-note { margin:2px 0 18px; font-size:12px; color:var(--muted); font-style:italic; }
  .doc-section { margin:32px 0 8px; font-size:19px; font-weight:800; scroll-margin-top:20px; }
  .doc-card { margin:0 0 8px; border-left-width:4px; scroll-margin-top:12px; }
  .doc-card > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:12px; padding:13px 16px; }
  .doc-card > summary::-webkit-details-marker { display:none; }
  .doc-card > summary::after { content:"›"; margin-left:auto; color:var(--muted); transition:transform .15s; font-size:18px; }
  .doc-card[open] > summary::after { transform:rotate(90deg); }
  .doc-idx { font-family:var(--font-mono); font-weight:700; font-size:12px; width:24px; height:24px; border-radius:6px;
    display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
  .doc-card-title { font-weight:700; font-size:15.5px; flex:1; min-width:0; }
  .doc-badge { font-size:10.5px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; padding:3px 8px; border-radius:5px; white-space:nowrap; }
  .doc-card-body { padding:0 16px 15px 52px; color:var(--muted); font-size:13.5px; line-height:1.55; overflow-wrap:anywhere; }
  .doc-card-body p { margin:0 0 10px; }
  .doc-card-body h3 { margin:18px 0 8px; font-size:14.5px; font-weight:700; color:var(--text); scroll-margin-top:12px; }
  .doc-card-body ul, .doc-card-body ol { margin:0 0 10px; padding-left:18px; }
  .doc-card-body li { margin-bottom:6px; }
  .doc-card-body li > ul, .doc-card-body li > ol { margin:6px 0 0; }
  .doc-card-body li:last-child { margin-bottom:0; }
  .doc-card-body > :last-child { margin-bottom:0; }
  .doc-card-body code { background:var(--panel3); color:var(--text); padding:1px 5px; border-radius:4px; font-size:.9em; font-family:var(--font-mono); }
  .doc-card-body strong { color:var(--text); }
  .doc-card-body a, .doc-lead a { color:var(--accent); }
  @media (max-width:600px) {
    .doc-card-body { padding:0 14px 14px 16px; }
    .doc-card > summary { padding:12px 14px; gap:10px; }
    .doc-badge { white-space:normal; max-width:45%; }
  }`;

/** Both guides as page blocks, read once per process (the files change only with a deploy). */
let cachedGuides = null;
function renderGuides() {
    if (!cachedGuides) {
        const texts = GUIDES.map((g) => loadGuide(g.file));
        const html = GUIDES.map((g, i) => guideBlock(g, texts[i])).join("\n");
        // A missing file is retried on the next request instead of being cached.
        if (texts.every((t) => t !== null)) cachedGuides = html;
        return html;
    }
    return cachedGuides;
}

function renderDocsBody(user, guidesHtml) {
    return `<header class="doc-head">
      <div class="doc-brand">Event<span style="color:var(--accent)">Helper</span> Dokumentation</div>
      <p class="doc-sub">Discord-Befehle für Raider und die Bereiche im Web-Admin — was jeder Befehl und jede Seite tut.</p>
      <div class="doc-tabs">
        <a class="doc-tab" href="#discord">Discord</a>
        <a class="doc-tab" href="#web-admin">Web-Admin</a>
        <a class="doc-tab" href="/" style="margin-left:auto">${user && user.name ? "Zum Gildenmenü" : "Mit Discord anmelden"}</a>
      </div>
    </header>
    ${guidesHtml}
    <p class="doc-legend-note">Farbe = Bereich in der App, so siehst du auf einen Blick, was zusammengehört und wo du nachschauen musst.</p>
    ${OPEN_TARGET_SCRIPT}`;
}

/** Header actions row: login state + theme toggle, same vocabulary as the public report pages. */
function renderDocsPage(user) {
    const body = `<div class="wrap">
    <div class="pubbar" style="margin-bottom:0">
      <div style="margin-left:auto" class="pubbar-actions">${authBar(user)}${themeToggleBtn()}</div>
    </div>
    ${renderDocsBody(user, renderGuides())}
    <footer>EventHelper · Dokumentation</footer>
    </div>`;
    return layout("Dokumentation · EventHelper", body, { bare: true, extraStyle: DOCS_STYLE });
}

module.exports = { renderDocsPage, guideBlock, guideSections, resolveLink, loadGuide, GUIDES, CAT, DOCS_DIR };
