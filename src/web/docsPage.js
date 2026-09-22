// The in-app documentation page (#349): GET /docs, server-rendered like the
// report pages and reachable **without a login** — a link anyone can send a
// raider, and the "Dokumentation" icon in the web menu's topbar (Shell.tsx)
// points here too. Two guides in one page: Discord commands for raiders,
// web-admin sections for orga. Styled with the same --area-* tokens the real
// sidebar/dashboard use (render.js), so a card's color always matches the
// nav icon of the area it describes — no separate palette to keep in sync.
const { layout, esc, themeToggleBtn, authBar } = require("./render");

// Category -> the CSS custom property carrying its color. Three (auction,
// gdkp, auto) have no admin-area equivalent — see DOCS_STYLE below, where
// they get their own small token pair instead of reusing --area-*.
const CAT = {
    raids: { varName: "--area-raids", label: "Raids" },
    signup: { varName: "--area-signups", label: "Anmeldung" },
    profile: { varName: "--area-profile", label: "Mein Profil" },
    roster: { varName: "--area-roster", label: "Roster" },
    lootcouncil: { varName: "--area-lootcouncil", label: "Loot-Council" },
    history: { varName: "--area-history", label: "Historie & Loot" },
    cla: { varName: "--area-cla", label: "Log-Auswertung" },
    channels: { varName: "--area-channels", label: "Kanäle" },
    settings: { varName: "--area-settings", label: "Einstellungen" },
    home: { varName: "--area-home", label: "Übersicht" },
    recruitment: { varName: "--area-recruitment", label: "Recruitment" },
    auction: { varName: "--doc-auction", label: "Auktion" },
    gdkp: { varName: "--doc-gdkp", label: "GDKP-Gold" },
    auto: { varName: "--doc-auto", label: "Automatik" },
};

const DISCORD_GROUPS = [
    { cat: "signup", title: "Anmeldung", items: [
        "Button unter der Event-Nachricht öffnet den <strong>Anmelde-Dialog</strong>: Charakter + Spec, „kann auch“-Rollen, Status (Dabei / Vielleicht / Spät / Bank / Abmelden), Kommentar.",
        "Status-Buttons direkt an der Nachricht: <strong>Spät · Vielleicht · Bank · Absagen</strong> — ohne den vollen Dialog.",
        "Auf der Talk-Server-Übersicht: <strong>„Für alle Raids anmelden“</strong> bzw. „Mehrere Raids wählen …“ für mehrere Termine auf einmal.",
        "Noch kein Charakter im Bot? Der Dialog fragt beim ersten Mal nach Klasse/Spec/Name und legt ihn automatisch an.",
        "<code>/profile</code> (<code>/profil</code>) — Profil-Zusammenfassung, „kann Offtank/Heilen“-Buttons, Link zur Profilseite.",
    ] },
    { cat: "raids", title: "Setup (Gruppeneinteilung)", items: [
        "Erst sichtbar, sobald die Orga es <strong>freigibt</strong> — vorher sieht kein Raider etwas.",
        "Nach Freigabe: eigene Nachricht im Kanal (Gruppen, Bank) + optional <strong>DM</strong> mit der eigenen Zuteilung.",
        "<strong>„Invite callen“</strong> an der Setup-Nachricht: nur Orga, pingt die eigene Gruppe.",
        "<code>/show-mysetups</code> — eigene freigegebene Setups über mehrere Raids.",
        "<code>/show-allsetups</code> — alle aktuell freigegebenen Setups.",
    ] },
    { cat: "auction", title: "Auktion / Bidding", badge: "Legendaries", items: [
        "<code>/bid</code> · <code>/bid-5k</code> · <code>/bid-10k</code> · <code>/bidCustom</code> — bieten (braucht die Legendary-Rolle).",
        "<code>/auctionStatus</code> — Höchstbieter und Stand ansehen.",
        "<code>/createauction</code> · <code>/updateauction</code> · <code>/endauction</code> · <code>/deleteauction</code> — nur Orga.",
    ] },
    { cat: "gdkp", title: "GDKP-Gold", items: [
        "<code>/currentspent</code> — eigene Ausgaben der laufenden Session.",
        "<code>/lastspent</code> — Ausgaben der letzten Session.",
        "<code>/totalspent</code> — Gesamtausgaben über alle Sessions.",
    ] },
    { cat: "home", title: "Übersicht & Nachschlagen", badge: "privat", items: [
        "<code>/raids</code> — kommende Raids. <code>/raid &lt;Event&gt;</code> — Details zu einem Raid.",
        "<code>/anwesenheit</code> — eigene Anwesenheit. <code>/anwesenheit-raider &lt;Name&gt;</code> — für andere (Orga).",
        "<code>/report</code> — Liste der Log-Auswertungen.",
        "<code>/loot ich · item · raider</code> — eigene/Item-/Spieler-Loot-Historie.",
        "<code>/council &lt;Item&gt;</code> — Loot-Council-Infos zu einem Item (Orga).",
        "<code>/kanal umbenennen · archivieren · anlegen</code> — Kanalverwaltung (Orga).",
    ] },
    { cat: "raids", title: "Event-Verwaltung", badge: "Orga", items: [
        "<code>/event anlegen</code> — neues Event per geführtem Dialog.",
        "<code>/event verwalten [Event]</code> bzw. Rechtsklick „Event verwalten“ — bearbeiten, verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, Fehlende pingen, Setup öffnen, absagen, löschen.",
        "<code>/saveraid</code> — Setup/Raidplan ins Sheet übernehmen.",
        "<code>/createoverview</code>, <code>/update-events</code> — ältere Befehle, durch die Talk-Übersicht ersetzt.",
    ] },
    { cat: "auto", title: "Was der Bot automatisch macht", items: [
        "<strong>Talk-Server-Übersicht:</strong> aktualisiert sich selbst, listet alle kommenden Raids mit Anmelde-Buttons.",
        "<strong>Erinnerungs-Pings:</strong> vor Anmeldeschluss und vor Start, Zeitpunkt je Kategorie eingestellt.",
        "<strong>Automatische Ankündigung</strong> neuer Events mit Rollenping (falls aktiviert).",
        "<strong>Rollen-Sync</strong> zwischen Event- und Talk-Server, optional ein natives Discord-Event pro Raid.",
        "Umstieg von Raid-Helper: neue Kategorien laufen über den eigenen Anmeldeweg, alte bleiben auf Raid-Helper bis zur Umstellung.",
    ] },
];

