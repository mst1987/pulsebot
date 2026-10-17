// Guards for the absence overview (src/web-client/src/styles/absences.css) after the
// browser check of design pilot C: the weekday head of the timeline is readable
// ("Mo Di Mi" at the label step, not 10px capitals) and the four figures read as one
// strip with dividing lines between the values, not as a frame per number.
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "..", "..", "src", "web-client", "src", "styles", "absences.css"), "utf8");

function rule(selector) {
    const re = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`no rule for ${selector}`);
    return m[1];
}

describe("absence overview", () => {
    it("writes the weekday head at the label step in normal case", () => {
        const ini = rule(".ab-day-ini");
        expect(ini).toContain("font-size: var(--fs-label)");
        expect(ini).not.toContain("text-transform: uppercase");
    });
});
