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
    // a shield — pick a class
    class: '<path d="M12 3 19.5 6v5.6c0 4.8-3.2 8-7.5 9.4-4.3-1.4-7.5-4.6-7.5-9.4V6Z"/>',
    // The four roles of the role totals and the Tank block (#303) — flat stand-ins for the WoW role icons.
    // a shield with a cross band — tank
    tank: '<path d="M12 3 19.5 6v5.6c0 4.8-3.2 8-7.5 9.4-4.3-1.4-7.5-4.6-7.5-9.4V6Z"/><path d="M12 3v18M4.5 10.5h15"/>',
    // a plus — healer
    healer: '<path d="M9 3.5h6V9h5.5v6H15v5.5H9V15H3.5V9H9Z"/>',
    // a sword — melee
    melee: '<path d="M14.5 17.5 3.5 6.5v-3h3l11 11"/><path d="M13 19.5l6.5-6.5M16.2 16.2l4.3 4.3M19 21.5l2.5-2.5"/>',
    // a target — ranged
    ranged: '<circle cx="12" cy="12" r="8.3"/><circle cx="12" cy="12" r="3.3"/><path d="M12 1.8v4.6M12 17.6v4.6M1.8 12h4.6M17.6 12h4.6"/>',
};

/** The SVG source of one icon. */
function svgFor(name) {
    const body = ICONS[name];
    if (!body) throw new Error(`Kein Icon gezeichnet: ${name}`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="${COLOR}" `
        + `stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${body.replace(/COLOR/g, COLOR)}</svg>`;
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