const WEB_GROUPS = [
    { cat: "home", title: "Übersicht / Dashboard", items: [
        "Offene Aufgaben auf einen Blick: fehlender Softres-Link, Kanäle zum Archivieren, fehlgeschlagene Serien-Events, Rollen-Drift.",
        "Nächste anstehende Raids.",
    ] },
    { cat: "raids", title: "Raid-Events", badge: "Bereich: Raids", items: [
        "Event anlegen per geführtem Dialog (Vorlage, Termin, Größe/Rollen, Kanal, Anmeldung) oder bearbeiten.",
        "<strong>Raid-Cockpit:</strong> fünf Schritte — Angelegt → Anmeldung → Setup → Freigabe → Nachbereitung — mit Vorschlag für die nächste Handlung.",
        "„Verwalten“-Menü: verschieben, Anmeldung öffnen/schließen, Raider ein-/austragen, pingen, absagen, löschen.",
        "Kalender-Link (.ics), öffentliche Event-Seite ohne Login, Discord-Event anlegen.",
    ] },
    { cat: "raids", title: "Setup-Editor", badge: "Bereich: Raids", items: [
        "Setup automatisch vorschlagen (Rollen, Buffs, Fairness, Wünsche), per Drag &amp; Drop anpassen, Plätze fixieren.",
        "Vor Freigabe unsichtbar für Raider. <strong>„Freigeben“</strong> postet die Nachricht + optionale DMs.",
        "KI-Begründung der Aufstellung, „Invite callen“ direkt aus dem Editor.",
    ] },
    { cat: "raids", title: "Serien (wiederkehrende Events)", badge: "Bereich: Raids", items: [
        "Feste Wochentage/Uhrzeit je Kategorie + Vorlage — Events werden automatisch angelegt.",
        "Vorschau der nächsten Termine, Termine überspringen, fehlgeschlagene Läufe erneut anstoßen.",
    ] },
    { cat: "raids", title: "Raid-Vorlagen", badge: "Bereich: Raids", items: [
        "Wiederverwendbare Vorlagen: Instanzen, Größe, Rollen, Pflicht-Buffs, Anmeldeschluss, Aussehen der Nachricht.",
    ] },
    { cat: "signup", title: "Anmeldungen", badge: "Bereich: signup", items: [
        "Eigene kommende Raids und Anmeldestatus je Charakter verwalten, auch für mehrere Raids gleichzeitig.",
    ] },
    { cat: "profile", title: "Mein Profil", badge: "Bereich: signup", items: [
        "Charaktere pflegen (Klasse/Spec/Gearstand), Verfügbarkeit nach Wochentag, bevorzugte Raids.",
        "Wunschpartner und „nicht zusammen raiden mit“ hinterlegen.",
        "Persönlicher Kalender-Abo-Link für alle eigenen Anmeldungen.",
    ] },
    { cat: "roster", title: "Roster", badge: "Bereich: roster", items: [
        "Alle bekannten Charaktere je Raid-Kategorie mit Anwesenheit.",
        "Charaktere ausblenden (ohne Daten zu löschen), z. B. bei Guild-Austritt.",
    ] },
    { cat: "lootcouncil", title: "Loot-Council", badge: "Bereich: lootcouncil", items: [
        "Rangliste je Raider nach Bedarf (Drought, Loot-Anteil, BiS-Abstand).",
        "Gear-Ansicht und Drop-Check für ein konkretes Item.",
        "DPS-Simulation einzelner Ausrüstungswechsel, BiS-Listen je Spec.",
    ] },
    { cat: "history", title: "Historie & Loot", badge: "Bereich: history", items: [
        "Vergaben, Items, Gründe und Loot nach Raid einsehen.",
        "Loot-Export aus Gargul/RCLootcouncil importieren.",
        "Addon-Inbox: automatisch hochgeladene Loot-Sessions bestätigen und zuordnen.",
    ] },
    { cat: "cla", title: "Log-Auswertung (CLA/RPB)", badge: "Bereich: history", items: [
        "Kampfverlauf, Buffs/Debuffs, Cooldown-Nutzung, Heiler-Performance, vermeidbare Tode.",
        "Empfehlungen je Raider prüfen, per KI umformulieren, freigeben und per DM verschicken.",
        "Schutz gegen Auswertung eines noch laufenden Raids (mit Bestätigung übergehbar).",
    ] },
    { cat: "channels", title: "Kanäle", badge: "Bereich: channels", items: [
        "Alle Server-Kanäle als Liste; umbenennen, archivieren, löschen (einzeln oder mehrfach).",
        "Schnellanlage mehrerer Event-Kanäle nach Namensschema, optional gleich mit Event.",
    ] },
    { cat: "settings", title: "Einstellungen", badge: "meist Admin", items: [
        "<strong>Zugang</strong> — wer ist Bot-Admin.",
        "<strong>Berechtigungen</strong> — Rechte je Rolle/Konto pro Bereich, Basiszugang, Bot-Befehl-Rechte, „Ansicht als Rolle“.",
        "<strong>Verbindungen</strong> — Discord-Server, Raid-Helper-Umstieg, Loot-Sync-Token, Warcraft-Logs- und KI-Zugang.",
        "<strong>Kategorien</strong> — pro Raid-Kategorie Quelle, Rollen, Vorlage, Lootsystem, Erinnerungen, Setup-DMs, Sprachkanal.",
    ] },
];

