import { useEffect, useState, type ReactNode } from "react";
import {
    getSettings, updateSettings, saveRaidsheet, deleteRaidsheet, searchSettingsItems, getIngestTokens,
    type ApiError, type SettingsData, type AdminConfig, type Raidsheet,
    type RolePermissions, type Access, type TopItem, type IngestToken, type TextChannel,
} from "../api";
import { useOutletContext } from "react-router-dom";
import { usePersistedSearchParam } from "../lib/persistedState";
import { useTableSort, type Dir } from "../lib/tableSort";
import { SortTh } from "../components/SortTh";
import type { ShellContext } from "../components/Shell";
import RolePermissionsEditor from "../components/RolePermissions";
import BotCommandAccess from "../components/BotCommandAccess";
import Segment from "../components/ui/Segment";
import ItemSearchPicker from "../components/ItemSearchPicker";
import { itemQualityProps } from "../lib/itemQuality";
import { ExternalIcon, TrashIcon, XIcon } from "../components/icons";
import { useToast } from "../components/Jobs";
import SectionNav from "../components/SectionNav";
import { ListSection } from "../components/ListSection";
import { useCollectionEditor } from "../lib/collectionEditor";
import CategoryMatrix, { type CategorySheet } from "../components/CategoryMatrix";
import ConnectionsSection from "../components/SettingsConnections";
import { ChannelPicker, FieldLabel, InfoTip, PenIcon, RolePicker } from "../components/settingsUi";
import {
    SECTION_PARAM_IDS, visibleSections, resolveSection, groupedSections, savesWithForm, type SettingsSection,
} from "../lib/settingsSections";
import { draftChanges, missingConnections } from "../lib/settingsLogic";
import { useConfirm } from "../components/ui/Modal";
import { Button, IconButton } from "../components/ui/Button";
import IconTile from "../components/ui/IconTile";
import PartHead from "../components/ui/PartHead";
import "../styles/einstellungen.css";
import RaidLoader from "../components/ui/RaidLoader";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// The page's shared draft: everything the save bar counts. The connections are
// not part of it — each connection modal saves its own block — and neither are
// the raidsheets and the raider → character assignment, which save themselves.
type Draft = {
    adminRoleIds: string[];
    rolePermissions: RolePermissions;
    // What every logged-in account gets without a role (see RolePermissions.tsx).
    baseAccess: Access;
    // Rights handed to single Discord accounts rather than to a role.
    userPermissions: RolePermissions;
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIds: string[];
    raidTemplateId: string;
    raidChannelId: string;
    categoryLootTool: Record<string, string>;
    categorySheets: Record<string, CategorySheet>;
    topItems: TopItem[];
};

function toDraft(config: AdminConfig): Draft {
    return {
        // The access keys are absent for a non-admin who only holds write on "Einstellungen".
        adminRoleIds: config.adminRoleIds || [],
        rolePermissions: config.rolePermissions || {},
        baseAccess: config.baseAccess || {},
        userPermissions: config.userPermissions || {},
        officerRoleId: config.officerRoleId || "",
        applicationChannelId: config.applicationChannelId || "",
        highestBidsChannelId: config.highestBidsChannelId || "",
        highestBidsMessageId: config.highestBidsMessageId || "",
        categoryIds: config.categoryIds || [],
        categoryRoles: config.categoryRoles || {},
        logChannelIds: config.logChannelIds || [],
        raidTemplateId: config.raidDefaults?.templateId || "",
        raidChannelId: config.raidDefaults?.channelId || "",
        categoryLootTool: config.categoryLootTool || {},
        categorySheets: config.categorySheets || {},
        topItems: config.topItems || [],
    };
}

