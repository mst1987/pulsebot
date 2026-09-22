// Draws the bot's flat UI icons (leader, date, time, the signup statuses, …) and
// rasterises them into the PNGs that are uploaded as application emojis
// `eh_ui_<name>` (src/web/appEmojis.js, UI_ICONS).
//
//   node scripts/render-ui-emojis.js     writes assets/emojis/eh_ui_<name>.png
//
// Raid-Helper's look: thin, single-colour line icons in a light grey that reads
// on Discord's dark and light theme — no colourful unicode emojis. The PNGs are
// checked in; the bot never rasterises anything at runtime, so @resvg/resvg-js
// is only a devDependency. Change an icon here, re-run, commit the PNG — and
// note that the bot never replaces an existing emoji: give a redrawn icon to
// the application by deleting the old one in the developer portal first.
const fs = require("fs");
const path = require("path");
const { UI_ICONS, uiIconFile } = require("../src/web/appEmojis");

const SIZE = 128;
const COLOR = "#B9BBBE";
const STROKE = 2.4;
// Every icon shares COLOR except these two — a raider's own confirmation
// reads at a glance, like the green/red of the Confirm/Cancel buttons.
const COLOR_OVERRIDES = { confirmed: "#3BA55D", declined: "#ED4245" };

// 24 × 24 line drawings (stroke only, unless an element says otherwise).
const ICONS = {
    // a crown
    leader: '<path d="M4 18.5 3 7l5.5 4.5L12 5l3.5 6.5L21 7l-1 11.5Z"/><path d="M4.5 21h15"/>',
    // two people
    signups: '<circle cx="9" cy="8" r="3.3"/><path d="M2.8 20.5c0-3.5 2.7-6 6.2-6s6.2 2.5 6.2 6"/><circle cx="17" cy="8.8" r="2.6"/><path d="M16.8 14.6c2.7.3 4.5 2.4 4.5 5.9"/>',
    // a calendar sheet
    date: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.1" fill="COLOR" stroke="none"/><circle cx="12" cy="14.5" r="1.1" fill="COLOR" stroke="none"/><circle cx="15.5" cy="14.5" r="1.1" fill="COLOR" stroke="none"/>',
    // a clock
    time: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5.2l3.3 2"/>',
    // a stopwatch — the deadline
    deadline: '<circle cx="12" cy="13.5" r="7.8"/><path d="M12 13.5V9.3M9.5 2.8h5M12 2.8v2.9M18.3 6.4l1.6-1.6"/>',
    // an hourglass — the countdown to the start
    start: '<path d="M6.5 3h11M6.5 21h11"/><path d="M8 3v2.6c0 2.6 4 4 4 6.4 0-2.4 4-3.8 4-6.4V3M8 21v-2.6c0-2.6 4-4 4-6.4 0 2.4 4 3.8 4 6.4V21"/>',
    // a tick
    signed: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    // a clock with a forward arrow — later
    late: '<path d="M20.6 12A8.6 8.6 0 1 1 17.9 5.8"/><path d="M21 2.8V7.6h-4.8"/><path d="M12 7.6v4.8l3 1.8"/>',
    // a question mark
    tentative: '<path d="M8.6 8.6a3.5 3.5 0 1 1 4.9 3.2c-.9.4-1.5 1.2-1.5 2.2V15"/><circle cx="12" cy="19" r="1.3" fill="COLOR" stroke="none"/>',
    // a bench
    bench: '<rect x="4.5" y="4" width="15" height="5.5" rx="1"/><path d="M3 14h18M5.5 14v6.5M18.5 14v6.5M7 9.5V14M17 9.5V14"/>',
    // a cross
    absence: '<path d="M6 6l12 12M18 6 6 18"/>',
    // a padlock — the signup is closed
    closed: '<rect x="5" y="10.5" width="14" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    // a tick, in green (COLOR_OVERRIDES) — a raider confirmed their setup placement
    confirmed: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    // a cross, in red (COLOR_OVERRIDES) — a raider cancelled their setup placement
    declined: '<path d="M6 6l12 12M18 6 6 18"/>',
    // nothing at all — an emoji-sized blank, so an unanswered raider's line
    // still starts exactly where confirmed/declined does
    pending: "",
    // a shield — pick a class
    class: '<path d="M12 3 19.5 6v5.6c0 4.8-3.2 8-7.5 9.4-4.3-1.4-7.5-4.6-7.5-9.4V6Z"/>',
    // The four roles of the role totals and the Tank block (#303) — flat stand-ins for the WoW role icons.
    // a shield with a boss (rivet) in the middle — tank
    tank: '<path d="M12 3 19.5 6v5.6c0 4.8-3.2 8-7.5 9.4-4.3-1.4-7.5-4.6-7.5-9.4V6Z"/><circle cx="12" cy="11.5" r="2.3"/>',
    // a heart — healer (a plain "+" read as a first-aid cross, not healing)
    healer: '<path d="M12 20.5C7.5 17 4 13.4 4 9.8 4 7 6.1 5 8.6 5c1.4 0 2.7.7 3.4 1.9C12.7 5.7 14 5 15.4 5 17.9 5 20 7 20 9.8c0 3.6-3.5 7.2-8 10.7Z"/>',
    // a sword — melee
    melee: '<path d="M14.5 17.5 3.5 6.5v-3h3l11 11"/><path d="M13 19.5l6.5-6.5M16.2 16.2l4.3 4.3M19 21.5l2.5-2.5"/>',
    // two crossed swords — melee since the single sword read as "!" (appEmojis ROLE_ICONS)
    swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6M16 16l4 4M19 21l2-2"/>'
        + '<path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4M7 17l-3 3M3 19l2 2"/>',
    // an arrow, fletched and pointed — ranged (a target read as generic, not
    // WoW-like; a full bow-and-arrow read as a lens at emoji size)
    ranged: '<path d="M5 19 18 6"/><path d="M12.5 6h5.5v5.5"/><path d="M5 19l3.5-1M5 19l1 3.5"/>',
    // a loudspeaker with two waves — the raid's voice channel (#305)
    voice: '<path d="M4 9.2h3.3L12.6 4.6v14.8L7.3 14.8H4Z"/><path d="M16.2 9.1a4.2 4.2 0 0 1 0 5.8M19 6.3a8.2 8.2 0 0 1 0 11.4"/>',
    // an arrow running into a wall — the raid's end (#305); a second clock
    // would be indistinguishable from `time` at 32 px.
    end: '<path d="M3.5 12h11"/><path d="M10.5 7.5 15 12l-4.5 4.5"/><path d="M19.5 4.5v15"/>',
};

/** The SVG source of one icon. */
function svgFor(name) {
    const body = ICONS[name];
    if (body === undefined) throw new Error(`Kein Icon gezeichnet: ${name}`);
    const color = COLOR_OVERRIDES[name] || COLOR;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${color}" `
        + `stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${body.replace(/COLOR/g, color)}</svg>`;
}

function main() {
    const { Resvg } = require("@resvg/resvg-js");
    for (const name of UI_ICONS) {
        const png = new Resvg(svgFor(name), { fitTo: { mode: "width", value: SIZE } }).render().asPng();
        const file = uiIconFile(name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, png);
        console.log(`${path.relative(process.cwd(), file)} (${png.length} Bytes)`);
    }
}

if (require.main === module) main();

module.exports = { ICONS, svgFor, COLOR, SIZE };