const DOCS_STYLE = `
  :root { --doc-auction:#dc2626; --doc-gdkp:#b45309; --doc-auto:#7c3aed; }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) { --doc-auction:#cf3b37; --doc-gdkp:#9a6c12; --doc-auto:#6a4fe0; }
  }
  :root[data-theme="light"] { --doc-auction:#cf3b37; --doc-gdkp:#9a6c12; --doc-auto:#6a4fe0; }
  .doc-head { padding:22px 0 4px; }
  .doc-brand { font-weight:800; font-size:24px; letter-spacing:-.3px; }
  .doc-sub { color:var(--muted); margin:4px 0 18px; font-size:14px; }
  .doc-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 16px; }
  .doc-tab { font-weight:700; font-size:14px; padding:8px 16px; border-radius:8px; border:1px solid var(--line);
    background:var(--panel2); color:var(--muted); text-decoration:none; }
  .doc-tab:hover { color:var(--text); border-color:var(--accent); }
  .doc-legend { display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; margin:0 0 4px; }
  .doc-legend-label { font-size:12px; color:var(--muted); margin-right:2px; }
  .doc-legend-item { display:flex; align-items:center; gap:5px; font-size:12px; color:var(--muted); }
  .doc-legend-dot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
  .doc-legend-note { margin:2px 0 18px; font-size:12px; color:var(--muted); font-style:italic; }
  .doc-section { margin:32px 0 8px; font-size:19px; font-weight:800; scroll-margin-top:20px; }
  .doc-card { margin:0 0 8px; border-left-width:4px; }
  .doc-card > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:12px; padding:13px 16px; }
  .doc-card > summary::-webkit-details-marker { display:none; }
  .doc-card > summary::after { content:"›"; margin-left:auto; color:var(--muted); transition:transform .15s; font-size:18px; }
  .doc-card[open] > summary::after { transform:rotate(90deg); }
  .doc-idx { font-family:var(--font-mono); font-weight:700; font-size:12px; width:24px; height:24px; border-radius:6px;
    display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
  .doc-card-title { font-weight:700; font-size:15.5px; flex:1; }
  .doc-badge { font-size:10.5px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; padding:3px 8px; border-radius:5px; white-space:nowrap; }
  .doc-card-body { padding:0 16px 15px 52px; color:var(--muted); font-size:13.5px; }
  .doc-card-body ul { margin:0; padding-left:18px; }
  .doc-card-body li { margin-bottom:6px; }
  .doc-card-body li:last-child { margin-bottom:0; }
  .doc-card-body code { background:var(--panel3); color:var(--text); padding:1px 5px; border-radius:4px; font-size:.9em; font-family:var(--font-mono); }
  .doc-card-body strong { color:var(--text); }`;