// The drops the guild counts as "big". Picked from the live Wowhead search and
// stored with icon + quality, so the dashboard can render an award without
// looking the item up again — and matched against imported loot by item id.
function TopItemsField({ items, onChange }: {
    items: TopItem[];
    onChange: (items: TopItem[]) => void;
}) {
    const add = (it: { id: number; name: string; iconUrl?: string; quality?: number | null }) => {
        if (items.some((x) => x.id === it.id)) return;
        onChange([...items, { id: it.id, name: it.name, iconUrl: it.iconUrl || "", quality: it.quality ?? null }]);
    };

    return (
        <div className="set-field">
            <FieldLabel tip="Top-Items" tipSub="Wird eines dieser Items importiert, taucht es auf dem Dashboard unter „Latest Loot“ auf — mit Charakter, Raid und Datum. Ohne Eintrag bleibt die Karte leer.">Item hinzufügen</FieldLabel>
            <ItemSearchPicker search={searchSettingsItems} onPick={add} />
            {items.length > 0 ? (
                <ul className="topitem-list">
                    {items.map((it) => (
                        <li key={it.id} className="topitem">
                            <span className="topitem-name" data-tip={it.name || `Item ${it.id}`} data-tip-sub={`Item-ID ${it.id}`}>
                                {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                                <span {...itemQualityProps(it.quality)}>{it.name || `Item ${it.id}`}</span>
                            </span>
                            <IconButton icon={<XIcon />} tip="Entfernen" size="sm" onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
                        </li>
                    ))}
                </ul>
            ) : <div className="empty">Noch kein Top-Item.</div>}
        </div>
    );
}

/** Several channels: chips with a remove button, plus a picker (or an id field while the bot is offline). */
function ChannelListField({ ids, channels, onChange }: {
    ids: string[];
    channels: TextChannel[];
    onChange: (ids: string[]) => void;
}) {
    const [typed, setTyped] = useState("");
    const byId = new Map(channels.map((c) => [c.id, c]));
    const add = (id: string) => {
        const clean = id.trim();
        if (clean && !ids.includes(clean)) onChange([...ids, ...splitList(clean).filter((x) => !ids.includes(x))]);
    };
    return (
        <>
            {ids.length > 0 && (
                <div className="chip-row">
                    {ids.map((id) => (
                        <span key={id} className="badge chip accent" data-tip={byId.get(id) ? `#${byId.get(id)!.name}` : "Unbekannter Kanal"} data-tip-sub={`ID ${id}`}>
                            {byId.get(id) ? `#${byId.get(id)!.name}` : <span className="mono">{id}</span>}
                            <button type="button" className="chip-x" aria-label="Kanal entfernen" onClick={() => onChange(ids.filter((x) => x !== id))}><XIcon /></button>
                        </span>
                    ))}
                </div>
            )}
            {channels.length ? (
                <ChannelPicker value="" channels={channels.filter((c) => !ids.includes(c.id))} onChange={add} placeholder="+ Kanal hinzufügen" />
            ) : (
                <div className="inline-add">
                    <input type="text" className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Discord-Channel-ID"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(typed); setTyped(""); } }} />
                    <Button variant="ghost" onClick={() => { add(typed); setTyped(""); }} disabled={!typed.trim()}>Hinzufügen</Button>
                </div>
            )}
        </>
    );
}

type SheetSortKey = "name" | "sheetName" | "keywords";
const SHEET_SORT_DEFAULTS: Record<SheetSortKey, Dir> = { name: "asc", sheetName: "asc", keywords: "asc" };

function RaidsheetForm({ sheet, csrfToken, onSaved, onCancel }: {
    sheet: Raidsheet | null;
    csrfToken: string | null;
    onSaved: (msg: string) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState(sheet?.name ?? "");
    const [spreadsheetId, setSpreadsheetId] = useState(sheet?.spreadsheetId ?? "");
    const [sheetName, setSheetName] = useState(sheet?.sheetName ?? "Setup");
    const [gid, setGid] = useState(sheet?.gid === undefined || sheet?.gid === null ? "" : String(sheet.gid));
    const [keywords, setKeywords] = useState((sheet?.keywords ?? []).join(", "));
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveRaidsheet(csrfToken, { id: sheet?.id, name, spreadsheetId, sheetName, gid, keywords: splitList(keywords) });
            onSaved(sheet ? `Raidsheet „${name}“ gespeichert.` : `Raidsheet „${name}“ angelegt.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="sheetcard set-form" onSubmit={submit}>
            <div className="set-field"><FieldLabel htmlFor="rs-name">Name (Content)</FieldLabel><input id="rs-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Tier 6 / SWP" required /></div>
            <div className="set-field"><FieldLabel htmlFor="rs-id" tip="Spreadsheet-ID" tipSub="Der lange Teil der Sheet-URL zwischen /d/ und /edit.">Spreadsheet-ID</FieldLabel><input id="rs-id" type="text" className="mono" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="Google-Sheet-ID" /></div>
            <div className="set-grid">
                <div className="set-field"><FieldLabel htmlFor="rs-tab">Tab-Name</FieldLabel><input id="rs-tab" type="text" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Setup" /></div>
                <div className="set-field"><FieldLabel htmlFor="rs-gid" tip="Tab-GID" tipSub="Die Zahl hinter #gid= in der URL des Tabs.">Tab-GID</FieldLabel><input id="rs-gid" type="text" className="mono" value={gid} onChange={(e) => setGid(e.target.value)} placeholder="0" /></div>
            </div>
            <div className="set-field">
                <FieldLabel htmlFor="rs-kw" tip="Keywords" tipSub="Kommagetrennt. Passt ein Keyword auf den Event-Titel, wird dieses Sheet automatisch vorgeschlagen.">Keywords</FieldLabel>
                <input id="rs-kw" type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="kara, gruul, maggi" />
            </div>
            <div className="row-actions">
                <Button type="submit" disabled={busy}>{sheet ? "Speichern" : "Raidsheet anlegen"}</Button>
                <Button variant="ghost" disabled={busy} onClick={onCancel}>Abbrechen</Button>
            </div>
        </form>
    );
}

// The guild's raidsheet templates: the list first, one editor at a time.
function RaidsheetsSection({ sheets, csrfToken, onChanged }: {
    sheets: Raidsheet[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const ask = useConfirm();
    const editor = useCollectionEditor("sheet");
    const toast = useToast();
    const { sort, dir, onSort, apply } = useTableSort<SheetSortKey>("raidsheets-sort", SHEET_SORT_DEFAULTS, "name");

    const remove = async (sheet: Raidsheet) => {
        if (!(await ask({ title: `Raidsheet „${sheet.name}“ löschen?`, action: "Löschen" }))) return;
        try {
            await deleteRaidsheet(csrfToken, sheet.id);
            onChanged(`Raidsheet „${sheet.name}“ gelöscht.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    const saved = (msg: string) => { editor.close(); onChanged(msg); };
    const sorted = apply(sheets, (s, key) => {
        switch (key) {
            case "sheetName": return (s.sheetName || "").toLowerCase();
            case "keywords": return s.keywords.join(", ").toLowerCase();
            default: return (s.name || "").toLowerCase();
        }
    });

    return (
        <ListSection
            editor={editor}
            entries={sheets}
            idOf={(s) => s.id}
            newLabel="Neues Raidsheet"
            editorTitle={(s) => (s ? `Raidsheet „${s.name || ""}“ bearbeiten` : "Neues Raidsheet")}
            editorFor={(s) => <RaidsheetForm sheet={s} csrfToken={csrfToken} onSaved={saved} onCancel={editor.close} />}
        >
            {sheets.length ? (
                <div className="set-card table-scroll">
                    <table className="idx">
                        <thead>
                            <tr>
                                <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="sheetName" label="Tab" sort={sort} dir={dir} onSort={onSort} />
                                <SortTh sortKey="keywords" label="Keywords" sort={sort} dir={dir} onSort={onSort} />
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((s) => (
                                <tr key={s.id}>
                                    <td><strong>{s.name || "(ohne Name)"}</strong></td>
                                    <td className="small">{s.sheetName || "—"}</td>
                                    <td className="small">{s.keywords.length ? s.keywords.join(", ") : "—"}</td>
                                    <td className="cell-act">
                                        {s.spreadsheetId && (
                                            <a className="ibtn sm" target="_blank" rel="noopener noreferrer" aria-label="Sheet öffnen" data-tip="Sheet öffnen"
                                                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit${s.gid ? `#gid=${s.gid}` : ""}`}>
                                                <ExternalIcon />
                                            </a>
                                        )}
                                        <IconButton icon={<PenIcon />} tip="Bearbeiten" size="sm" onClick={() => editor.startEdit(s.id)} />
                                        <IconButton icon={<TrashIcon />} tip="Löschen" size="sm" tone="danger" onClick={() => remove(s)} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : <div className="empty">Noch keine Raidsheets angelegt.</div>}
        </ListSection>
    );
}

/** A module's fields on the panel card, each hint moved into its label's tooltip. */
function ModuleCard({ children }: { children: ReactNode }) {
    return <div className="set-card set-form">{children}</div>;
}

type PermView = "areas" | "bot";
const PERM_VIEWS: readonly PermView[] = ["areas", "bot"];

export default function SettingsPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<SettingsData | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [tokens, setTokens] = useState<IngestToken[] | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [saving, setSaving] = useState(false);
    const toast = useToast();
    // In the url as well as remembered, so a hint elsewhere in the menu can link
    // straight at the section it names ("…siehe Einstellungen → Kategorien").
    // Old ids stay allowed and are redirected by resolveSection().
    const [section, setSection] = usePersistedSearchParam(
        "settings-section", "section", "berechtigungen", SECTION_PARAM_IDS,
    );
    // Berechtigungen has two views: the menu's areas and the bot commands.
    const [permView, setPermView] = usePersistedSearchParam<PermView>("settings-perm-view", "perm", "areas", PERM_VIEWS);

    const load = () => {
        getSettings()
            .then((d) => {
                setData(d);
                setDraft(toDraft(d.config));
            })
            .catch((err: ApiError) => setError(err));
    };
    const loadTokens = () => {
        getIngestTokens().then((r) => setTokens(r.tokens)).catch(() => setTokens(null));
    };

    // load() only ever runs once.
    useEffect(load, []);
    // The token list is full-admin-only; it feeds the Loot-Sync card and the
    // "Verbindungen" badge.
    const canManage = !!data?.canManageAccess;
    useEffect(() => { if (canManage) loadTokens(); }, [canManage]);

    if (error) return <div className="empty">Fehler beim Laden der Einstellungen: {error.message}</div>;
    if (!data || !draft) return <RaidLoader text="Einstellungen werden geladen" />;

    // A user who only holds write on "Einstellungen" never sees the access
    // section; a remembered id that is gone resolves to the first section they
    // may open instead of hiding everything.
    const sections = visibleSections(data.canManageAccess);
    const active = resolveSection(section, sections);
    const activeSection = sections.find((s) => s.id === active)!;
    const channels = data.channels || [];

    const patch = (fields: Partial<Draft>) => setDraft({ ...draft, ...fields });

    const toggleCategory = (id: string) => {
        const has = draft.categoryIds.includes(id);
        patch({ categoryIds: has ? draft.categoryIds.filter((c) => c !== id) : [...draft.categoryIds, id] });
    };
    const toggleRole = (catId: string, roleId: string) => {
        const current = new Set(draft.categoryRoles[catId] || []);
        if (current.has(roleId)) current.delete(roleId); else current.add(roleId);
        patch({ categoryRoles: { ...draft.categoryRoles, [catId]: [...current] } });
    };

    const saved = toDraft(data.config);
    const roleNames = new Map(data.roles.map((r) => [r.id, r.name]));
    const areaNames = new Map(data.areas.map((a) => [a.id, a.label]));
    const categoryNames = new Map(data.categories.map((c) => [c.id, c.name]));
    const changes = draftChanges(saved, draft, {
        role: (id) => (roleNames.has(id) ? `@${roleNames.get(id)}` : id),
        user: (id) => (data.userNames || {})[id] || `Konto ${id}`,
        area: (id) => areaNames.get(id) || id,
        category: (id) => categoryNames.get(id) || id,
    });

    const submit = async () => {
        setSaving(true);
        try {
            const { config } = await updateSettings(csrfToken, {
                // Access config is full-admin-only; sending it as anyone else
                // would (rightly) be rejected with a 403.
                ...(data.canManageAccess ? {
                    adminRoleIds: draft.adminRoleIds,
                    rolePermissions: draft.rolePermissions,
                    baseAccess: draft.baseAccess,
                    userPermissions: draft.userPermissions,
                } : {}),
                officerRoleId: draft.officerRoleId.trim(),
                applicationChannelId: draft.applicationChannelId.trim(),
                highestBidsChannelId: draft.highestBidsChannelId.trim(),
                highestBidsMessageId: draft.highestBidsMessageId.trim(),
                categoryIds: draft.categoryIds,
                categoryRoles: draft.categoryRoles,
                logChannelIds: draft.logChannelIds,
                raidDefaults: { templateId: draft.raidTemplateId.trim(), channelId: draft.raidChannelId.trim() },
                categoryLootTool: draft.categoryLootTool,
                // Sent whole: the store replaces the map, so clearing a url is
                // what removes that category's sheet.
                categorySheets: Object.fromEntries(
                    Object.entries(draft.categorySheets).map(([id, s]) => [id, { url: s.url.trim(), name: s.name.trim() }]),
                ),
                topItems: draft.topItems,
            });
            setData({ ...data, config });
            setDraft(toDraft(config));
            toast("Gespeichert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    const head = (s: SettingsSection, action?: ReactNode, tip?: string, tipSub?: string) => (
        <PartHead icon={s.icon} tone="settings" title={s.label} crumb={`Einstellungen › ${s.crumb}`} action={action} tip={tip} tipSub={tipSub} />
    );

    const permSwitch = (
        <Segment
            ariaLabel="Berechtigungen"
            size="sm"
            value={permView}
            onChange={(v) => setPermView(v)}
            options={[
                { value: "areas", label: "Bereiche", tip: "Wer im EventHelper welchen Bereich sehen oder bearbeiten darf" },
                { value: "bot", label: "Bot-Befehle", tip: "Wer im Discord welchen Bot-Befehl nutzen darf" },
            ]}
        />
    );

    // The panel of the open section.
    const panel = () => {
        switch (active) {
            case "berechtigungen": return permView === "bot" ? (
                <BotCommandAccess csrfToken={csrfToken} viewSwitch={permSwitch} icon={activeSection.icon} crumb="Zugang · wer darf welchen Bot-Befehl im Discord nutzen" />
            ) : (
                <RolePermissionsEditor
                    viewSwitch={permSwitch}
                    areas={data.areas}
                    roles={data.roles}
                    adminRoleIds={draft.adminRoleIds}
                    onAdminRoleIds={(adminRoleIds) => patch({ adminRoleIds })}
                    value={draft.rolePermissions}
                    onChange={(rolePermissions) => patch({ rolePermissions })}
                    baseAccess={draft.baseAccess}
                    onBaseAccessChange={(baseAccess) => patch({ baseAccess })}
                    userPermissions={draft.userPermissions}
                    onUserPermissionsChange={(userPermissions) => patch({ userPermissions })}
                    userNames={data.userNames || {}}
                    icon={activeSection.icon}
                    crumb={activeSection.crumb}
                />
            );

            case "verbindungen": return (
                <ConnectionsSection
                    data={data}
                    tokens={tokens}
                    csrfToken={csrfToken}
                    onConfig={(config) => setData({ ...data, config })}
                    onTokensChanged={loadTokens}
                    icon={activeSection.icon}
                    crumb={activeSection.crumb}
                />
            );

            case "kategorien": return (
                <CategoryMatrix
                    categories={data.categories}
                    roles={data.roles}
                    categoryIds={draft.categoryIds}
                    categoryRoles={draft.categoryRoles}
                    categoryLootTool={draft.categoryLootTool}
                    categorySheets={draft.categorySheets}
                    savedCategoryRoles={data.config.categoryRoles || {}}
                    onToggleCategory={toggleCategory}
                    onToggleRole={toggleRole}
                    onLootTool={(id, tool) => patch({ categoryLootTool: { ...draft.categoryLootTool, [id]: tool } })}
                    onSheet={(id, sheet) => patch({ categorySheets: { ...draft.categorySheets, [id]: sheet } })}
                    csrfToken={csrfToken}
                    icon={activeSection.icon}
                    crumb={activeSection.crumb}
                />
            );

            case "raids": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-raid-template" tip="Standard-Template" tipSub="Raid-Helper-Template, mit dem ein neues Raid-Event vorbelegt wird, wenn beim Anlegen nichts anderes gewählt ist.">Standard-Template-ID</FieldLabel>
                            <input id="set-raid-template" type="text" className="mono" value={draft.raidTemplateId} onChange={(e) => patch({ raidTemplateId: e.target.value })} placeholder="Raid-Helper Template-ID" />
                        </div>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-raid-channel" tip="Standard-Kanal" tipSub="Der Kanal, in dem ein neues Raid-Event angelegt wird, wenn beim Anlegen keiner gewählt ist.">Standard-Kanal</FieldLabel>
                            <ChannelPicker id="set-raid-channel" value={draft.raidChannelId} channels={channels} onChange={(raidChannelId) => patch({ raidChannelId })} />
                        </div>
                    </ModuleCard>
                </>
            );

            case "raidsheets": return (
                <>
                    {head(activeSection, undefined, "Raidsheet-Vorlagen", "Google-Sheets nach Content (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen. Ein festes Sheet für eine ganze Raid-Kategorie wird unter Kategorien zugewiesen.")}
                    <RaidsheetsSection sheets={data.raidsheets} csrfToken={csrfToken} onChanged={(msg) => { toast(msg); load(); }} />
                </>
            );

            case "topitems": return (
                <>
                    {head(activeSection, undefined, "Top-Items", "Die richtig großen Drops — Waffen, Legendary-Teile, alles, was die Gilde als besonders wertet. Vergibt ein Raid eines davon, hebt das Dashboard die Vergabe hervor. Welches Loot-Addon eine Kategorie benutzt, steht unter Kategorien.")}
                    <ModuleCard>
                        <TopItemsField items={draft.topItems} onChange={(topItems) => patch({ topItems })} />
                    </ModuleCard>
                </>
            );

            case "logs": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel tip="Log-Kanäle" tipSub="Kanäle, in denen automatisch Warcraft-Logs gepostet werden. Der Bot hängt dort die Auswertungs-Knöpfe an.">Log-Kanäle</FieldLabel>
                            <ChannelListField ids={draft.logChannelIds} channels={channels} onChange={(logChannelIds) => patch({ logChannelIds })} />
                        </div>
                    </ModuleCard>
                </>
            );

            case "recruitment": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-app-channel" tip="Bewerbungs-Kanal" tipSub="Kanal, in dem neue Bewerbungen als Thread gepostet werden.">Bewerbungs-Kanal</FieldLabel>
                            <ChannelPicker id="set-app-channel" value={draft.applicationChannelId} channels={channels} onChange={(applicationChannelId) => patch({ applicationChannelId })} />
                        </div>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-officer" tip="Offizier-Rolle" tipSub="Wird bei neuen Bewerbungen gepingt. Leer lassen für keinen Ping.">Offizier-Rolle</FieldLabel>
                            <RolePicker id="set-officer" value={draft.officerRoleId} roles={data.roles} onChange={(officerRoleId) => patch({ officerRoleId })} placeholder="— kein Ping —" />
                        </div>
                    </ModuleCard>
                </>
            );

            case "auktionen": return (
                <>
                    {head(activeSection)}
                    <ModuleCard>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-bids-channel" tip="Höchstgebote-Kanal" tipSub="Der Kanal mit der Höchstgebote-Übersicht der Legendary-Auktionen.">Höchstgebote-Kanal</FieldLabel>
                            <ChannelPicker id="set-bids-channel" value={draft.highestBidsChannelId} channels={channels} onChange={(highestBidsChannelId) => patch({ highestBidsChannelId })} />
                        </div>
                        <div className="set-field">
                            <FieldLabel htmlFor="set-bids-msg" tip="Höchstgebote-Nachricht" tipSub="Die Nachricht mit der Übersicht, die der Bot aktualisiert. In Discord per Rechtsklick → „ID kopieren“ (Entwicklermodus).">Höchstgebote-Message-ID</FieldLabel>
                            <input id="set-bids-msg" type="text" className="mono" value={draft.highestBidsMessageId} onChange={(e) => patch({ highestBidsMessageId: e.target.value })} placeholder="Discord-Message-ID" />
                        </div>
                    </ModuleCard>
                </>
            );

            default: return null;
        }
    };

    // The badges of the column: what is open in a section, so nobody has to
    // open each one to find the gap.
    const missing = missingConnections(data, tokens, data.canManageAccess);
    const activeCategories = draft.categoryIds.length;
    const navGroups = groupedSections(sections).map((g) => ({
        group: g.group,
        items: g.items.map((s) => ({
            id: s.id,
            label: s.label,
            icon: s.icon,
            badge: s.id === "verbindungen" ? { count: missing, tone: "mid" as const, tip: `${missing} ${missing === 1 ? "Verbindung" : "Verbindungen"} nicht eingerichtet` }
                : s.id === "kategorien" ? { count: activeCategories, tip: `${activeCategories} aktive Raid-Kategorien` }
                    : null,
        })),
    }));

    const inForm = savesWithForm(active);

    return (
        <>
            <div className="page-head settings-head">
                <IconTile icon="trade_engineering" tone="settings" size="lg" />
                <div className="ph-text">
                    <div className="kicker">System · greift ohne Bot-Neustart</div>
                    <h1>
                        Einstellungen
                        <InfoTip head="Einstellungen" sub={"Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart.\nIDs bekommst du in Discord per Rechtsklick → „ID kopieren“ (Entwicklermodus)."} />
                    </h1>
                </div>
            </div>

            <div className="settings-layout">
                <SectionNav groups={navGroups} active={active} onSelect={setSection} ariaLabel="Einstellungs-Bereiche" />
                <div className={`settings-panel${inForm ? " in-form" : ""}`}>
                    {panel()}
                    {changes.length > 0 && (
                        <div className="savebar" role="status" aria-live="polite">
                            <IconTile icon={activeSection.icon} tone="settings" />
                            <b>{changes.length} ungespeicherte {changes.length === 1 ? "Änderung" : "Änderungen"}</b>
                            <span className="savebar-list" data-tip="Ungespeichert" data-tip-sub={changes.join("\n")}>
                                {changes.slice(0, 2).join(", ")}{changes.length > 2 ? ` +${changes.length - 2}` : ""}
                            </span>
                            <span className="grow" />
                            <Button variant="ghost" onClick={() => setDraft(toDraft(data.config))} disabled={saving}>Verwerfen</Button>
                            <Button onClick={submit} disabled={saving}>{saving ? "Speichert…" : "Speichern"}</Button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
