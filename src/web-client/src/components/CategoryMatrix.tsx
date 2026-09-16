import { Fragment, useCallback, useEffect, useState } from "react";
import { getRaiderCharacters, type Category, type EventSource, type Role } from "../api";
import { usePersistedState } from "../lib/persistedState";
import {
    categoryRows, splitCategoryRows, summarizeRaiderChars, type CategoryRow, type RaiderCharSummary,
} from "../lib/settingsLogic";
import { Button } from "./ui/Button";
import Badge from "./ui/Badge";
import Expand from "./ui/Expand";
import PartHead from "./ui/PartHead";
import Segment from "./ui/Segment";
import WowIcon from "./ui/WowIcon";
import RaiderCharactersModal from "./RaiderCharactersModal";
import { CheckMark, FieldLabel, WarnIcon } from "./settingsUi";

// Everything that is configured *per raid category*, as one list instead of a
// card per Discord category: active switch, raider roles, where new events are
// created (Raid-Helper / EventHelper), loot addon, fixed sheet and the raider →
// character assignment, which used to be a section of
// its own with a second category picker. One row opens at a time.
//
// The guild's Discord holds far more categories than raid ones (typically 13 of
// 17 are not), so the inactive ones fold away under one line; the part head's
// segment shows them all. A configured id Discord no longer knows stays visible
// with a `bad` badge — dropping it would delete its settings on the next save.

export type CategorySheet = { url: string; name: string };

export type CategoryRaidTemplates = {
    options: { id: string; name: string }[];
    value: Record<string, string>;
    onChange: (categoryId: string, templateId: string) => void;
};

const LOOT_TOOLS = [
    { value: "gargul", label: "Gargul" },
    { value: "rclc", label: "RCLootcouncil" },
    { value: "", label: "keins" },
];

// Where NEW events of the category are created. Raid-Helper events stay in use either way.
const SIGNUP_SOURCES = [
    { value: "raidhelper", label: "Raid-Helper" },
    { value: "eventhelper", label: "EventHelper" },
];

