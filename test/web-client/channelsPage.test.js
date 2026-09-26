// Guards for the Kanäle page (design issue #216, Discord overview #259). The
// client is TSX without a React test renderer, so these are source scans of the
// invariants that break silently; the server logic is tested in
// test/web/channel*.test.js and the naming rules in test/utils/channelNames.test.js.
const fs = require("fs");
const path = require("path");

const CLIENT = path.join(__dirname, "..", "..", "src", "web-client", "src");
const read = (...parts) => fs.readFileSync(path.join(CLIENT, ...parts), "utf8");

const page = read("pages", "ChannelsPage.tsx");
const dialogs = read("components", "channels", "ChannelDialogs.tsx");
const bits = read("components", "channels", "channelBits.tsx");
const tree = read("components", "channels", "ChannelTree.tsx");
const bulk = read("components", "channels", "ChannelBulk.tsx");
const edit = read("components", "channels", "ChannelEditDialog.tsx");
const quick = read("components", "channels", "QuickCreateDialog.tsx");
const archive = read("components", "channels", "ArchiveTab.tsx");
const purposes = read("components", "channels", "PurposeList.tsx");
const lib = read("lib", "channels.ts");
const api = read("api", "channels.ts");
const css = read("styles", "kanaele.css");
const dashboard = read("pages", "DashboardPage.tsx");
const server = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "channelPurposes.js"), "utf8");
const routes = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "apiRoutes", "channels.js"), "utf8");

