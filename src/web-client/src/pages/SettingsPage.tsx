import { useEffect, useState } from "react";
import {
    getSettings, updateSettings, saveRaidsheet, deleteRaidsheet,
    getRaiderCharacters, saveRaiderCharacters,
    type ApiError, type SettingsData, type AdminConfig, type Category, type Role, type Raidsheet,
    type RaiderCharactersData,
} from "../api";
import { useOutletContext } from "react-router-dom";
import type { ShellContext } from "../components/Shell";

const TABS = [
    { id: "zugang", label: "Zugang" },
    { id: "recruitment", label: "Recruitment" },
    { id: "auktionen", label: "Auktionen" },
    { id: "events", label: "Events" },
    { id: "raidchars", label: "Raider-Chars" },
    { id: "logs", label: "Logs" },
    { id: "raidsheets", label: "Raidsheets" },
];

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Editable form state, mirroring src/web/renderAdmin.js's renderSettings() form
// fields — comma lists stay as raw text while being edited, split on save.
type Draft = {
    adminRoleIdsText: string;
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
};

function toDraft(config: AdminConfig): Draft {
    return {
        adminRoleIdsText: config.adminRoleIds.join(", "),
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
    };
}

function CategoryRoleMatrix({ categories, roles, categoryIds, categoryRoles, onToggleCategory, onToggleRole }: {
    categories: Category[];
    roles: Role[];
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    onToggleCategory: (id: string) => void;
    onToggleRole: (catId: string, roleId: string) => void;
}) {
    const knownIds = new Set(categories.map((c) => c.id));
    const rows = [
        ...categories.map((c) => ({ id: c.id, name: c.name, unknown: false })),
        ...categoryIds.filter((id) => !knownIds.has(id)).map((id) => ({ id, name: id, unknown: true })),
    ];
    const raidRoles = roles.filter((r) => /raid/i.test(r.name || ""));

    if (!rows.length) {
        return <p className="hint">Keine Kategorien geladen (Server gewählt und Bot online?). Die Auswahl ist verfügbar, sobald der Bot verbunden ist.</p>;
    }

    return (
        <>
            {rows.map((cat) => {
                const isEvent = categoryIds.includes(cat.id);
                const assigned = new Set(categoryRoles[cat.id] || []);
                return (
                    <div className="field" key={cat.id}>
                        <label className="switch-row" style={{ fontWeight: 600 }}>
                            <span className="switch">
                                <input type="checkbox" checked={isEvent} onChange={() => onToggleCategory(cat.id)} />
                                <span className="switch-track"><span className="switch-thumb" /></span>
                            </span>
                            {cat.name}
                            {cat.unknown && <span className="hint" style={{ fontWeight: 400 }}> (unbekannte ID — abwählen zum Entfernen)</span>}
                        </label>
                        <div className="rolegrid" style={{ marginTop: 8 }}>
                            {raidRoles.length
                                ? raidRoles.map((r) => (
                                    <label className="rolebox" key={r.id}>
                                        <input type="checkbox" checked={assigned.has(r.id)} onChange={() => onToggleRole(cat.id, r.id)} />
                                        @{r.name}
                                    </label>
                                ))
                                : <span className="hint">—</span>}
                        </div>
                    </div>
                );
            })}
            {!raidRoles.length && <div className="hint">Keine Raid-/Raider-Rollen gefunden. Es werden nur Rollen angeboten, deren Name „Raid" enthält.</div>}
        </>
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
    const [saveError, setSaveError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = () => {
        setInfo(null);
        setLoadError(null);
        setFlash(null);
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
        setSaveError(null);
        try {
            const { assignments } = await saveRaiderCharacters(csrfToken, categoryId, draftMap);
            setDraftMap(assignments);
            setInfo((prev) => (prev ? { ...prev, assignments } : prev));
            setFlash("Gespeichert.");
        } catch (err) {
            setSaveError((err as ApiError).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <p className="hint">
                Raider spielen je nach Raidtag/-typ oft unterschiedliche Charaktere. Hier lässt sich pro Kategorie
                (siehe Tab „Events") festlegen, welchen Charakter ein Raider dort spielt — das überschreibt auf der
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
                <p className="hint">Dieser Kategorie sind noch keine Raider-Rollen zugeordnet (siehe Tab „Events").</p>
            )}
            {info && info.membersError && (
                <p className="sub" style={{ color: "var(--high)" }}>Mitglieder konnten nicht geladen werden: {info.membersError}</p>
            )}
            {info && !!info.roleIds.length && !info.membersError && (
                <form className="card-form" onSubmit={submit}>
                    {saveError && <p className="sub" style={{ color: "var(--high)" }}>{saveError}</p>}
                    {flash && <p className="sub" style={{ color: "var(--good)" }}>{flash}</p>}
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

function RaidsheetForm({ sheet, csrfToken, onSaved, onDeleted }: {
    sheet: Raidsheet | null;
    csrfToken: string | null;
    onSaved: (msg: string) => void;
    onDeleted: (msg: string) => void;
}) {
    const [name, setName] = useState(sheet?.name ?? "");
    const [spreadsheetId, setSpreadsheetId] = useState(sheet?.spreadsheetId ?? "");
    const [sheetName, setSheetName] = useState(sheet?.sheetName ?? "Setup");
    const [gid, setGid] = useState(sheet?.gid === undefined || sheet?.gid === null ? "" : String(sheet.gid));
    const [keywords, setKeywords] = useState((sheet?.keywords ?? []).join(", "));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
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
            setError((err as ApiError).message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!sheet || !confirm("Raidsheet wirklich löschen?")) return;
        setBusy(true);
        try {
            await deleteRaidsheet(csrfToken, sheet.id);
            onDeleted(`Raidsheet „${sheet.name}" gelöscht.`);
        } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
        }
    };

    return (
        <form className="sheetcard" onSubmit={submit}>
            {error && <p className="sub" style={{ color: "var(--high)" }}>{error}</p>}
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
                {sheet && <button className="btn btn-danger" type="button" disabled={busy} onClick={remove}>Löschen</button>}
            </div>
        </form>
    );
}

export default function SettingsPage() {
    const { csrfToken } = useOutletContext<ShellContext>();
    const [data, setData] = useState<SettingsData | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [secretChange, setSecretChange] = useState<string | undefined>(undefined);
    const [error, setError] = useState<ApiError | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [tab, setTab] = useState("zugang");

    const load = () => {
        getSettings()
            .then((d) => {
                setData(d);
                setDraft(toDraft(d.config));
                setSecretChange(undefined);
            })
            .catch((err: ApiError) => setError(err));
    };

    useEffect(load, []);

    if (error) return <div className="empty">Fehler beim Laden der Einstellungen: {error.message}</div>;
    if (!data || !draft) return <div className="empty">Lade…</div>;

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
        setSaveError(null);
        try {
            const { config } = await updateSettings(csrfToken, {
                adminRoleIds: splitList(draft.adminRoleIdsText),
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
            });
            setData({ ...data, config });
            setDraft(toDraft(config));
            setSecretChange(undefined);
            setFlash("Gespeichert.");
        } catch (err) {
            setSaveError((err as ApiError).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <h1 className="page-title">Einstellungen</h1>
            <p className="note">Alle Werte werden in der Datenbank gespeichert und greifen ohne Bot-Neustart. IDs bekommst du in Discord per Rechtsklick → „ID kopieren" (Entwicklermodus).</p>
            {flash && <p className="sub" style={{ color: "var(--good)" }}>{flash}</p>}

            <div className="tabs" role="tablist">
                {TABS.map((t) => (
                    <button key={t.id} type="button" className={`tab-btn${tab === t.id ? " active" : ""}`} role="tab" onClick={() => setTab(t.id)}>
                        {t.label}
                    </button>
                ))}
            </div>

            <form className="card-form" onSubmit={submit}>
                {saveError && <p className="sub" style={{ color: "var(--high)" }}>{saveError}</p>}

                <div className={`tab-panel${tab === "zugang" ? " active" : ""}`} role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Admin-Zugang</h2>
                    <div className="field">
                        <label>Admin-Rollen (Discord-Rollen-IDs, kommagetrennt)</label>
                        <input type="text" value={draft.adminRoleIdsText} onChange={(e) => patch({ adminRoleIdsText: e.target.value })} placeholder="123456789012345678, 234567890123456789" />
                        <div className="hint">Mitglieder mit einer dieser Rollen erhalten Admin-Zugang. Die <code>ADMIN_USER_ID</code> aus der .env behält immer Zugang (Notfall-Zugang).</div>
                    </div>
                </div>

                <div className={`tab-panel${tab === "recruitment" ? " active" : ""}`} role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Recruitment</h2>
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
                </div>

                <div className={`tab-panel${tab === "auktionen" ? " active" : ""}`} role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Auktionen</h2>
                    <div className="field">
                        <label>Höchstgebote-Channel-ID</label>
                        <input type="text" value={draft.highestBidsChannelId} onChange={(e) => patch({ highestBidsChannelId: e.target.value })} placeholder="Discord-Channel-ID" />
                    </div>
                    <div className="field">
                        <label>Höchstgebote-Message-ID</label>
                        <input type="text" value={draft.highestBidsMessageId} onChange={(e) => patch({ highestBidsMessageId: e.target.value })} placeholder="Discord-Message-ID" />
                        <div className="hint">Die Nachricht mit der Höchstgebote-Übersicht, die der Bot aktualisiert.</div>
                    </div>
                </div>

                <div className={`tab-panel${tab === "events" ? " active" : ""}`} role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Event-Kategorien &amp; Raider-Rollen</h2>
                    <p className="hint">Wähle die Kategorien, deren Channels Raid-Events enthalten, und ordne jeder die erwarteten Raider-Rollen zu.</p>
                    <CategoryRoleMatrix
                        categories={data.categories}
                        roles={data.roles}
                        categoryIds={draft.categoryIds}
                        categoryRoles={draft.categoryRoles}
                        onToggleCategory={toggleCategory}
                        onToggleRole={toggleRole}
                    />

                    <h2>Armory / Battle.net API</h2>
                    <p className="hint" style={{ margin: "-6px 0 12px" }}>Optional: Mit Battle.net-API-Zugang zeigt die Char-Historie das Live-Gear direkt an. Client anlegen unter <code>develop.battle.net</code>.</p>
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

                    <h2>Raid-Standardwerte</h2>
                    <div className="field">
                        <label>Standard-Template-ID</label>
                        <input type="text" value={draft.raidTemplateId} onChange={(e) => patch({ raidTemplateId: e.target.value })} placeholder="Raid-Helper Template-ID" />
                    </div>
                    <div className="field">
                        <label>Standard-Channel-ID</label>
                        <input type="text" value={draft.raidChannelId} onChange={(e) => patch({ raidChannelId: e.target.value })} placeholder="Discord-Channel-ID" />
                    </div>
                </div>

                <div className={`tab-panel${tab === "logs" ? " active" : ""}`} role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Log-Auswertung</h2>
                    <div className="field">
                        <label>Log-Channel-IDs (kommagetrennt)</label>
                        <input type="text" value={draft.logChannelIdsText} onChange={(e) => patch({ logChannelIdsText: e.target.value })} placeholder="111…, 222…" />
                        <div className="hint">Channels, in denen automatisch Warcraft-Logs gepostet werden.</div>
                    </div>
                </div>

                {tab !== "raidsheets" && tab !== "raidchars" && (
                    <div className="row-actions">
                        <button className="btn" type="submit" disabled={saving}>{saving ? "Speichert…" : "Speichern"}</button>
                    </div>
                )}
            </form>

            {tab === "raidchars" && (
                <div className="tab-panel active" role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Raider → Charakter je Kategorie</h2>
                    <RaiderCharactersTab categories={data.categories} csrfToken={csrfToken} />
                </div>
            )}

            {tab === "raidsheets" && (
                <div className="tab-panel active" role="tabpanel">
                    <h2 style={{ marginTop: 0 }}>Raidsheets</h2>
                    <p className="note">Google-Sheets nach Content aufgeteilt (Tier 4/5 usw.). Beim Füllen wird anhand der Keywords das passende Sheet vorgeschlagen.</p>
                    {data.raidsheets.map((s) => (
                        <RaidsheetForm key={s.id} sheet={s} csrfToken={csrfToken} onSaved={(msg) => { setFlash(msg); load(); }} onDeleted={(msg) => { setFlash(msg); load(); }} />
                    ))}
                    <h3 style={{ marginTop: 18 }}>Neues Raidsheet</h3>
                    <RaidsheetForm sheet={null} csrfToken={csrfToken} onSaved={(msg) => { setFlash(msg); load(); }} onDeleted={() => {}} />
                </div>
            )}
        </>
    );
}
