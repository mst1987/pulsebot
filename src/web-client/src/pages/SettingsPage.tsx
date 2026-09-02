import { useEffect, useState } from "react";
import {
    getSettings, updateSettings, saveRaidsheet, deleteRaidsheet,
    getRaiderCharacters, saveRaiderCharacters, searchSettingsItems,
    getIngestTokens, createIngestToken, deleteIngestToken,
    type ApiError, type SettingsData, type AdminConfig, type Category, type Raidsheet,
    type RaiderCharactersData, type RolePermissions, type Access, type TopItem, type IngestToken,
} from "../api";
import { useOutletContext } from "react-router-dom";
import { fmtMs } from "../lib/format";
import { usePersistedSearchParam } from "../lib/persistedState";
import { useTableSort, type Dir } from "../lib/tableSort";
import { SortTh } from "../components/SortTh";
import type { ShellContext } from "../components/Shell";
import RolePermissionsEditor from "../components/RolePermissions";
import ItemSearchPicker from "../components/ItemSearchPicker";
import { itemQualityProps } from "../lib/itemQuality";
import { TrashIcon } from "../components/icons";
import { useToast } from "../components/Jobs";
import SectionNav from "../components/SectionNav";
import { ListSection } from "../components/ListSection";
import { useCollectionEditor } from "../lib/collectionEditor";
import CategoryMatrix, { type CategorySheet } from "../components/CategoryMatrix";
import { SETTINGS_SECTIONS, visibleSections, resolveSection, groupedSections, savesWithForm } from "../lib/settingsSections";

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Editable form state, mirroring src/web/renderAdmin.js's renderSettings() form
// fields — comma lists stay as raw text while being edited, split on save.
type Draft = {
    adminRoleIdsText: string;
    rolePermissions: RolePermissions;
    // What every logged-in account gets without a role (see RolePermissions.tsx).
    baseAccess: Access;
    // Rights handed to single Discord accounts rather than to a role.
    userPermissions: RolePermissions;
    guildId: string;
    raidhelperServerId: string;
    officerRoleId: string;
    applicationChannelId: string;
    highestBidsChannelId: string;
    highestBidsMessageId: string;
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    logChannelIdsText: string;
    raidTemplateId: string;
    raidChannelId: string;
    blizzardClientId: string;
    blizzardRegion: string;
    blizzardRealmSlug: string;
    blizzardNamespace: string;
    categoryLootTool: Record<string, string>;
    // Part of the one big form since the per-category settings were merged into
    // one section — it used to save itself through a PATCH of its own.
    categorySheets: Record<string, CategorySheet>;
    topItems: TopItem[];
};

function toDraft(config: AdminConfig): Draft {
    return {
        // Both are absent for a non-admin who only holds write on "Einstellungen".
        adminRoleIdsText: (config.adminRoleIds || []).join(", "),
        rolePermissions: config.rolePermissions || {},
        baseAccess: config.baseAccess || {},
        userPermissions: config.userPermissions || {},
        guildId: config.guildId,
        raidhelperServerId: config.raidhelperServerId,
        officerRoleId: config.officerRoleId,
        applicationChannelId: config.applicationChannelId,
        highestBidsChannelId: config.highestBidsChannelId,
        highestBidsMessageId: config.highestBidsMessageId,
        categoryIds: config.categoryIds,
        categoryRoles: config.categoryRoles,
        logChannelIdsText: config.logChannelIds.join(", "),
        raidTemplateId: config.raidDefaults.templateId,
        raidChannelId: config.raidDefaults.channelId,
        blizzardClientId: config.blizzard.clientId,
        blizzardRegion: config.blizzard.region,
        blizzardRealmSlug: config.blizzard.realmSlug,
        blizzardNamespace: config.blizzard.namespace,
        categoryLootTool: config.categoryLootTool || {},
        categorySheets: config.categorySheets || {},
        topItems: config.topItems || [],
    };
}