const ALL = [page, dialogs, bits, tree, bulk, edit, quick, archive, purposes].join("\n");

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
        expect(page).toContain("<Segment");
        expect(page).toContain("<SplitButton");
        expect(page).not.toContain("card-form");
        expect(page).not.toMatch(/<h1 className="page-title"/);
        expect(page).toContain("<RaidLoader");
    });

    it("keeps its styles in its own stylesheet", () => {
        expect(page).toContain("import \"../styles/kanaele.css\";");
        // everything in it is namespaced, apart from the badge variants it adds
        const selectors = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^[^@\s}][^{]*\{/gm) || [];
        for (const sel of selectors) {
            expect(sel).toMatch(/\.kn-|\.badge\.(area|dashed)|a\.ibtn|button\.kn-/);
        }
    });

    it("is one list: the tree, and a side panel with three big figures", () => {
        expect(page).toContain("<ChannelTree");
        expect(page.match(/<Figure\b/g)).toHaveLength(3);
        for (const label of ["Kanäle", "Vergangene Events", "Im Archiv, warten auf Löschung"]) {
            expect(page).toContain(`label="${label}"`);
        }
        // the purposes are no longer a block on the page, but a dialog and the tooltip
        expect(page).not.toContain("<PurposeList");
        expect(page).toContain("<PurposesDialog");
        expect(lib).toMatch(/Zweck: \$\{purposes\.join/);
    });

    it("puts everything but name and status into the channel's tooltip", () => {
        expect(tree).toMatch(/data-tip=\{tip\.head\}[\s\S]*data-tip-sub=\{tip\.sub\}/);
        expect(tree).toContain("channelTip(c, data)");
        for (const part of ["Thema: ", "Slowmode ", "Rechte von der Kategorie.", "Event"]) expect(lib).toContain(part);
        // status only as badges
        expect(tree).toMatch(/<Badge tone="mid"[^>]*>vergangen<\/Badge>/);
        expect(tree).toMatch(/<Badge tone="ok"[^>]*>Event<\/Badge>/);
    });

    it("renames inline: double click or pencil, Enter saves, Esc discards, Discord rules while typing", () => {
        expect(tree).toContain("onDoubleClick");
        expect(tree).toMatch(/icon=\{<PencilIcon \/>\} tip="Umbenennen"/);
        expect(tree).toMatch(/e\.key === "Enter"[\s\S]*onSave\(name\)/);
        expect(tree).toMatch(/e\.key === "Escape"[\s\S]*onCancel\(\)/);
        expect(tree).toContain("normalizeForType(e.target.value, channel.type, false)");
        expect(tree).toContain("Enter speichert · Esc verwirft");
    });

    it("selects per channel and per category, and folds categories", () => {
        expect(tree).toContain("indeterminate");
        expect(tree).toMatch(/label=\{`Alle in \$\{g\.name\} wählen`\}/);
        expect(tree).toContain("aria-expanded={open}");
        // the archive is its own tab, not a category of the tree
        expect(tree).toMatch(/c\.parentId !== archiveId/);
        // selecting a whole category also selects the threads nested under its channels (#361)
        expect(tree).toContain("g.visible.flatMap((c) => [c.id, ...c.threads.map((t) => t.id)])");
    });

    it("shows the bulk bar only with a selection, with the four actions of the design", () => {
        const bar = component(bulk, "BulkBar");
        expect(bar).toContain("if (!count) return null;");
        expect(bar).toContain("{count} ausgewählt");
        for (const label of ["Kategorie …", "Thema …", "Umbenennen nach Schema …", "Archivieren"]) expect(bar).toContain(label);
        expect(css).toMatch(/\.kn-bulk \{[\s\S]*position: fixed/);
        // left: 50% leaves the fixed bar half the viewport: without max-content its buttons wrap onto two lines.
        expect(css).toMatch(/\.kn-bulk \{[^}]*width: max-content/);
    });

    it("keeps the side panel to figures and one purposes panel — no loose sentence, no duplicate archive gear", () => {
        expect(page).toContain("className=\"kn-figures kn-purposes\"");
        expect(page).not.toContain("kn-side-note");
        expect(page).not.toContain("SettingsIcon");
    });

    it("applies only changed fields in the bulk edit, 'unverändert' by default", () => {
        const dlg = component(bulk, "BulkEditDialog");
        expect(dlg).toContain("useState(KEEP)");
        expect(dlg).toContain("<option value={KEEP}>unverändert</option>");
        expect(dlg).toContain("bulkChanges({ parentId, topic, clearTopic, slowmode })");
        expect(lib).toMatch(/if \(form\.parentId !== KEEP\) changes\.parentId/);
        expect(lib).toMatch(/if \(form\.slowmode !== KEEP\) changes\.rateLimitPerUser/);
        expect(edit).toContain("changedFields(channel, data,");
    });

    it("sends bulk changes channel by channel with a pause, progress in the job toast", () => {
        expect(lib).toMatch(/export const STEP_PAUSE_MS = \d+/);
        expect(lib).toMatch(/for \(let i = 0; i < ids\.length; i\+\+\)[\s\S]*setTimeout\(r, pauseMs\)/);
        expect(page).toMatch(/runInSteps\(ids, step,[\s\S]*update\(\{ progress: n \/ total/);
        expect(page).toContain("useJobs()");
        expect(page).toMatch(/if \(failed\) throw new Error\(message\)/);
    });

    it("previews rename-by-schema and quick-create on the server, marking existing names", () => {
        expect(bulk).toContain("renamePreview({ ids, schema, raid })");
        expect(quick).toContain("quickCreateChannels({ ...input, dryRun: true })");
        expect(quick).toMatch(/p\.exists && <Badge tone="mid"[^>]*>existiert<\/Badge>/);
        expect(quick).toContain("× wöchentlich");
        expect(quick).toMatch(/\{ value: "once", label: "Einzeln" \}, \{ value: "weekly", label: "Serie" \}/);
        expect(quick).toContain("Schema &amp; Vorlage");
    });

    it("offers \"gleich Event anlegen\" calmly: a switch, a time only when on, the template as one badge", () => {
        expect(quick).toContain("label=\"Gleich Event anlegen\"");
        // only for whoever may create raids, and only with a category
        expect(quick).toContain("const eventsPossible = !!data.canCreateEvents && !!categoryId;");
        expect(quick).toMatch(/\{eventOn && \([\s\S]*type="time"[\s\S]*<Badge[\s\S]*tipSub=/);
        expect(quick).toContain("...(eventOn ? { withEvent: true, time } : {})");
        expect(api).toMatch(/withEvent\?: boolean;\s*time\?: string;/);
        // the server gates it on raids write and creates through eventCreate
        expect(routes).toContain("userCanAny(user, [\"raids\"], \"write\")");
        expect(routes).toContain("eventCreate.createEvent({");
        expect(page).toContain("\"Kanäle und Events anlegen\"");
    });

    it("deletes from the archive tab and from the channel list, always with the name typed", () => {
        expect(archive).toContain("TrashIcon");
        const del = component(archive, "DeleteChannelsDialog");
        expect(del).toContain("const expected = single ? names[0] : BULK_DELETE_WORD;");
        expect(del).toContain("disabled={!matches}");
        expect(lib).toContain("export const BULK_DELETE_WORD = \"LÖSCHEN\";");
        expect(routes).toContain("const BULK_DELETE_WORD = \"LÖSCHEN\";");
        // the channel list: a trash icon per row and "Löschen …" in the bulk bar, both through the same dialog
        expect(tree).toMatch(/tone="danger" icon=\{<TrashIcon \/>\} tip="Löschen"[^>]*onClick=\{\(\) => onDelete\(c\)\}/);
        expect(bulk).toContain("{onDelete && <Button size=\"sm\" variant=\"danger\" onClick={onDelete}>Löschen …</Button>}");
        expect(page).toContain("onDelete={(channel) => setDialog({ kind: \"delete\", ids: [channel.id], anywhere: true })}");
        expect(page).toContain("deleteChannels(ids, confirm, anywhere)");
        expect(api).toContain("anywhere ? { ids, confirm, anywhere: true } : { ids, confirm }");
        // an upcoming event's channel is named before the name is typed
        expect(page).toContain("warnings={dialog.anywhere ? deleteWarnings(dialog.ids, data) : []}");
        expect(lib).toMatch(/export function deleteWarnings[\s\S]*ev\.status === "past"\) continue;[\s\S]*Anmelde-Nachricht geht mit verloren/);
    });

    it("asks before archiving and leads to the archive settings when there is no archive", () => {
        expect(page).toMatch(/if \(!data\.archive\.categoryId\) \{\s*setDialog\(\{ kind: "archive-settings", then: ids \}\)/);
        expect(page).toMatch(/askArchive[\s\S]*Gelöscht wird nichts/);
        expect(archive).toContain("+ neue Kategorie anlegen");
    });

    it("reminds of waiting channels on the page, never deletes by itself", () => {
        expect(page).toContain("{data.archive.count} warten auf Löschung");
        expect(page).toMatch(/tone=\{data\.archive\.overdue \? "mid" : undefined\}/);
        expect(archive).toContain("Gelöscht wird nie automatisch");
        expect(read("api", "dashboard.ts")).toContain("\"inbox\" | \"channels\"");
        // the dashboard task renders like any other task
        expect(dashboard).toContain("tasks.map((t) =>");
    });

    it("keeps the purposes working, as a dialog", () => {
        const list = component(purposes, "PurposeList");
        expect(list).toContain("data.purposes.map");
        expect(list).toContain("<StatusBadge status={p.status} />");
        expect(list).toMatch(/to=\{`\/settings\?section=\$\{encodeURIComponent\(p\.section\)\}`\}/);
        expect(page).toMatch(/canAccess\(user, "settings", "write"\)/);
        expect(page).toMatch(/kind: "purpose"[\s\S]*<PurposeDialog/);
        expect(edit).toContain("Zweck zuordnen");
    });

    it("says 'fehlt' for a purpose nobody set — decided on the server", () => {
        expect(server).toMatch(/label: "fehlt"/);
        expect(purposes).toContain("nicht gesetzt");
    });

    it("opens the duplicate dialog from a row, with the source fixed", () => {
        expect(tree).toMatch(/onDuplicate\(c\)/);
        const dup = component(dialogs, "DuplicateChannelDialog");
        expect(dup).toContain("channelId: source.id");
        expect(dup).not.toContain("<select");
        expect(dup).toContain("Zweck nicht");
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

    it("uses WoW icons for purposes and line icons only for UI actions, no native titles", () => {
        for (const icon of ["inv_misc_note_02", "inv_misc_pocketwatch_01", "inv_misc_grouplooking", "achievement_boss_illidan"]) {
            expect(server).toContain(`icon: "${icon}"`);
        }
        expect(tree).toMatch(/icon=\{<CopyIcon \/>\} tip="Duplizieren"/);
        // no native title on a DOM element (the <Modal title> prop is its heading)
        expect(ALL).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\btitle=/);
        // waiting looks the same everywhere
        expect(ALL).not.toMatch(/Lade…<\/div>/);
    });

    it("calls every channel endpoint the server serves", () => {
        for (const p of ["\"PATCH\", \"/api/channels\"", "/api/channels/archive", "/api/channels/delete", "/api/channels/rename-preview", "/api/channels/batch", "/api/channels/schema", "/api/channels/config"]) {
            expect(api).toContain(p);
        }
    });
});

// A category's naming schema has a place of its own: the pencil on the category
// head opens CategorySchemaDialog, instead of only quick-create's "merken".
describe("Kanäle — Namensschema pro Kategorie", () => {
    const schemaDialog = read("components", "channels", "CategorySchemaDialog.tsx");

    it("opens from the category head, only for writers and real categories", () => {
        expect(tree).toMatch(/canWrite && g\.id && \([\s\S]*?tip="Namensschema"[\s\S]*?onClick=\{\(\) => onSchema\(g\.id\)\}/);
        expect(page).toContain("onSchema={(categoryId) => setDialog({ kind: \"schema\", categoryId })}");
        expect(page).toMatch(/dialog\?\.kind === "schema" && \([\s\S]*?<CategorySchemaDialog[\s\S]*?onSaved=\{done\}/);
        // the pencil shows on hover of the category head like the channel rows' icons
        expect(css).toContain(".kn-cat-row:hover .kn-row-icons");
    });

    it("marks a category with its own schema, the schema in the tooltip", () => {
        expect(tree).toContain("ownSchemaOf(data, g.id) && (");
        expect(lib).toMatch(/export function ownSchemaOf[\s\S]*?schema !== data\.defaultSchema/);
    });

    it("saves through its own endpoint and previews what an empty field would mean", () => {
        expect(schemaDialog).toContain("saveChannelSchema({ categoryId, schema: schema.trim(), raid: raid.trim(), templateChannelId })");
        expect(schemaDialog).toMatch(/quickCreateChannels\(\{[\s\S]*?dryRun: true, ignoreStoredSchema: true/);
        expect(schemaDialog).toContain("<PlaceholderChips");
        expect(schemaDialog).toContain("placeholder=\"leer = wie der letzte Event-Kanal\"");
    });
});

// A thread's parentId names the text channel it hangs off, not a category, so
// without special handling it fell into "Ohne Kategorie" as if it were a
// top-level channel (#361 — the "Bewerbungen" application threads).
describe("Kanäle — Threads nisten unter ihrem Kanal (#361)", () => {
    it("marks a channel as a thread on the server, the API type carries it through", () => {
        const server = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "discord.js"), "utf8");
        expect(server).toContain("const THREAD_TYPES = [ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread];");
        expect(server).toContain("isThread: THREAD_TYPES.includes(c.type),");
        expect(api).toContain("isThread: boolean;");
    });

    it("resolves a thread's real category through its parent channel instead of grouping it loose", () => {
        expect(lib).toContain("export type ChannelNode = Channel & { threads: Channel[] };");
        expect(lib).toMatch(/const top = channels\.filter\(\(c\) => !c\.isThread\);/);
        expect(lib).toMatch(/if \(t\.parentId && topIds\.has\(t\.parentId\)\)/);
        // a thread whose parent channel is gone (filtered out, deleted) still shows up, loose
        expect(lib).toContain("orphanThreads.push(t);");
    });

    it("nests a thread's row under its channel, folded per channel, indented", () => {
        expect(tree).toContain("g.visible.map((c) => {");
        expect(tree).toMatch(/renderRow\(c, \{[\s\S]*?threadCount: c\.threads\.length/);
        expect(tree).toContain("c.threads.map((t) => renderRow(t, { nested: true }))");
        expect(css).toContain(".kn-row-thread { padding-left: 34px; }");
    });

    it("does not offer moving a thread into another category or cloning it — only rename and delete", () => {
        expect(tree).toMatch(/!nested && <IconButton size="sm" icon=\{<SettingsIcon \/>\} tip="Bearbeiten"/);
        expect(tree).toMatch(/!nested && <IconButton size="sm" icon=\{<CopyIcon \/>\} tip="Duplizieren"/);
        // rename and delete stay unconditional — they work for a thread too
        expect(tree).toMatch(/icon=\{<PencilIcon \/>\} tip="Umbenennen"[^\n]*onClick=\{\(\) => setEditing\(c\.id\)\}/);
    });

    it("excludes the threads of an archived channel from the tree along with the channel itself", () => {
        expect(tree).toContain("!archived.has(c.parentId)");
    });

    it("gives threads their own line icon and type label", () => {
        expect(bits).toContain("case TYPE_ANNOUNCEMENT_THREAD:");
        expect(bits).toContain("return <ThreadIcon />;");
        const server = fs.readFileSync(path.join(__dirname, "..", "..", "src", "web", "discord.js"), "utf8");
        expect(server).toContain("[ChannelType.PublicThread]: \"Thread\",");
        expect(server).toContain("[ChannelType.PrivateThread]: \"Privater Thread\",");
    });
});