function legend(groups) {
    const seen = new Map();
    for (const g of groups) if (!seen.has(g.cat)) seen.set(g.cat, CAT[g.cat]);
    const items = [...seen.values()].map((c) => `<span class="doc-legend-item"><span class="doc-legend-dot" style="background:var(${c.varName})"></span>${esc(c.label)}</span>`).join("");
    return `<div class="doc-legend"><span class="doc-legend-label">Bereiche:</span>${items}</div>`;
}

function card(group, index) {
    const c = CAT[group.cat];
    const badge = group.badge ? `<span class="doc-badge" style="color:var(${c.varName});background:color-mix(in srgb, var(${c.varName}) 16%, transparent)">${esc(group.badge)}</span>` : "";
    return `<details class="card doc-card" style="border-left-color:var(${c.varName})"${index === 0 ? " open" : ""}>
      <summary>
        <span class="doc-idx" style="color:var(${c.varName});background:color-mix(in srgb, var(${c.varName}) 18%, transparent)">${String(index + 1).padStart(2, "0")}</span>
        <span class="doc-card-title">${esc(group.title)}</span>
        ${badge}
      </summary>
      <div class="doc-card-body"><ul>${group.items.map((i) => `<li>${i}</li>`).join("")}</ul></div>
    </details>`;
}

function section(id, title, groups) {
    return `<h2 class="doc-section" id="${id}">${esc(title)}</h2>
    ${legend(groups)}
    ${groups.map(card).join("")}`;
}

function renderDocsBody(user) {
    return `<header class="doc-head">
      <div class="doc-brand">Event<span style="color:var(--accent)">Helper</span> Dokumentation</div>
      <p class="doc-sub">Discord-Befehle für Raider und die Bereiche im Web-Admin — was jeder Befehl und jede Seite tut.</p>
      <div class="doc-tabs">
        <a class="doc-tab" href="#discord">Discord</a>
        <a class="doc-tab" href="#web-admin">Web-Admin</a>
        <a class="doc-tab" href="/" style="margin-left:auto">${user && user.name ? "Zum Gildenmenü" : "Mit Discord anmelden"}</a>
      </div>
    </header>
    ${section("discord", "Discord-Befehle & Abläufe", DISCORD_GROUPS)}
    ${section("web-admin", "Web-Admin-Bereiche", WEB_GROUPS)}
    <p class="doc-legend-note">Farbe = Bereich in der App, so siehst du auf einen Blick, was zusammengehört und wo du nachschauen musst.</p>`;
}

/** Header actions row: login state + theme toggle, same vocabulary as the public report pages. */
function renderDocsPage(user) {
    const body = `<div class="wrap">
    <div class="pubbar" style="margin-bottom:0">
      <div style="margin-left:auto" class="pubbar-actions">${authBar(user)}${themeToggleBtn()}</div>
    </div>
    ${renderDocsBody(user)}
    <footer>EventHelper · Dokumentation</footer>
    </div>`;
    return layout("Dokumentation · EventHelper", body, { bare: true, extraStyle: DOCS_STYLE });
}

module.exports = { renderDocsPage, DISCORD_GROUPS, WEB_GROUPS, CAT };