// The drops the guild counts as "big". Picked from the live Wowhead search and
// stored with icon + quality, so the dashboard can render an award without
// looking the item up again — and matched against imported loot by item id, so
// a differently-named export row still counts.
function TopItemsField({ items, onChange }: {
    items: TopItem[];
    onChange: (items: TopItem[]) => void;
}) {
    const add = (it: { id: number; name: string; iconUrl?: string; quality?: number | null }) => {
        if (items.some((x) => x.id === it.id)) return;
        onChange([...items, { id: it.id, name: it.name, iconUrl: it.iconUrl || "", quality: it.quality ?? null }]);
    };

    return (
        <div className="field">
            <label>Top-Items</label>
            <ItemSearchPicker search={searchSettingsItems} onPick={add} />
            {items.length > 0 && (
                <ul className="hr-list">
                    {items.map((it) => (
                        <li key={it.id} className="rolebox hr-chip">
                            <span>
                                {it.iconUrl && <img src={it.iconUrl} alt="" loading="lazy" />}
                                <span {...itemQualityProps(it.quality)}>{it.name || `Item ${it.id}`}</span>
                                <span className="hint" style={{ marginLeft: 6 }}>#{it.id}</span>
                            </span>
                            <button
                                type="button" className="btn btn-sm" title="Entfernen"
                                onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                            >✕</button>
                        </li>
                    ))}
                </ul>
            )}
            <div className="hint">
                Wird eines dieser Items importiert, taucht es auf dem Dashboard unter „Latest Loot" auf —
                mit Charakter, Raid und Datum. Ohne Eintrag bleibt die Karte leer.
            </div>
        </div>
    );
}