export default function CategoryMatrix({
    categories, roles, categoryIds, categoryRoles, categoryLootTool, categorySignupSource = {}, categorySetupDms = {}, categorySheets, savedCategoryRoles,
    onToggleCategory, onToggleRole, onLootTool, onSignupSource, onSetupDms, onSheet, csrfToken, icon, crumb, raidTemplates,
}: {
    /** The default raid template per category (#266): the choices, the draft map and its setter. */
    raidTemplates?: CategoryRaidTemplates;
    categories: Category[];
    roles: Role[];
    categoryIds: string[];
    categoryRoles: Record<string, string[]>;
    categoryLootTool: Record<string, string>;
    /** Missing = "raidhelper". */
    categorySignupSource?: Record<string, EventSource>;
    /** Setup-DMs per category (#290); missing = off. */
    categorySetupDms?: Record<string, boolean>;
    categorySheets: Record<string, CategorySheet>;
    /** The saved roles — the assignment modal works on those, not on the draft. */
    savedCategoryRoles: Record<string, string[]>;
    onToggleCategory: (id: string) => void;
    onToggleRole: (categoryId: string, roleId: string) => void;
    onLootTool: (categoryId: string, tool: string) => void;
    onSignupSource: (categoryId: string, source: EventSource) => void;
    onSetupDms?: (categoryId: string, on: boolean) => void;
    onSheet: (categoryId: string, sheet: CategorySheet) => void;
    csrfToken: string | null;
    icon: string;
    crumb: string;
}) {
    const [showAll, setShowAll] = usePersistedState("settings-categories-all", false);
    const [openId, setOpenId] = useState("");
    const [foldOpen, setFoldOpen] = useState(false);
    const [assigning, setAssigning] = useState<CategoryRow | null>(null);
    const [chars, setChars] = useState<Record<string, RaiderCharSummary>>({});

    const configured = [
        ...categoryIds,
        ...Object.keys(categoryRoles),
        ...Object.keys(categoryLootTool),
        ...Object.keys(categorySignupSource),
        ...Object.keys(categorySetupDms).filter((id) => categorySetupDms[id]),
        ...Object.keys(categorySheets),
    ];
    const rows = categoryRows(categories, configured);
    const { shown, folded } = splitCategoryRows(rows, categoryIds, showAll);
    // Only roles whose name says "raid" are offered — plus any already assigned —
    // to keep a guild's dozens of cosmetic roles out of the picker.
    const roleOptions = (catId: string) => {
        const assigned = new Set(categoryRoles[catId] || []);
        return roles.filter((r) => /raid/i.test(r.name || "") || assigned.has(r.id));
    };

    // The "22 / 25" of every category that has saved raider roles. One request
    // per category, best-effort: a failure leaves the cell at "–".
    const savedKey = JSON.stringify(savedCategoryRoles);
    const loadChars = useCallback((ids: string[]) => {
        for (const id of ids) {
            getRaiderCharacters(id)
                .then((info) => setChars((prev) => ({ ...prev, [id]: summarizeRaiderChars(info) })))
                .catch(() => undefined);
        }
    }, []);
    useEffect(() => {
        const withRoles = Object.entries(JSON.parse(savedKey) as Record<string, string[]>)
            .filter(([, ids]) => ids && ids.length)
            .map(([id]) => id);
        loadChars(withRoles);
    }, [savedKey, loadChars]);

    const activeCount = categoryIds.filter((id) => rows.some((r) => r.id === id)).length;

    const partHead = (
        <PartHead
            icon={icon}
            tone="settings"
            title="Kategorien"
            crumb={`Einstellungen › ${crumb}`}
            action={(
                <Segment
                    size="sm"
                    ariaLabel="Welche Kategorien"
                    value={showAll ? "all" : "raid"}
                    onChange={(v) => setShowAll(v === "all")}
                    options={[
                        { value: "raid", label: `Raid-Kategorien ${activeCount}` },
                        { value: "all", label: `Alle Discord-Kategorien ${rows.length}` },
                    ]}
                />
            )}
        />
    );

    if (!rows.length) {
        return (
            <>
                {partHead}
                <div className="empty">Keine Kategorien geladen (Server gewählt und Bot online?). Die Liste erscheint, sobald der Bot verbunden ist.</div>
            </>
        );
    }

    const row = (cat: CategoryRow) => {
        const active = categoryIds.includes(cat.id);
        const assigned = categoryRoles[cat.id] || [];
        const tool = categoryLootTool[cat.id] || "";
        const signupSource: EventSource = categorySignupSource[cat.id] || "raidhelper";
        const sheet = categorySheets[cat.id] || { url: "", name: "" };
        const summary = chars[cat.id];
        const isOpen = openId === cat.id && active;
        const openCount = summary ? summary.members - summary.assigned : 0;
        return (
            <Fragment key={cat.id}>
                <div className={`cat-row${active ? " is-on" : ""}${isOpen ? " is-open" : ""}`} data-category={cat.id}>
                    <label className="switch" data-tip={active ? "Raid-Kategorie" : "keine Raid-Kategorie"} data-tip-sub="Kanäle dieser Kategorie enthalten Raid-Events.">
                        <input type="checkbox" checked={active} onChange={() => onToggleCategory(cat.id)} aria-label={`${cat.name} als Raid-Kategorie`} />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                    </label>
                    <div className="cat-name">
                        <span>{cat.name}</span>
                        {cat.unknown && (
                            <Badge tone="bad" icon={<WarnIcon />} tip="Unbekannte Kategorie" tipSub="Diese ID ist konfiguriert, existiert in Discord aber nicht mehr. Abwählen und speichern entfernt sie.">
                                unbekannt
                            </Badge>
                        )}
                    </div>
                    {active ? (
                        <>
                            <div>{assigned.length
                                ? <Badge tone="accent">{assigned.length} {assigned.length === 1 ? "Rolle" : "Rollen"}</Badge>
                                : <Badge tone="bad" icon={<WarnIcon />}>keine</Badge>}
                            </div>
                            <div>{tool
                                ? <Badge icon="inv_misc_bag_10">{tool === "gargul" ? "Gargul" : "RCLootcouncil"}</Badge>
                                : <Badge tone="mid" icon={<WarnIcon />}>fehlt</Badge>}
                            </div>
                            <div>{sheet.url
                                ? <Badge tone="ok" icon="inv_scroll_03" tip={sheet.name || "Festes Raidsheet"} tipSub={sheet.url}>{sheet.name || "Sheet"}</Badge>
                                : <Badge>kein Sheet</Badge>}
                            </div>
                            <div>{summary && summary.members
                                ? <Badge tone={openCount ? "mid" : "ok"} tip="Raider → Charakter" tipSub={`${summary.assigned} von ${summary.members} Raidern haben einen festen Charakter.`}>{summary.assigned} / {summary.members}</Badge>
                                : <Badge>–</Badge>}
                            </div>
                            <Expand open={isOpen} onToggle={() => setOpenId(isOpen ? "" : cat.id)} showLabel={!isOpen} />
                        </>
                    ) : <div className="cat-off note">keine Raid-Events</div>}
                </div>
                {isOpen && (
                    <div className="cat-detail">
                        <div className="cat-detail-col">
                            <div>
                                <FieldLabel tip="Raider-Rollen" tipSub="Wer eine dieser Rollen hat, gilt bei Raids dieser Kategorie als erwarteter Raider (Anwesenheit, fehlende Anmeldungen, Charakter-Zuordnung). Angeboten werden Rollen mit „Raid“ im Namen.">Raider-Rollen</FieldLabel>
                                <div className="chip-row">
                                    {roleOptions(cat.id).length ? roleOptions(cat.id).map((r) => {
                                        const on = assigned.includes(r.id);
                                        return (
                                            <button key={r.id} type="button" className={`badge chip${on ? " accent" : ""}`} aria-pressed={on} onClick={() => onToggleRole(cat.id, r.id)}>
                                                {on && <CheckMark />}@{r.name}
                                            </button>
                                        );
                                    }) : <span className="note">Keine Rolle gefunden, deren Name „Raid“ enthält.</span>}
                                </div>
                            </div>
                            <div>
                                <FieldLabel tip="Raider → Charakter" tipSub="Welchen Charakter ein Raider in dieser Kategorie spielt. Überschreibt auf der Event-Detailseite die automatische Erkennung aus vergangenen Anmeldungen.">Raider → Charakter</FieldLabel>
                                <div className="rch-summary">
                                    {summary && summary.members ? (
                                        <>
                                            <span><b>{summary.assigned}</b> <span className="note">von {summary.members} fest</span></span>
                                            {openCount > 0 ? <Badge tone="mid">{openCount} offen</Badge> : <Badge tone="ok">alle fest</Badge>}
                                        </>
                                    ) : (
                                        <span className="note">{(savedCategoryRoles[cat.id] || []).length ? "noch keine Raider gefunden" : "erst Raider-Rollen speichern"}</span>
                                    )}
                                    <span className="grow" />
                                    <Button variant="ghost" size="sm" icon="ability_rogue_disguise" onClick={() => setAssigning(cat)}
                                        disabled={!(savedCategoryRoles[cat.id] || []).length}>
                                        Zuordnen
                                    </Button>
                                </div>
                            </div>
                        </div>
                        <div className="cat-detail-col">
                            <div>
                                <FieldLabel tip="Neue Events" tipSub="Wo neue Events dieser Kategorie angelegt werden. Raid-Helper-Events werden in jedem Fall weiter mitgenutzt – in Listen, Anwesenheit, Log- und Loot-Zuordnung.">Neue Events</FieldLabel>
                                <Segment ariaLabel={`Neue Events ${cat.name}`} value={signupSource} onChange={(v) => onSignupSource(cat.id, v as EventSource)} options={SIGNUP_SOURCES} />
                            </div>
                            {onSetupDms && (
                                <div className="cat-switch-row">
                                    <FieldLabel tip="Setup-DMs" tipSub="Nach der Freigabe bekommt jeder Raider eines EventHelper-Events eine DM: „Du bist in Gruppe 2 als Heiler“ bzw. „Diesmal Bank“. Nur wessen Platz sich geändert hat, bekommt bei erneuter Freigabe wieder eine. Das Setup im Kanal wird immer gepostet.">Setup-DMs</FieldLabel>
                                    <label className="switch">
                                        <input type="checkbox" checked={categorySetupDms[cat.id] === true} onChange={() => onSetupDms(cat.id, categorySetupDms[cat.id] !== true)} aria-label={`Setup-DMs ${cat.name}`} />
                                        <span className="switch-track"><span className="switch-thumb" /></span>
                                    </label>
                                </div>
                            )}
                            <div>
                                <FieldLabel tip="Loot-Addon" tipSub="Wählt beim Loot-Import den passenden Parser vor und sagt dem Loot-Tab der Raid-Detailseite, welchen Export er erwartet.">Loot-Addon</FieldLabel>
                                <Segment ariaLabel={`Loot-Addon ${cat.name}`} value={tool} onChange={(v) => onLootTool(cat.id, v)} options={LOOT_TOOLS} />
                            </div>
                            {raidTemplates && (
                                <div>
                                    <FieldLabel htmlFor={`cattpl-${cat.id}`} tip="Standard-Vorlage" tipSub="Die Raid-Vorlage, von der ein neues Event dieser Kategorie ausgeht. Solange sie Standard ist, lässt sie sich nicht löschen. Vorlagen pflegst du unter Raid-Events › Raid-Vorlagen.">Standard-Vorlage</FieldLabel>
                                    <select id={`cattpl-${cat.id}`} value={raidTemplates.value[cat.id] || ""} onChange={(e) => raidTemplates.onChange(cat.id, e.target.value)}>
                                        <option value="">— keine —</option>
                                        {raidTemplates.options.map((t) => <option key={t.id} value={t.id}>{t.name || "(ohne Name)"}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <FieldLabel htmlFor={`catsheet-name-${cat.id}`} tip="Festes Raidsheet" tipSub="Jeder Raid dieser Kategorie verlinkt dieses Sheet — außer für den Raid selbst wurde eins erstellt. Vorlagen nach Keywords: Module › Raidsheets.">Festes Raidsheet</FieldLabel>
                                <div className="sheet-field">
                                    <WowIcon name="inv_scroll_03" size={20} />
                                    <div className="sheet-inputs">
                                        <input id={`catsheet-name-${cat.id}`} type="text" value={sheet.name} placeholder="Anzeigename, z. B. „T6 Setup – Hyjal/BT“"
                                            onChange={(e) => onSheet(cat.id, { ...sheet, name: e.target.value })} />
                                        <input type="url" className="mono" aria-label="Link des Sheets" value={sheet.url} placeholder="https://docs.google.com/spreadsheets/… (leer = keins)"
                                            onChange={(e) => onSheet(cat.id, { ...sheet, url: e.target.value })} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Fragment>
        );
    };

    return (
        <>
            {partHead}
            <div className="cat-list table-scroll">
                <div className="cat-inner">
                    <div className="cat-row cat-head" aria-hidden="true">
                        <span>Aktiv</span><span>Kategorie</span><span>Raider-Rollen</span><span>Loot-Addon</span><span>Raidsheet</span><span>Chars</span><span />
                    </div>
                    {shown.map(row)}
                    {!shown.length && <div className="empty">Noch keine Raid-Kategorie — unten eine Discord-Kategorie einschalten.</div>}
                    {folded.length > 0 && (
                        <>
                            <div className="cat-fold">
                                <span className="note">{folded.length} weitere Discord-{folded.length === 1 ? "Kategorie" : "Kategorien"} ohne Raid-Events</span>
                                <span className="cat-fold-names mono">{folded.slice(0, 4).map((c) => c.name).join(", ")}{folded.length > 4 ? " …" : ""}</span>
                                <Expand open={foldOpen} onToggle={() => setFoldOpen(!foldOpen)} />
                            </div>
                            {foldOpen && folded.map(row)}
                        </>
                    )}
                </div>
            </div>

            {assigning && (
                <RaiderCharactersModal
                    categoryId={assigning.id}
                    categoryName={assigning.name}
                    csrfToken={csrfToken}
                    onClose={() => setAssigning(null)}
                    onSaved={(info) => {
                        setChars((prev) => ({ ...prev, [assigning.id]: summarizeRaiderChars(info) }));
                        setAssigning(null);
                    }}
                />
            )}
        </>
    );
}
