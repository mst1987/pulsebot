// The melee icon of the event message as two crossed swords — the single
// upright sword read as an exclamation mark at emoji size.
//
//   node scripts/render-role-swords.js     writes assets/emojis/eh_r<style>_swords.png
//
// Built from the styled role tile itself (assets/emojis/eh_r<style>_melee.png:
// frame, textured ground, one upright sword), so frame and ground stay exactly
// those of the other role tiles:
//   1. a luminance mask finds the sword — bright on the dark styles, dark on
//      parchment — inside a circle that keeps the frame out;
//   2. the ground 30 px to the left is painted over the sword, which removes it;
//   3. the sword, cut out by the mask, is drawn twice, turned by ±SPREAD°.
//
// A new name rather than a redrawn eh_r<style>_melee: the bot never replaces an
// application emoji that exists already (scripts/render-ui-emojis.js), so a new
// file under a new name is what reaches Discord on the next start. The flat
// `eh_ui_swords` is drawn in render-ui-emojis.js like every UI icon.
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "assets", "emojis");
// Per style: is the sword lighter than its ground?
const STYLES = { a: { light: true }, g: { light: true }, p: { light: false } };
const SPREAD = 38;
const SCALE = 0.86;
const SHIFT = 30;

/** The SVG of one crossed-swords tile, from the melee tile's PNG. */
function crossedSvg(png, size, { light }) {
    const href = `data:image/png;base64,${png.toString("base64")}`;
    const c = size / 2;
    const r = size * 0.4;
    // grey value, then a steep ramp: only the sword (much lighter or darker than the ground) survives
    const ramp = light ? "slope=\"6\" intercept=\"-1.9\"" : "slope=\"-5\" intercept=\"2.4\"";
    const img = (extra = "") => `<image width="${size}" height="${size}" xlink:href="${href}" ${extra}/>`;
    const turn = (deg) => `translate(${c} ${c}) rotate(${deg}) scale(${SCALE}) translate(${-c} ${-c})`;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
        + "<defs>"
        + `<clipPath id="inner"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath>`
        + "<filter id=\"find\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\" color-interpolation-filters=\"sRGB\">"
        + "<feColorMatrix type=\"matrix\" values=\"0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0.3 0.59 0.11 0 0  0 0 0 1 0\"/>"
        + `<feComponentTransfer><feFuncR type="linear" ${ramp}/><feFuncG type="linear" ${ramp}/><feFuncB type="linear" ${ramp}/></feComponentTransfer>`
        + "</filter>"
        + "<filter id=\"grow\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feMorphology operator=\"dilate\" radius=\"7\"/></filter>"
        + `<mask id="sword" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><g clip-path="url(#inner)">${img("filter=\"url(#find)\"")}</g></mask>`
        + `<mask id="swordWide" maskUnits="userSpaceOnUse" x="0" y="0" width="${size}" height="${size}"><g filter="url(#grow)"><g clip-path="url(#inner)">${img("filter=\"url(#find)\"")}</g></g></mask>`
        + "</defs>"
        + img()
        // 2. cover the upright sword with the ground beside it
        + `<g mask="url(#swordWide)">${img(`transform="translate(${SHIFT} 0)"`)}</g>`
        // 3. the sword twice, crossed
        + `<g transform="${turn(-SPREAD)}"><g mask="url(#sword)">${img()}</g></g>`
        + `<g transform="${turn(SPREAD)}"><g mask="url(#sword)">${img()}</g></g>`
        + "</svg>";
}

function main() {
    const { Resvg } = require("@resvg/resvg-js");
    for (const [style, opts] of Object.entries(STYLES)) {
        const png = fs.readFileSync(path.join(DIR, `eh_r${style}_melee.png`));
        const size = png.readUInt32BE(16);
        const out = new Resvg(crossedSvg(png, size, opts), { fitTo: { mode: "width", value: size } }).render().asPng();
        const file = path.join(DIR, `eh_r${style}_swords.png`);
        fs.writeFileSync(file, out);
        console.log(`${path.relative(process.cwd(), file)} (${out.length} Bytes)`);
    }
}

if (require.main === module) main();

module.exports = { crossedSvg, STYLES };
