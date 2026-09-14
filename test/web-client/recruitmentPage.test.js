// Guards for the Recruitment page's design (issue #215): src/web-client/src/pages/
// RecruitmentPage.tsx, components/DiscordPreview.tsx, EmojiPicker.tsx and
// SpecPicker.tsx. The client is TSX without a React test renderer, so what is
// checked are the decisions that would quietly slide back.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "RecruitmentPage.tsx");
const preview = read("components", "DiscordPreview.tsx");
const emojiPicker = read("components", "EmojiPicker.tsx");
const specPicker = read("components", "SpecPicker.tsx");

describe("Recruitment page", () => {
    it("heads the page with the shared PageHead and one primary action", () => {
        expect(page).toMatch(/<PageHead\s+icon=\{ICONS\.page\} tone="recruitment"/);
        expect(page).toContain('page: "inv_misc_grouplooking"');
        expect(page).toContain('post: "ability_warrior_battleshout"');
        expect(page).toMatch(/action=\{<Button icon=\{ICONS\.post\} onClick=\{\(\) => openPostDialog\(\)\}>Nachricht posten<\/Button>\}/);
        expect(page).not.toContain('className="page-title"');
    });

    it("gives every tab its WoW icon and a part head", () => {
        for (const icon of ["inv_letter_15", "inv_scroll_03", "inv_misc_note_01"]) expect(page).toContain(`"${icon}"`);
        expect((page.match(/<PartHead\b/g) || []).length).toBe(3);
    });

    it("keeps explanations in tooltips, not in paragraphs under the heads and fields", () => {
        expect(page).not.toMatch(/className="note"/);
        expect(page).not.toMatch(/className="hint"/);
        expect(specPicker).not.toMatch(/className="hint"/);
    });

    it("has no preview column cutting the raw text any more", () => {
        expect(page).not.toContain("textPreview(");
        expect(page).toContain("<WantedIcons content={p.content} data={data} />");
        expect(page).toContain("<WantedIcons content={t.content} data={data} />");
    });

    it("shows the source as a badge instead of web/scan in plain text", () => {
        expect(page).toMatch(/<Badge icon=\{ICONS\.scan\}>Gefunden<\/Badge>/);
        expect(page).toMatch(/<Badge tone="accent" icon=\{ICONS\.post\}>Gepostet<\/Badge>/);
    });

    it("scans the server as a job toast, not as a line of text", () => {
        expect(page).toMatch(/await run\(\s*\{ label: "Server durchsuchen", icon: ICONS\.scan/);
    });

    it("draws one row per application with its details in a modal", () => {
        expect(page).not.toContain('className="applist"');
        expect(page).toContain("<ApplicationDetails app={opened} onClose={() => setOpenId(\"\")} />");
        expect(page).toMatch(/<Expand open=\{openId === a\.threadId\}/);
        expect(page).toContain("{...classColorProps(a.classColor)}");
    });

    it("styles itself in its own stylesheet", () => {
        expect(page).toContain('import "../styles/recruitment.css";');
        const css = read("styles", "recruitment.css");
        expect(css).toContain(".rc-editor");
        // light and dark for the Discord preview
        expect(css).toContain(':root[data-theme="light"] .rc-page');
        expect(read("index.css")).not.toContain(".applist");
    });
});

describe("editor pieces", () => {
    it("labels the emoji picker with a WoW icon instead of an emoji", () => {
        expect(emojiPicker).not.toMatch(/😀/);
        expect(emojiPicker).toMatch(/icon="inv_misc_head_murloc_01"/);
        expect(emojiPicker).toContain("Server-Emoji");
    });

    it("renders the preview from the shared markdown parser and the server's emojis", () => {
        expect(preview).toContain("parseDiscordMarkdown(content)");
        expect(preview).toContain("emojis.find((e) => e.id === token.id)");
        // an emoji the server does not have falls back to its name, as in Discord
        expect(preview).toContain(":{t.name}:");
        // the default button label matches the one the bot posts
        expect(preview).toContain('buttonLabel.trim() || "Jetzt bewerben"');
        expect(read("..", "..", "web", "discord.js")).toContain('template.buttonLabel || "Jetzt bewerben"');
    });

    it("counts against Discord's message limit", () => {
        expect(page).toContain("{content.length} / {DISCORD_CONTENT_LIMIT}");
    });
});
