// Guards for the Kanäle page (design issue #216). The client is TSX without a
// React test renderer, so these are source scans of the invariants that break
// silently; the purpose resolution itself is tested in test/web/channelPurposes.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "ChannelsPage.tsx");
const dialogs = read("components", "channels", "ChannelDialogs.tsx");
const bits = read("components", "channels", "channelBits.tsx");
const lib = read("lib", "channels.ts");
const api = read("api.ts");
const css = read("styles", "kanaele.css");
const server = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "channelPurposes.js"), "utf8");

/** The source of one exported function component, up to the next top-level export. */
function component(src, name) {
    const start = src.indexOf(`export function ${name}(`);
    if (start < 0) throw new Error(`${name} not found`);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next < 0 ? undefined : next);
}

describe("ChannelsPage", () => {
    it("is built from the shared building blocks, not the old stacked forms", () => {
        expect(page).toMatch(/<PageHead[\s\S]*icon="inv_letter_15"/);
        expect(page).toContain("<PartHead");
        expect(page).toContain("<Expand");
        expect(page).not.toContain("card-form");
        expect(page).not.toContain("Wird erstellt…");
        expect(page).not.toMatch(/<h1 className="page-title"/);
    });

    it("keeps its styles in its own stylesheet", () => {
        expect(page).toContain("import \"../styles/kanaele.css\";");
        // everything in it is namespaced, apart from the two badge variants it adds
        const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^@\s}][^{]*\{/gm) || [];
        for (const sel of selectors) {
            expect(sel).toMatch(/\.kn-|\.badge\.(area|dashed)|a\.ibtn/);
        }
    });

    it("shows every purpose with its status and lets a settings writer open the assign dialog", () => {
        expect(page).toContain("data.purposes.map");
        expect(page).toContain("<StatusBadge status={p.status} />");
        expect(page).toMatch(/canAccess\(user, "settings", "write"\)/);
        expect(page).toMatch(/onEdit\(p\)/);
        expect(page).toMatch(/kind: "purpose"[\s\S]*<PurposeDialog/);
        // without settings write access, the pencil leads to Einstellungen instead
        expect(page).toMatch(/to=\{`\/settings\?section=\$\{encodeURIComponent\(p\.section\)\}`\}/);
    });

    it("says 'fehlt' for a purpose nobody set — decided on the server", () => {
        expect(server).toMatch(/label: "fehlt"/);
        expect(page).toContain("nicht gesetzt");
    });

    it("opens the duplicate dialog from a row, with the source fixed", () => {
        expect(page).toMatch(/onDuplicate\(c\)/);
        const dup = component(dialogs, "DuplicateChannelDialog");
        expect(dup).toContain("channelId: source.id");
        // no channel picker any more: the source comes from the row
        expect(dup).not.toContain("<select");
        expect(dup).toContain("Zweck nicht");
        expect(dup).not.toContain("className=\"hint\"");
    });

    it("stores purposes as settings, under the config key the server names", () => {
        expect(api).toMatch(/export function saveChannelPurpose[\s\S]*send\("PATCH", "\/api\/settings"/);
        expect(api).toContain("purpose.key === \"raidDefaults.channelId\"");
        expect(server).toContain("key: \"raidDefaults.channelId\"");
    });

    it("keeps ids of other servers when a multi-channel purpose is saved", () => {
        const dlg = component(dialogs, "PurposeDialog");
        expect(dlg).toContain("purpose.items.filter((i) => !i.found)");
        expect(dlg).toContain("Nicht auf diesem Server");
    });

    it("judges bot rights in the pickers with the server's words", () => {
        for (const label of ["Bot sieht den Kanal nicht", "Bot darf nicht schreiben", "Bot liest mit", "Bot schreibt"]) {
            expect(lib).toContain(`label: "${label}"`);
            expect(server).toContain(`label: "${label}"`);
        }
    });

    it("uses WoW icons for purposes and line icons only for UI actions", () => {
        for (const icon of ["inv_misc_note_02", "inv_misc_pocketwatch_01", "inv_misc_grouplooking", "inv_misc_coin_01", "achievement_boss_illidan"]) {
            expect(server).toContain(`icon: "${icon}"`);
        }
        expect(page).toMatch(/icon=\{<TagIcon \/>\} tip="Zweck zuordnen"/);
        expect(page).toMatch(/icon=\{<CopyIcon \/>\} tip="Duplizieren"/);
        // no native title on a DOM element (the <Modal title> prop is its heading)
        expect(bits + page + dialogs).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\btitle=/);
    });
});
