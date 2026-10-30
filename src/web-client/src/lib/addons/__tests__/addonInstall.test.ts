// The release notes of an addon (lib/addons/addonInstall.ts): GitHub's generated
// block cut off, plain text for the card, a small safe structure for the
// detail page /addon/<id> — text, bold and code only, never HTML, never a link.
import { describe, expect, it } from "vitest";
import { groupKind, noteGroups, noteSpans, ownNotes, plainNotes } from "../addonInstall";

const LEVELHELPER_060 = [
    "## Neu",
    "- **Totenkopf am Zielknopf:** Der Zielknopf markiert Gegner jetzt mit Totenkopf.",
    "- **Kills mit Erholt:** Die Anzeige rechnet mit deinem Erholt-Bonus,",
    "  der Tooltip nennt beide Zahlen.",
    "",
    "## Verbessert",
    "* Buff-Leiste startet neben der Ansichtsleiste. Nach dem Update reicht `/reload`.",
    "",
    "### Behoben",
    "- Munition wurde doppelt gezählt.",
    "",
    "## What's Changed",
    "* Add skull marker by @mst1987 in https://github.com/mst1987/levelhelper/pull/70",
    "",
    "## New Contributors",
    "* @someone made their first contribution",
    "",
    "**Full Changelog**: https://github.com/mst1987/levelhelper/compare/v0.5.1...v0.6.0",
].join("\r\n");

describe("ownNotes", () => {
    it("cuts GitHub's What's Changed block with everything below it", () => {
        const own = ownNotes(LEVELHELPER_060);
        expect(own).toContain("## Behoben");
        expect(own).not.toMatch(/What's Changed|New Contributors|Full Changelog|@mst1987/);
        expect(own).not.toContain("\r");
    });

    it("drops a Full Changelog line on its own, and knows the typographic apostrophe", () => {
        expect(ownNotes("- eins\n\n**Full Changelog**: https://github.com/a/b/compare/v1...v2")).toBe("- eins");
        expect(ownNotes("Full Changelog: x")).toBe("");
        expect(ownNotes("- eins\n### What’s changed\n- PR")).toBe("- eins");
        expect(ownNotes("")).toBe("");
    });
});

describe("plainNotes", () => {
    it("turns Markdown notes into plain text", () => {
        expect(plainNotes("## Neu\r\n\r\n\r\n* **fett** und `code`\n- [Link](https://x.y)")).toBe("Neu\n\n• fett und code\n• Link");
        expect(plainNotes("<script>x</script>")).toBe("<script>x</script>");
        expect(plainNotes("")).toBe("");
    });

    it("leaves the generated block out", () => {
        const text = plainNotes(LEVELHELPER_060);
        expect(text).toContain("• Munition wurde doppelt gezählt.");
        expect(text).not.toMatch(/What's Changed|Full Changelog/);
    });
});

describe("groupKind", () => {
    it("knows Neu, Verbessert and Behoben in German and English, anything else is other", () => {
        expect(groupKind("Neu")).toBe("new");
        expect(groupKind("New")).toBe("new");
        expect(groupKind("Verbessert")).toBe("better");
        expect(groupKind("Improvements")).toBe("better");
        expect(groupKind("Behoben")).toBe("fixed");
        expect(groupKind("Bug fixes")).toBe("fixed");
        expect(groupKind("✨ Neu:")).toBe("new");
        expect(groupKind("Hinweise")).toBe("other");
    });
});

describe("noteSpans", () => {
    it("marks bold and code, keeps the text of a link and nothing of its target", () => {
        expect(noteSpans("**Fett:** dann `/reload` und [Doku](https://x.y) <https://a.b>")).toEqual([
            { kind: "bold", text: "Fett:" },
            { kind: "text", text: " dann " },
            { kind: "code", text: "/reload" },
            { kind: "text", text: " und Doku https://a.b" },
        ]);
        expect(noteSpans("__auch__ fett")).toEqual([{ kind: "bold", text: "auch" }, { kind: "text", text: " fett" }]);
    });

    it("keeps italic as plain text without its stars", () => {
        expect(noteSpans("unter *Einstellungen* und **fett**")).toEqual([
            { kind: "text", text: "unter Einstellungen und " },
            { kind: "bold", text: "fett" },
        ]);
    });

    it("never turns markup into anything but text", () => {
        expect(noteSpans("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
    });
});

describe("noteGroups", () => {
    it("makes one group per heading, with its lists and wrapped items", () => {
        const groups = noteGroups(LEVELHELPER_060);
        expect(groups.map((g) => [g.title, g.kind])).toEqual([["Neu", "new"], ["Verbessert", "better"], ["Behoben", "fixed"]]);
        const neu = groups[0].blocks[0];
        expect(neu.type).toBe("list");
        if (neu.type !== "list") return;
        expect(neu.items).toHaveLength(2);
        expect(neu.items[0][0]).toEqual({ kind: "bold", text: "Totenkopf am Zielknopf:" });
        // the indented line continues the second item
        expect(neu.items[1].map((s) => s.text).join("")).toBe("Kills mit Erholt: Die Anzeige rechnet mit deinem Erholt-Bonus, der Tooltip nennt beide Zahlen.");
    });

    it("keeps text before the first heading as a group without a title, paragraphs as paragraphs", () => {
        const groups = noteGroups("Kleines Update.\nZweite Zeile.\n\n## Hinweise\n- eins\n## Leer\n");
        expect(groups.map((g) => [g.title, g.kind])).toEqual([["", "other"], ["Hinweise", "other"]]);
        expect(groups[0].blocks).toEqual([{ type: "para", spans: [{ kind: "text", text: "Kleines Update. Zweite Zeile." }] }]);
    });

    it("reads a quote as its plain text", () => {
        expect(noteGroups("> Die exe ist nicht signiert.\n> Windows fragt nach.")).toEqual([
            { title: "", kind: "other", blocks: [{ type: "para", spans: [{ kind: "text", text: "Die exe ist nicht signiert. Windows fragt nach." }] }] },
        ]);
    });

    it("answers nothing for notes that are only GitHub's block", () => {
        expect(noteGroups("## What's Changed\n* x\n\n**Full Changelog**: y")).toEqual([]);
        expect(noteGroups("")).toEqual([]);
    });
});