// Manual raider->character assignment per category (see raiderCharactersStore.js):
// overrides the automatic "last known spec" guess on the Raid-Detail attendance
// tab, since raiders often play a different character on a different raid
// day/type. Self-contained (own fetch/save cycle scoped to the chosen category),
// same shape as the Raidsheets tab below.
function RaiderCharactersTab({ categories, csrfToken }: { categories: Category[]; csrfToken: string | null }) {
    const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
    const [info, setInfo] = useState<RaiderCharactersData | null>(null);
    const [draftMap, setDraftMap] = useState<Record<string, string>>({});
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const toast = useToast();

    const load = () => {
        setInfo(null);
        setLoadError(null);
        if (!categoryId) return;
        getRaiderCharacters(categoryId)
            .then((d) => {
                setInfo(d);
                setDraftMap(d.assignments);
            })
            .catch((err: ApiError) => setLoadError(err.message));
    };

    useEffect(load, [categoryId]);

    if (!categories.length) {
        return <p className="hint">Keine Kategorien geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>;
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { assignments } = await saveRaiderCharacters(csrfToken, categoryId, draftMap);
            setDraftMap(assignments);
            setInfo((prev) => (prev ? { ...prev, assignments } : prev));
            toast("Gespeichert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <p className="hint">
                Raider spielen je nach Raidtag/-typ oft unterschiedliche Charaktere. Hier lässt sich pro Kategorie
                (siehe „Kategorien") festlegen, welchen Charakter ein Raider dort spielt — das überschreibt auf der
                Event-Detailseite die automatische Erkennung aus vergangenen Anmeldungen.
            </p>
            <div className="field">
                <label>Kategorie</label>
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>
            {loadError && <p className="sub" style={{ color: "var(--high)" }}>{loadError}</p>}
            {!loadError && !info && <p className="sub">Lade…</p>}
            {info && !info.roleIds.length && (
                <p className="hint">Dieser Kategorie sind noch keine Raider-Rollen zugeordnet (siehe „Kategorien").</p>
            )}
            {info && info.membersError && (
                <p className="sub" style={{ color: "var(--high)" }}>Mitglieder konnten nicht geladen werden: {info.membersError}</p>
            )}
            {info && !!info.roleIds.length && !info.membersError && (
                <form className="card-form" onSubmit={submit}>
                    {!info.members.length ? (
                        <p className="sub">Keine Mitglieder mit den zugeordneten Rollen gefunden.</p>
                    ) : (
                        <>
                            {info.members.map((m) => (
                                <div className="field" key={m.id}>
                                    <label>{m.displayName}</label>
                                    <input
                                        type="text"
                                        list="raider-characters-known"
                                        value={draftMap[m.id] || ""}
                                        onChange={(e) => setDraftMap({ ...draftMap, [m.id]: e.target.value })}
                                        placeholder="Charname (leer = keine feste Zuordnung)"
                                    />
                                </div>
                            ))}
                            <datalist id="raider-characters-known">
                                {info.knownCharacters.map((c) => <option key={c} value={c} />)}
                            </datalist>
                            <div className="row-actions">
                                <button className="btn" type="submit" disabled={saving}>{saving ? "Speichert…" : "Speichern"}</button>
                            </div>
                        </>
                    )}
                </form>
            )}
        </>
    );
}

/**
 * API tokens for the loot-sync companion tool that ships with the WoW addon.
 *
 * The secret is shown exactly once, right after minting: the server stores only
 * a hash, so there is no "show again". The UI has to make that obvious *before*
 * someone navigates away, which is why the new token gets its own panel rather
 * than a row in the table.
 */
type TokenSortKey = "name" | "created" | "createdBy" | "lastUsed" | "uses";
const TOKEN_SORT_DEFAULTS: Record<TokenSortKey, Dir> = {
    name: "asc", created: "desc", createdBy: "asc", lastUsed: "desc", uses: "desc",
};

function tokenSortValue(t: IngestToken, key: TokenSortKey): string | number {
    switch (key) {
        case "name": return t.name.toLowerCase();
        case "created": return t.createdAt || 0;
        case "createdBy": return (t.createdBy || "").toLowerCase();
        case "lastUsed": return t.lastUsedAt || 0;
        case "uses": return t.uses || 0;
        default: return "";
    }
}

function IngestTokensTab({ csrfToken }: { csrfToken: string | null }) {
    // Default "zuletzt benutzt": the question this table answers is usually
    // "welcher Rechner lädt eigentlich noch hoch?".
    const { sort, dir, onSort, apply } = useTableSort<TokenSortKey>(
        "settings-ingest-tokens-sort", TOKEN_SORT_DEFAULTS, "lastUsed",
    );
    const [tokens, setTokens] = useState<IngestToken[] | null>(null);
    // Only the *load* failure stays inline — it describes the state of the list
    // below it, which a toast that fades after seven seconds cannot. Named
    // loadError so it stays distinguishable from an action's result, which
    // belongs in a toast.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    // The plaintext of the token just created — lives in this component's state
    // only, and is gone on reload.
    const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const load = () => {
        getIngestTokens()
            .then((r) => { setTokens(r.tokens); setLoadError(null); })
            .catch((err: ApiError) => setLoadError(err.message));
    };
    useEffect(load, []);

    const create = async () => {
        setBusy(true);
        try {
            const r = await createIngestToken(csrfToken, name);
            setFresh({ token: r.token, name: r.record.name });
            setName("");
            setCopied(false);
            load();
            toast(`Token „${r.record.name}" erstellt.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (t: IngestToken) => {
        if (!window.confirm(
            `Token „${t.name}" zurückziehen?\n\nDas Sync-Tool, das ihn benutzt, kann danach nichts mehr hochladen.`,
        )) return;
        try {
            await deleteIngestToken(csrfToken, t.id);
            load();
            toast(`Token „${t.name}" zurückgezogen.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <p className="note">
                Das WoW-Addon schreibt den Loot beider Addons (RCLootcouncil und Gargul) in seine SavedVariables;
                das Sync-Tool auf dem Rechner des Raidleaders lädt sie hier hoch. Es meldet sich nicht per Discord an,
                sondern mit einem dieser Tokens. Hochgeladene Raids landen in <strong>Historie &amp; Loot → Addon-Inbox</strong>
                {" "}und werden dort einmal bestätigt.
            </p>
            {loadError && <p className="sub" style={{ color: "var(--high)" }}>{loadError}</p>}

            {fresh && (
                <div className="dash-card" style={{ marginBottom: 16 }}>
                    <div className="dash-card-head"><h3>Token „{fresh.name}" erstellt</h3></div>
                    <div style={{ padding: "12px 16px" }}>
                        <p className="sub" style={{ marginTop: 0, color: "var(--high)" }}>
                            Jetzt kopieren — der Token wird nur dieses eine Mal angezeigt und ist danach nicht mehr
                            abrufbar (er liegt nur als Hash auf dem Server). Geht er verloren, einfach einen neuen erstellen.
                        </p>
                        <div className="field">
                            <input type="text" readOnly value={fresh.token} onFocus={(e) => e.target.select()} />
                        </div>
                        <div className="row-actions">
                            <button
                                className="btn" type="button"
                                onClick={() => { navigator.clipboard?.writeText(fresh.token); setCopied(true); }}
                            >
                                {copied ? "Kopiert ✓" : "Kopieren"}
                            </button>
                            <button className="btn ghost" type="button" onClick={() => setFresh(null)}>Fertig</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="field" style={{ maxWidth: 420 }}>
                <label>Neues Token</label>
                <input
                    type="text" value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="z.B. Raidlead-PC"
                />
                <div className="hint">Ein Name pro Rechner, damit ein einzelner gezielt zurückgezogen werden kann.</div>
            </div>
            <div className="row-actions" style={{ marginBottom: 18 }}>
                <button className="btn" type="button" onClick={create} disabled={busy}>
                    {busy ? "Erstellt…" : "Token erstellen"}
                </button>
            </div>

            {!tokens ? <div className="empty">Lade…</div> : !tokens.length ? (
                <div className="empty">Noch kein Token erstellt.</div>
            ) : (
                <table className="table">
                    <thead>
                        <tr>
                            <SortTh sortKey="name" label="Name" sort={sort} dir={dir} onSort={onSort} />
                            {/* Immer "ehl_…" plus vier Zeichen — nichts, wonach sich sortieren liesse. */}
                            <th>Token</th>
                            <SortTh sortKey="created" label="Erstellt" sort={sort} dir={dir} onSort={onSort} />
                            <SortTh sortKey="createdBy" label="Von" sort={sort} dir={dir} onSort={onSort} />
                            <SortTh sortKey="lastUsed" label="Zuletzt benutzt" sort={sort} dir={dir} onSort={onSort} />
                            <SortTh sortKey="uses" label="Uploads" sort={sort} dir={dir} onSort={onSort} />
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {apply(tokens, tokenSortValue).map((t) => (
                            <tr key={t.id}>
                                <td>{t.name}</td>
                                <td><code>ehl_…{t.hint}</code></td>
                                <td>{fmtMs(t.createdAt)}</td>
                                <td>{t.createdBy || "—"}</td>
                                <td>{t.lastUsedAt ? fmtMs(t.lastUsedAt) : <span className="sub">nie</span>}</td>
                                <td>{t.uses || 0}</td>
                                <td style={{ textAlign: "right" }}>
                                    <button className="icon-btn" type="button" title="Token zurückziehen" onClick={() => revoke(t)}>
                                        <TrashIcon />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </>
    );
}

function BlizzardSecretField({ hasStoredSecret, value, onChange }: {
    hasStoredSecret: boolean;
    value: string | undefined;
    onChange: (v: string | undefined) => void;
}) {
    if (value === undefined) {
        return (
            <div className="field">
                <label>Battle.net Client-Secret</label>
                <div className="row-actions">
                    <span className="hint">{hasStoredSecret ? "•••••••• (gespeichert)" : "Kein Secret hinterlegt"}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>Ändern</button>
                </div>
            </div>
        );
    }
    return (
        <div className="field">
            <label>Battle.net Client-Secret</label>
            <input
                type="password"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Neues Secret (leer speichern = löschen)"
                autoComplete="off"
            />
            <div className="hint">
                Leer speichern entfernt das Secret.{" "}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(undefined)}>Abbrechen</button>
            </div>
        </div>
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
            await saveRaidsheet(csrfToken, {
                id: sheet?.id,
                name,
                spreadsheetId,
                sheetName,
                gid,
                keywords: splitList(keywords),
            });
            onSaved(sheet ? `Raidsheet „${name}" gespeichert.` : `Raidsheet „${name}" angelegt.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="sheetcard" onSubmit={submit}>
            <div className="field"><label>Name (Content)</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Tier 6 / SWP" required /></div>
            <div className="field"><label>Spreadsheet-ID</label><input type="text" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="Google-Sheet-ID" /></div>
            <div className="field"><label>Tab-Name</label><input type="text" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Setup" /></div>
            <div className="field"><label>Tab-GID</label><input type="text" value={gid} onChange={(e) => setGid(e.target.value)} placeholder="0" /></div>
            <div className="field">
                <label>Keywords (kommagetrennt)</label>
                <input type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="kara, gruul, maggi" />
                <div className="hint">Passt ein Keyword auf den Event-Titel, wird dieses Sheet automatisch vorgeschlagen.</div>
            </div>
            <div className="row-actions">
                <button className="btn" type="submit" disabled={busy}>{sheet ? "Speichern" : "Raidsheet anlegen"}</button>
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button>
            </div>
        </form>
    );
}

// The guild's raidsheet templates: the list first, one editor at a time. Every
// sheet used to render its own five-field form below the previous one, which
// turned a handful of templates into a page nobody could scan.
function RaidsheetsSection({ sheets, csrfToken, onChanged }: {
    sheets: Raidsheet[];
    csrfToken: string | null;
    onChanged: (msg: string) => void;
}) {
    const editor = useCollectionEditor("sheet");
    const toast = useToast();
    const { sort, dir, onSort, apply } = useTableSort<SheetSortKey>("raidsheets-sort", SHEET_SORT_DEFAULTS, "name");

    const remove = async (sheet: Raidsheet) => {
        if (!confirm(`Raidsheet „${sheet.name}" wirklich löschen?`)) return;
        try {
            await deleteRaidsheet(csrfToken, sheet.id);
            onChanged(`Raidsheet „${sheet.name}" gelöscht.`);
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
            title="Raidsheet-Vorlagen"
            note={<>Google-Sheets nach Content aufgeteilt (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen. Ein festes Sheet für eine ganze Raidkategorie wird dagegen unter <b>Kategorien</b> zugewiesen.</>}
            newLabel="Neues Raidsheet"
            editorTitle={(s) => (s ? `Raidsheet „${s.name || ""}" bearbeiten` : "Neues Raidsheet")}
            editorFor={(s) => <RaidsheetForm sheet={s} csrfToken={csrfToken} onSaved={saved} onCancel={editor.close} />}
        >
            {sheets.length ? (
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
                                <td>
                                    <strong>{s.name || "(ohne Name)"}</strong>
                                    {s.spreadsheetId && (
                                        <>
                                            {" "}
                                            <a
                                                className="mlink" target="_blank" rel="noopener noreferrer"
                                                href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit${s.gid ? `#gid=${s.gid}` : ""}`}
                                            >öffnen ↗</a>
                                        </>
                                    )}
                                </td>
                                <td className="sub" style={{ margin: 0 }}>{s.sheetName || "—"}</td>
                                <td className="sub" style={{ margin: 0 }}>{s.keywords.length ? s.keywords.join(", ") : "—"}</td>
                                <td className="row-actions">
                                    <button className="btn btn-ghost" type="button" onClick={() => editor.startEdit(s.id)}>Bearbeiten</button>
                                    <button className="btn btn-danger" type="button" onClick={() => remove(s)}><TrashIcon />Löschen</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : <p className="sub">Noch keine Raidsheets angelegt.</p>}
        </ListSection>
    );
}


export default function SettingsPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<SettingsData | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [secretChange, setSecretChange] = useState<string | undefined>(undefined);
    const [error, setError] = useState<ApiError | null>(null);
    const [saving, setSaving] = useState(false);
    const toast = useToast();
    // In the url as well as remembered, so a hint elsewhere in the menu can link
    // straight at the section it names ("…siehe Einstellungen → Kategorien").
    const [section, setSection] = usePersistedSearchParam(
        "settings-section", "section", "zugang", SETTINGS_SECTIONS.map((s) => s.id),
    );

    const load = () => {
        getSettings()
            .then((d) => {
                setData(d);
                setDraft(toDraft(d.config));
                setSecretChange(undefined);
            })
            .catch((err: ApiError) => setError(err));
    };

    // load() only ever runs once.
    useEffect(load, []);

    if (error) return <div className="empty">Fehler beim Laden der Einstellungen: {error.message}</div>;
    if (!data || !draft) return <div className="empty">Lade…</div>;

    // A user who only holds write on "Einstellungen" never sees the access
    // sections; a remembered id that is gone (older build, or exactly that case)
    // resolves to the first section they may open instead of hiding everything.
    const sections = visibleSections(data.canManageAccess);
    const active = resolveSection(section, sections);
    const activeSection = sections.find((s) => s.id === active)!;

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

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const { config } = await updateSettings(csrfToken, {
                // Access config is full-admin-only; sending it as anyone else
                // would (rightly) be rejected with a 403.
                ...(data.canManageAccess ? {
                    adminRoleIds: splitList(draft.adminRoleIdsText),
                    rolePermissions: draft.rolePermissions,
                    baseAccess: draft.baseAccess,
                    userPermissions: draft.userPermissions,
                    guildId: draft.guildId.trim(),
                    raidhelperServerId: draft.raidhelperServerId.trim(),
                } : {}),
                officerRoleId: draft.officerRoleId.trim(),
                applicationChannelId: draft.applicationChannelId.trim(),
                highestBidsChannelId: draft.highestBidsChannelId.trim(),
                highestBidsMessageId: draft.highestBidsMessageId.trim(),
                categoryIds: draft.categoryIds,
                categoryRoles: draft.categoryRoles,
                logChannelIds: splitList(draft.logChannelIdsText),
                raidDefaults: { templateId: draft.raidTemplateId.trim(), channelId: draft.raidChannelId.trim() },
                blizzard: {
                    clientId: draft.blizzardClientId.trim(),
                    region: draft.blizzardRegion.trim() || "eu",
                    realmSlug: draft.blizzardRealmSlug.trim().toLowerCase() || "thunderstrike",
                    namespace: draft.blizzardNamespace.trim().toLowerCase(),
                    ...(secretChange !== undefined ? { clientSecret: secretChange } : {}),
                },
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
            setSecretChange(undefined);
            toast("Gespeichert.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setSaving(false);
        }
    };

    // The panel of the open section. Everything above "Loot-Sync" belongs to the
    // page's one config form; the three standalone sections below save on their
    // own and are rendered outside it (see settingsSections.ts).
    const panel = () => {
        switch (active) {
            case "zugang": return (
                <div className="field">
                    <label>Admin-Rollen (Discord-Rollen-IDs, kommagetrennt)</label>
                    <input type="text" value={draft.adminRoleIdsText} onChange={(e) => patch({ adminRoleIdsText: e.target.value })} placeholder="123456789012345678, 234567890123456789" />
                    <div className="hint">Mitglieder mit einer dieser Rollen erhalten Admin-Zugang. Änderungen greifen für bereits angemeldete Nutzer innerhalb von ca. 5 Minuten, ohne erneuten Login. Die <code>ADMIN_USER_ID</code> aus der .env behält immer Zugang (Notfall-Zugang).</div>
                </div>
            );

            case "berechtigungen": return (
                <RolePermissionsEditor
                    areas={data.areas}
                    roles={data.roles}
                    adminRoleIds={splitList(draft.adminRoleIdsText)}
                    value={draft.rolePermissions}
                    onChange={(rolePermissions) => patch({ rolePermissions })}
                    baseAccess={draft.baseAccess}
                    onBaseAccessChange={(baseAccess) => patch({ baseAccess })}
                    userPermissions={draft.userPermissions}
                    onUserPermissionsChange={(userPermissions) => patch({ userPermissions })}
                    userNames={data.userNames || {}}
                />
            );

            case "discord": return (
                <>
                    <p className="hint">Gegen welchen Server der Bot arbeitet. Beides bleibt Voll-Admins vorbehalten: Die Guild-ID entscheidet, wo der Admin-Rollencheck greift.</p>
                    <div className="field">
                        <label>Discord-Server-ID (Guild-ID)</label>
                        <input type="text" value={draft.guildId} onChange={(e) => patch({ guildId: e.target.value })} placeholder="Discord-Server-ID" />
                        <div className="hint">Der Server, gegen den der Admin-Rollencheck läuft — und der im Menü oben rechts vorausgewählt ist, solange niemand aktiv einen anderen wählt (die Auswahl im Menü gilt nur für die eigene Sitzung). Leer gespeichert greift wieder der Standard-Server des Bots.</div>
                    </div>
                    <div className="field">
                        <label>Raid-Helper Server-ID</label>
                        <input type="text" value={draft.raidhelperServerId} onChange={(e) => patch({ raidhelperServerId: e.target.value })} placeholder="Server-ID von raid-helper.xyz" />
                        <div className="hint">Wird für alle Raid-Helper-API-Aufrufe verwendet (Events, Setups, Anmeldungen). Der API-Key selbst bleibt in der .env.</div>
                    </div>
                </>
            );

            case "battlenet": return (
                <>
                    <p className="hint">Optional: Mit Battle.net-API-Zugang zeigt die Char-Historie das Live-Gear direkt an. Client anlegen unter <code>develop.battle.net</code>.</p>
                    <div className="field">
                        <label>Battle.net Client-ID</label>
                        <input type="text" value={draft.blizzardClientId} onChange={(e) => patch({ blizzardClientId: e.target.value })} placeholder="Client-ID von develop.battle.net" autoComplete="off" />
                    </div>
                    <BlizzardSecretField hasStoredSecret={!!data.config.blizzard.clientSecret} value={secretChange} onChange={setSecretChange} />
                    <div className="field">
                        <label>Region</label>
                        <input type="text" value={draft.blizzardRegion} onChange={(e) => patch({ blizzardRegion: e.target.value })} placeholder="eu" />
                    </div>
                    <div className="field">
                        <label>Realm-Slug</label>
                        <input type="text" value={draft.blizzardRealmSlug} onChange={(e) => patch({ blizzardRealmSlug: e.target.value })} placeholder="thunderstrike" />
                    </div>
                    <div className="field">
                        <label>Profile-Namespace (optional)</label>
                        <input type="text" value={draft.blizzardNamespace} onChange={(e) => patch({ blizzardNamespace: e.target.value })} placeholder={`leer = automatisch (profile-classicann-${draft.blizzardRegion || "eu"})`} />
                    </div>
                </>
            );

            case "kategorien": return (
                <>
                    <p className="hint">
                        Welche Discord-Kategorien Raid-Events enthalten — und für jede davon alles, was sie betrifft:
                        die erwarteten Raider-Rollen, das benutzte Loot-Addon und ein fest zugewiesenes Sheet.
                    </p>
                    <CategoryMatrix
                        categories={data.categories}
                        roles={data.roles}
                        categoryIds={draft.categoryIds}
                        categoryRoles={draft.categoryRoles}
                        categoryLootTool={draft.categoryLootTool}
                        categorySheets={draft.categorySheets}
                        onToggleCategory={toggleCategory}
                        onToggleRole={toggleRole}
                        onLootTool={(id, tool) => patch({ categoryLootTool: { ...draft.categoryLootTool, [id]: tool } })}
                        onSheet={(id, sheet) => patch({ categorySheets: { ...draft.categorySheets, [id]: sheet } })}
                    />
                </>
            );

            case "raids": return (
                <>
                    <p className="hint">Womit ein neues Raid-Event vorbelegt wird, wenn beim Anlegen nichts anderes gewählt ist.</p>
                    <div className="field">
                        <label>Standard-Template-ID</label>
                        <input type="text" value={draft.raidTemplateId} onChange={(e) => patch({ raidTemplateId: e.target.value })} placeholder="Raid-Helper Template-ID" />
                    </div>
                    <div className="field">
                        <label>Standard-Channel-ID</label>
                        <input type="text" value={draft.raidChannelId} onChange={(e) => patch({ raidChannelId: e.target.value })} placeholder="Discord-Channel-ID" />
                    </div>
                </>
            );

            case "loot": return (
                <>
                    <p className="hint">
                        Die richtig großen Drops — Waffen, Legendary-Teile, alles was die Gilde als besonders
                        wertet. Vergibt ein Raid eines dieser Items, hebt das Dashboard die Vergabe hervor.
                        Welches Loot-Addon eine Kategorie benutzt, steht unter „Kategorien".
                    </p>
                    <TopItemsField items={draft.topItems} onChange={(topItems) => patch({ topItems })} />
                </>
            );

            case "logs": return (
                <div className="field">
                    <label>Log-Channel-IDs (kommagetrennt)</label>
                    <input type="text" value={draft.logChannelIdsText} onChange={(e) => patch({ logChannelIdsText: e.target.value })} placeholder="111…, 222…" />
                    <div className="hint">Channels, in denen automatisch Warcraft-Logs gepostet werden.</div>
                </div>
            );

            case "recruitment": return (
                <>
                    <div className="field">
                        <label>Bewerbungs-Channel-ID</label>
                        <input type="text" value={draft.applicationChannelId} onChange={(e) => patch({ applicationChannelId: e.target.value })} placeholder="Discord-Channel-ID" />
                        <div className="hint">Channel, in dem neue Bewerbungen als Thread gepostet werden.</div>
                    </div>
                    <div className="field">
                        <label>Offizier-Rollen-ID</label>
                        <input type="text" value={draft.officerRoleId} onChange={(e) => patch({ officerRoleId: e.target.value })} placeholder="Discord-Rollen-ID" />
                        <div className="hint">Wird bei neuen Bewerbungen gepingt. Leer lassen für keinen Ping.</div>
                    </div>
                </>
            );

            case "auktionen": return (
                <>
                    <div className="field">
                        <label>Höchstgebote-Channel-ID</label>
                        <input type="text" value={draft.highestBidsChannelId} onChange={(e) => patch({ highestBidsChannelId: e.target.value })} placeholder="Discord-Channel-ID" />
                    </div>
                    <div className="field">
                        <label>Höchstgebote-Message-ID</label>
                        <input type="text" value={draft.highestBidsMessageId} onChange={(e) => patch({ highestBidsMessageId: e.target.value })} placeholder="Discord-Message-ID" />
                        <div className="hint">Die Nachricht mit der Höchstgebote-Übersicht, die der Bot aktualisiert.</div>
                    </div>
                </>
            );

            case "lootsync": return <IngestTokensTab csrfToken={csrfToken} />;

            case "raidchars": return <RaiderCharactersTab categories={data.categories} csrfToken={csrfToken} />;

            case "raidsheets": return (
                <RaidsheetsSection
                    sheets={data.raidsheets}
                    csrfToken={csrfToken}
                    onChanged={(msg) => { toast(msg); load(); }}
                />
            );

            default: return null;
        }
    };

    const inForm = savesWithForm(active);
    const body = (
        <>
            <h2 className="section-title">{activeSection.label}</h2>
            {panel()}
        </>
    );

    return (
        <>
            <h1 className="page-title">Einstellungen</h1>
            <p className="note">Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart. IDs bekommst du in Discord per Rechtsklick → „ID kopieren" (Entwicklermodus).</p>

            <div className="settings-layout">
                <SectionNav
                    groups={groupedSections(sections)}
                    active={active}
                    onSelect={setSection}
                    ariaLabel="Einstellungs-Bereiche"
                />
                <div className="settings-panel">
                    {inForm ? (
                        <form className="card-form" onSubmit={submit}>
                            {body}
                            <div className="row-actions">
                                <button className="btn" type="submit" disabled={saving}>{saving ? "Speichert…" : "Speichern"}</button>
                            </div>
                        </form>
                    ) : body}
                </div>
            </div>
        </>
    );
}
