// The colour of a game version (#742): the default tokens reach WCAG AA in both
// themes, a custom colour is brought there, and the root carries the version.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyVersionColors, contrast, derivePalette, inkOn, isHexColor, markVersion, MIN_CONTRAST } from "./versionColor";

const CSS = readFileSync(resolve(__dirname, "../../styles/tokens.css"), "utf8");

/** The text of one theme's block: dark is the first :root block, light the data-theme one (the media block repeats it). */
function block(selector: string): string {
    const start = CSS.indexOf(selector);
    const end = CSS.indexOf("\n}", start);
    return CSS.slice(start, end);
}

/** A hex token of a block: a plain `--name: #rrggbb` or the fallback of a `var(--x, #rrggbb)`. */
function token(text: string, name: string): string {
    const m = new RegExp(`${name}:\\s*(?:var\\(--[\\w-]+,\\s*)?(#[0-9a-fA-F]{6})`).exec(text);
    if (!m) throw new Error(`token ${name} not found`);
    return m[1];
}

const THEMES = {
    dark: block(":root {"),
    light: block(':root[data-theme="light"] {'),
};
const PANELS = ["--bg", "--panel", "--panel2", "--panel3"];
const VERSIONS = ["forever", "tbc", "classic"];

describe("version colours in tokens.css", () => {
    for (const [theme, text] of Object.entries(THEMES)) {
        for (const id of VERSIONS) {
            it(`${id} in the ${theme} theme reads as text on every panel and carries its ink`, () => {
                const color = token(text, `--ver-${id}`);
                const ink = token(text, `--ver-${id}-ink`);
                for (const panel of PANELS) {
                    expect(contrast(color, token(text, panel)), `${id} on ${panel}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
                }
                expect(contrast(color, ink), `${id} ink`).toBeGreaterThanOrEqual(MIN_CONTRAST);
            });
        }
    }

    it("the dark defaults are the colours the decision named (Forever azure, TBC fel green)", () => {
        expect(token(THEMES.dark, "--ver-forever")).toBe("#4da3ff");
        expect(token(THEMES.dark, "--ver-tbc")).toBe("#9bd45a");
    });

    it("the orga marking has its own teal in both themes, apart from any version colour", () => {
        expect(token(THEMES.dark, "--orga-teal")).toBe("#35d6c4");
        expect(token(THEMES.light, "--orga-teal")).toBe("#0f8f82");
        const orga = readFileSync(resolve(__dirname, "../../styles/orga-mark.css"), "utf8");
        expect(orga).toContain("--orga: var(--orga-teal)");
        expect(orga).not.toMatch(/--orga[\w-]*:[^;]*(--accent|--ver-)/);
        // the menu carries no orga mark since design C (the dot reported nothing new)
        expect(orga).not.toContain(".orga-dot");
    });

    it("keeps the one accent (Rost, design pilot C) whatever version is shown", () => {
        expect(token(THEMES.dark, "--accent")).toBe("#d4683c");
        expect(token(THEMES.light, "--accent")).toBe("#b84f26");
        expect(CSS).toMatch(/:root\[data-version="tbc"\] \{ --version-color: var\(--ver-tbc\);/);
        expect(CSS).not.toMatch(/--accent:\s*var\(--version-color\)/);
    });
});

describe("derivePalette", () => {
    it("brings any colour to AA in both themes with a readable ink", () => {
        for (const hex of ["#aa3377", "#ffff00", "#000000", "#ffffff", "#4da3ff", "#102030"]) {
            const p = derivePalette(hex);
            expect(contrast(p.dark, "#30353f"), `${hex} dark`).toBeGreaterThanOrEqual(MIN_CONTRAST);
            expect(contrast(p.light, "#e2e6ee"), `${hex} light`).toBeGreaterThanOrEqual(MIN_CONTRAST);
            expect(contrast(p.dark, p.inkDark)).toBeGreaterThanOrEqual(MIN_CONTRAST);
            expect(contrast(p.light, p.inkLight)).toBeGreaterThanOrEqual(MIN_CONTRAST);
        }
    });

    it("leaves a colour that already reads alone", () => {
        expect(derivePalette("#9bd45a").dark).toBe("#9bd45a");
    });

    it("picks the stronger ink and checks hex input", () => {
        expect(inkOn("#9bd45a")).toBe("#0b0f14");
        expect(inkOn("#1a65c4")).toBe("#ffffff");
        expect(isHexColor("#12abEF")).toBe(true);
        expect(isHexColor("12abef")).toBe(false);
    });
});

describe("applyVersionColors / markVersion", () => {
    it("writes a custom colour's four values and removes them again when it is back at the default", () => {
        const root = document.createElement("html");
        applyVersionColors(root, [{ id: "tbc", label: "TBC", short: "TBC", color: "#aa3377", custom: true }]);
        expect(root.style.getPropertyValue("--vc-tbc-dark")).toMatch(/^#[0-9a-f]{6}$/);
        expect(root.style.getPropertyValue("--vc-tbc-light")).toMatch(/^#[0-9a-f]{6}$/);
        expect(root.style.getPropertyValue("--vc-tbc-ink-dark")).not.toBe("");
        applyVersionColors(root, [{ id: "tbc", label: "TBC", short: "TBC", color: "#9bd45a", custom: false }]);
        expect(root.style.getPropertyValue("--vc-tbc-dark")).toBe("");
    });

    it("sets and clears the version on the root", () => {
        const root = document.createElement("html");
        markVersion(root, "forever");
        expect(root.getAttribute("data-version")).toBe("forever");
        markVersion(root, null);
        expect(root.hasAttribute("data-version")).toBe(false);
    });
});
