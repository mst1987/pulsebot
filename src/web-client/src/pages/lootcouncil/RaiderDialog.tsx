// A raider's details, in a dialog over the list: the numbers once more, then
// three sections — the worn set with where it comes from, the open BiS pieces,
// and the loot received. Everything about one raider that the old roster block
// carried at the same time for every raider (gear band, source pill, log panel,
// sim export) lives here now, one raider at a time.
//
// A local dialog rather than the shared <Modal>: its head carries the raider's
// name in class colour and the role switch, which the shared head (a string
// title) has no place for. Same `.dlg` classes, same native <dialog> behaviour.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CouncilExport, CouncilLog, CouncilRaider, SimResult, WornItem } from "../../api";
import { Badge, Button, IconButton, Modal, PartHead, Segment, WowIcon, buttonClass } from "../../components/ui";
import { AbsenceIcon, CopyIcon, ExternalIcon, XIcon } from "../../components/icons";
import { ReasonBadge } from "../../components/LootBadges";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { ROLE_LABEL, dropHref, gearCounts, wornWowheadUrl } from "./council";
import { ContentBadge, ItemLink, NeedBar, RaiderIdent, WornIcon } from "./parts";

type Section = "gear" | "bis" | "loot";
type LogPick = { reportId?: string; link?: string };

// The slot groups a character sheet reads in (slot ids from
// utils/logcheck/gearIssues.js): armour top to bottom, rings and trinkets, weapons.
const GEAR_GROUPS: { label: string; slots: number[] }[] = [
    { label: "Rüstung", slots: [0, 1, 2, 14, 4, 8, 9, 5, 6, 7] },
    { label: "Ringe & Schmuck", slots: [10, 11, 12, 13] },
    { label: "Waffen", slots: [15, 16, 17] },
];

/** The worn set in three columns, each piece with its icon, name and slot. */
function GearSheet({ items }: { items: WornItem[] }) {
    const groups = GEAR_GROUPS.map((g) => ({ ...g, items: g.slots.flatMap((s) => items.filter((i) => i.slot === s)) }));
    // A slot id the groups do not know still gets shown, under the armour.
    const rest = items.filter((i) => !GEAR_GROUPS.some((g) => g.slots.includes(i.slot)));
    groups[0].items.push(...rest);
    return (
        <div className="lc-sheet">
            {groups.map((g) => (
                <div key={g.label} className="lc-sheet-col">
                    <div className="lc-th">{g.label}</div>
                    {g.items.map((item) => (
                        <div key={`${item.slot}-${item.itemId}`} className="lc-sheet-row">
                            <WornIcon item={item} />
                            <span className="lc-sheet-text">
                                <a href={wornWowheadUrl(item)} target="_blank" rel="noopener noreferrer" {...itemQualityProps(item.quality, "lc-sheet-name")}>
                                    {item.itemName}
                                </a>
                                <span className="lc-sheet-slot">{item.slotName}</span>
                            </span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

/**
 * What the set is and what is wrong with it, as badges: the source with its
 * date, the hit cap, BiS pieces, missing enchants and sockets, and every reason
 * the set on screen is not simply the raider's normal kit.
 */
function GearBadges({ raider }: { raider: CouncilRaider }) {
    const g = raider.gear;
    if (!g) return null;
    const { noench, sockets } = gearCounts(raider);
    const out: ReactNode[] = [];
    if (g.source === "armory") {
        out.push(<Badge key="src" tone="accent" icon="inv_shield_06" tip="Aus der Armory" tipSub={`Aktuelles Gear, geholt ${fmtMs(g.armoryAt, true)}.${g.unverifiedEnchants ? ` ${g.unverifiedEnchants} Teil(e) sind seit der letzten Auswertung dazugekommen — für die ist keine Verzauberung bekannt, die Simulation rechnet sie unverzaubert.` : ""}`}>Armory · {fmtMs(g.armoryAt, true)}</Badge>);
    } else if (g.source === "wcl") {
        out.push(<Badge key="src" tone="accent" icon="inv_scroll_03" tip={`Aus dem Log „${g.reportTitle}“`} tipSub={`Geladen ${fmtMs(g.wclAt, true)}. Gilt, bis eine neuere Auswertung kommt oder „Auswertung“ gewählt wird.`}>Log · {fmtMs(g.seenAt, false)}</Badge>);
    } else {
        out.push(<Badge key="src" icon="inv_misc_pocketwatch_01" tip={`Aus der Auswertung „${g.reportTitle}“`} tipSub={g.skippedReports ? `${g.skippedReports} neuere Auswertung(en) übersprungen, weil dort geheilt oder PvP-Gear getragen wurde.` : "Das Set der letzten Auswertung, in der dieser Raider in seiner Rolle stand."}>Auswertung · {fmtMs(g.seenAt, false)}</Badge>);
    }
    if (g.hitCap > 0) {
        out.push(<Badge key="hit" tone={g.spellHit >= g.hitCap ? "ok" : "mid"} tip="Zaubertrefferwertung" tipSub="Getragen / Obergrenze gegen Bosse. Über der Grenze zählt Hit im Vergleich nicht mehr.">Hit {g.spellHit}/{g.hitCap}</Badge>);
    }
    if (raider.bis.total) out.push(<Badge key="bis" tone="ok" tip="BiS-Teile" tipSub="Getragene Teile der BiS-Liste dieses Raiders.">BiS {raider.bis.owned}/{raider.bis.total}</Badge>);
    if (noench) out.push(<Badge key="noench" tone="bad" tip="Ohne Verzauberung" tipSub="Teile ohne Verzauberung — am Icon mit ! markiert.">{noench} ohne VZ</Badge>);
    if (sockets) out.push(<Badge key="sock" tone="mid" tip="Leere Sockel" tipSub="Am Icon oben rechts markiert.">{sockets} Sockel leer</Badge>);
    if (g.unverifiedEnchants) out.push(<Badge key="unv" tone="mid" tip="Verzauberung unbekannt" tipSub="Seit der letzten Auswertung dazugekommen: Blizzards Verzauberungs-IDs sind nicht die, die WoWSims erwartet, die Simulation rechnet sie unverzaubert.">{g.unverifiedEnchants} ohne VZ-Info</Badge>);
    if (g.pvpGear) out.push(<Badge key="pvp" tone="bad" tip="PvP-Gear" tipSub="Jede der letzten Auswertungen zeigt diesen Raider in PvP-Gear. Ein anderes Set ist nicht bekannt, die Werte sind mit Vorsicht zu lesen.">PvP-Gear</Badge>);
    if (g.roleMismatch) out.push(<Badge key="role" tone="bad" icon="spell_nature_magicimmunity" tip="Andere Rolle" tipSub={`Aus „${g.reportTitle}“ — dort wurde die andere Rolle gespielt. Ein Set der eingeplanten Rolle ist nicht geloggt.`}>{raider.role === "healer" ? "DPS-Gear" : "Heilgear"}</Badge>);
    if (g.logRejected) out.push(<Badge key="logrej" tone={g.logRejected === "pvp" ? "bad" : "mid"} tip={g.logRejected === "pvp" ? "Log: PvP-Gear" : "Log: andere Rolle"} tipSub="Das geladene Log wurde nicht übernommen — bewertet wird weiter das Set aus der Auswertung.">Log abgelehnt</Badge>);
    if (g.armoryRejected) out.push(<Badge key="armrej" tone={g.armoryRejected === "pvp" ? "bad" : "mid"} tip={g.armoryRejected === "pvp" ? "Armory: PvP-Gear" : "Armory: andere Rolle"} tipSub="Die Armory-Antwort wurde nicht übernommen — gegen einen Boss zählt sie nicht, bewertet wird weiter das Set aus dem letzten Raid.">Armory abgelehnt</Badge>);
    if (g.situational) out.push(<Badge key="sit" tone="mid" tip="Situativ" tipSub={`${g.situational} Slot(s) tragen ein bossabhängiges Teil, und keine ältere Auswertung zeigt dort etwas anderes. Der Vergleich liest den Slot als leer.`}>{g.situational} situativ</Badge>);
    if (g.substituted) out.push(<Badge key="sub" tip="Ersetzt" tipSub={`${g.substituted} Slot(s) tragen heute ein Teil, das nur gegen bestimmte Bosse zählt — verglichen wird mit dem, was dort sonst steckt (Icon mit ↺).`}>{g.substituted}× ersetzt</Badge>);
    for (const d of g.dropped) {
        out.push(<Badge key={`drop-${d.slot}`} tone="mid" tip={`${d.slotName} leer`} tipSub={`„${d.itemName}“ ${d.note}. Der Slot zählt als leer, weil keine andere Quelle sagt, was ${raider.character} dort sonst trägt.`}>{d.slotName} leer</Badge>);
    }
    return <>{out}</>;
}

/**
 * Loading a raider's gear from one log: the bot's newest logs, the newest one
 * with this raider, or any Warcraft-Logs link. A log without the raider is only
 * known after trying it, so every row is offered and the toast says so.
 */
function LogPanel({ raider, logs, loading, onLoad }: {
    raider: CouncilRaider;
    logs: CouncilLog[];
    loading: boolean;
    onLoad: (pick: LogPick) => void;
}) {
    const [link, setLink] = useState("");
    const current = raider.gear && raider.gear.source === "wcl" ? raider.gear.reportId : "";
    const submitLink = () => {
        const value = link.trim();
        if (!value || loading) return;
        onLoad({ link: value });
    };
    return (
        <div className="lc-logpanel2" role="region" aria-label={`Gear von ${raider.character} aus einem Log laden`}>
            <div className="lc-logrow2">
                <span className="lc-logrow2-name">
                    <b>Neuestes Log mit {raider.character}</b>
                    <span className="lc-muted">probiert die letzten Logs der Reihe nach</span>
                </span>
                <Button size="sm" variant="run" icon="inv_scroll_03" running={loading} disabled={!logs.length} onClick={() => onLoad({})}>Laden</Button>
            </div>
            {logs.map((log) => (
                <div key={log.reportId} className={`lc-logrow2${log.reportId === current ? " current" : ""}`}>
                    <span className="lc-logrow2-name">
                        <b>{log.title || log.reportId}</b>
                        {log.eventLabel ? <span className="lc-muted">{log.eventLabel}</span> : null}
                        {log.reportId === current ? <Badge tone="ok">geladen</Badge> : null}
                    </span>
                    <span className="lc-logrow2-date">{log.postedAt ? fmtMs(log.postedAt, false) : ""}</span>
                    <Button size="sm" variant="ghost" disabled={loading} onClick={() => onLoad({ reportId: log.reportId })}>Laden</Button>
                </div>
            ))}
            {!logs.length ? <div className="lc-muted">Der Bot kennt noch kein Log — einen Warcraft-Logs-Link einfügen.</div> : null}
            <div className="lc-loglink">
                <input
                    type="text"
                    value={link}
                    placeholder="https://classic.warcraftlogs.com/reports/…"
                    aria-label="Warcraft-Logs-Link"
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitLink(); }}
                />
                <Button size="sm" variant="ghost" disabled={loading || !link.trim()} onClick={submitLink}>Aus Link laden</Button>
            </div>
        </div>
    );
}

/**
 * A raider's loadout as a WoWSims import, so anyone can check our number. Shown
 * rather than downloaded: WoWSims takes it through "Import → From JSON", a
 * paste box. The link goes to the sim page of the right class — the import
 * reads gear and talents from the JSON but not the class.
 */
export function ExportDialog({ data, onClose }: { data: CouncilExport | null; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(data.json);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard blocked — the textarea is still there to select by hand.
            setCopied(false);
        }
    };
    return (
        <Modal
            open={!!data}
            onClose={onClose}
            icon="inv_gizmo_02"
            kicker={data ? `Sim-Export · ${data.specLabel} · Gear vom ${fmtMs(data.seenAt, false)}` : "Sim-Export"}
            title={data ? `WoWSims-Export — ${data.character}` : ""}
            width={720}
            footer={data ? (
                <>
                    <a className={buttonClass("ghost", "md", true)} href={data.simUrl} target="_blank" rel="noreferrer"><ExternalIcon />WoWSims öffnen</a>
                    <Button icon={<CopyIcon />} onClick={copy}>{copied ? "Kopiert" : "JSON kopieren"}</Button>
                </>
            ) : null}
        >
            {data ? (
                <div className="lc-export">
                    <ol className="lc-export-steps">
                        <li>WoWSims öffnen — <b>{data.simUrl.replace("https://", "")}</b> (die Seite muss zur Klasse passen)</li>
                        <li>Oben rechts <b>Import</b> → <b>From JSON</b></li>
                        <li>Das JSON unten einfügen und bestätigen</li>
                        <li><b>Simulate</b> — die DPS sollte der hier angezeigten entsprechen</li>
                    </ol>
                    {data.warnings.length ? <div className="lc-hints">{data.warnings.map((w, i) => <Badge key={i} tone="mid">{w}</Badge>)}</div> : null}
                    <textarea className="lc-export-json" readOnly value={data.json} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
                </div>
            ) : null}
        </Modal>
    );
}

export default function RaiderDialog({
    raider: r, rank, total, sim, canWrite, busy, logs,
    onClose, onRole, onArmory, onLogLoad, onEvaluation, onExport, onExclude,
}: {
    raider: CouncilRaider;
    rank: number;
    total: number;
    sim: SimResult | null;
    canWrite: boolean;
    busy: Set<string>;
    logs: CouncilLog[];
    onClose: () => void;
    onRole: (character: string, role: "" | "caster" | "healer") => void;
    onArmory: (character: string) => void;
    /** Resolves true when the log was taken, so the panel can close. */
    onLogLoad: (character: string, pick: LogPick) => Promise<boolean>;
    onEvaluation: (character: string) => void;
    onExport: (character: string) => void;
    onExclude: (character: string) => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const [section, setSection] = useState<Section>("gear");
    const [logOpen, setLogOpen] = useState(false);
    const g = r.gear;
    const source = g ? g.source : "log";

    useEffect(() => {
        const dlg = ref.current;
        if (dlg && !dlg.open) {
            dlg.showModal();
        }
        return () => { if (dlg && dlg.open) dlg.close(); };
    }, []);

    // Wowheads Tooltip-Widget kennt die Links im Dialog noch nicht.
    useEffect(() => { refreshWowheadLinks(); }, [r, section]);

    const entry = sim && sim[r.key];
    const { noench, sockets } = gearCounts(r);
    const gearIssues = noench + sockets + (g ? g.dropped.length + g.situational : 0);
    const gaps = r.bis.items.filter((i) => !i.owned);
    const loadingLog = busy.has(`loggear:${r.character}`);
    const colored = r.classColor;

    const onSource = (value: "log" | "wcl" | "armory") => {
        if (value === "wcl") { setLogOpen((o) => !o); return; }
        setLogOpen(false);
        if (value === "armory") onArmory(r.character);
        else if (source !== "log") onEvaluation(r.character);
    };

    const sections: { id: Section; label: string; icon: string; count: number; tone?: "mid" }[] = [
        { id: "gear", label: "Gear", icon: "inv_chest_cloth_49", count: gearIssues, tone: gearIssues ? "mid" : undefined },
        { id: "bis", label: "BiS-Lücken", icon: "inv_misc_gem_variety_02", count: gaps.length },
        { id: "loot", label: "Erhaltener Loot", icon: "inv_misc_bag_10", count: r.lootCount },
    ];

    return (
        <dialog
            ref={ref}
            className="dlg lc-dlg"
            aria-label={`Details zu ${r.character}`}
            onCancel={(e) => { e.preventDefault(); onClose(); }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="dlg-inner">
                <div className="dlg-head">
                    <RaiderIdent
                        name={r.character}
                        classColor={colored}
                        specIconUrl={r.specIconUrl}
                        className={r.className}
                        size={44}
                        big
                        sub={<span className="kicker">Loot-Council › Raider · Rang {rank} von {total}</span>}
                    />
                    <span className="lc-dlg-spec">{r.specLabel}{r.className ? ` ${r.className}` : ""}</span>
                    <span className="lc-grow" />
                    {canWrite && r.roleOptions.length > 1 ? (
                        <Segment
                            ariaLabel={`${r.character} einplanen als`}
                            value={r.role}
                            size="sm"
                            onChange={(role) => onRole(r.character, r.roleOverride === role ? "" : role as "caster" | "healer")}
                            options={r.roleOptions.map((o) => ({
                                value: o as "caster" | "healer",
                                label: ROLE_LABEL[o] || o,
                                disabled: busy.has(`role:${r.character}`),
                                tip: r.roleOverride === o
                                    ? "So festgelegt — noch einmal klicken nimmt die Festlegung zurück"
                                    : `Als ${ROLE_LABEL[o] || o} einplanen`,
                            }))}
                        />
                    ) : null}
                    <IconButton icon={<XIcon />} tip="Schließen" size="sm" onClick={onClose} />
                </div>

                <div className="dlg-body lc-dlg-body">
                    <div className="lc-stats">
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip="Bedarf" data-tip-sub="Wartezeit, Loot-Anteil und BiS-Lücke, gewichtet 50 / 40 / 10.">Bedarf</span>
                            <NeedBar width={140} subject={{
                                needScore: r.needScore, needParts: r.needParts, daysSinceLoot: r.daysSinceLoot,
                                lootCount: r.lootCount, bisOwned: r.bis.owned, bisTotal: r.bis.total,
                            }}
                            />
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th">Zuletzt</span>
                            <span className="lc-stat2-v" data-tip={r.lastAwardAt ? `Letztes Item am ${fmtMs(r.lastAwardAt, false)}` : "Hat noch nie ein Item bekommen"}>
                                {r.lastAwardAt ? <>{r.daysSinceLoot} <small>Tage</small></> : <>∞ <small>nie</small></>}
                            </span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip="Items" data-tip-sub="Im Content-Filter · insgesamt. Offspec, Entzaubern und Bank zählen nicht.">Items</span>
                            <span className="lc-stat2-v">{r.lootCount} <small>im Filter · {r.lootTotal} gesamt</small></span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th">BiS</span>
                            <span className="lc-stat2-v">{r.bis.total ? <>{r.bis.owned}<small>/{r.bis.total}</small></> : <small>keine Liste</small>}</span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip="DPS" data-tip-sub="Simuliert mit WoWSims, gleicher Seed für alle.">DPS</span>
                            <span className="lc-stat2-v">
                                {entry && entry.baseline !== null ? <>{Math.round(entry.baseline)} <small>WoWSims</small></> : <small>{r.simSupported ? "nicht simuliert" : "keine Simulation"}</small>}
                            </span>
                        </div>
                    </div>

                    <div className="lc-secs" role="tablist" aria-label="Abschnitte">
                        {sections.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                role="tab"
                                aria-selected={section === s.id}
                                className={`lc-sec${section === s.id ? " active" : ""}`}
                                onClick={() => setSection(s.id)}
                            >
                                <WowIcon name={s.icon} size={20} />
                                {s.label}
                                <span className={`lc-sec-n${s.tone ? ` ${s.tone}` : ""}`}>{s.count}</span>
                            </button>
                        ))}
                    </div>

                    {section === "gear" ? (
                        <>
                            <PartHead
                                icon="inv_chest_cloth_49"
                                title="Getragenes Set"
                                crumb={`${r.character} › Gear`}
                                action={canWrite ? (
                                    <Segment
                                        ariaLabel={`Gear-Quelle für ${r.character}`}
                                        value={logOpen ? "wcl" : source}
                                        onChange={onSource}
                                        options={[
                                            { value: "log", label: "Auswertung", icon: "inv_misc_pocketwatch_01", disabled: loadingLog,
                                                tip: source === "log" ? "Das Set aus der letzten Auswertung" : "Zurück zum Set aus der letzten Auswertung" },
                                            { value: "wcl", label: "Log", icon: "inv_scroll_03",
                                                tip: "Gear aus einem Log laden: eines der letzten Logs des Bots oder ein Warcraft-Logs-Link" },
                                            { value: "armory", label: "Armory", icon: "inv_shield_06", disabled: busy.has(`armory:${r.character}`),
                                                tip: source === "armory" ? "Gear noch einmal aus der Armory holen" : "Gear aus der Armory holen — der Stand von jetzt" },
                                        ]}
                                    />
                                ) : undefined}
                            />
                            <div className="lc-hints lc-gearbadges">
                                <GearBadges raider={r} />
                                {r.armoryUrl ? (
                                    <a className="lc-extlink" href={r.armoryUrl} target="_blank" rel="noopener noreferrer">
                                        Armory im Browser <ExternalIcon />
                                    </a>
                                ) : null}
                            </div>
                            {logOpen ? (
                                <LogPanel
                                    raider={r}
                                    logs={logs}
                                    loading={loadingLog}
                                    onLoad={async (pick) => { if (await onLogLoad(r.character, pick)) setLogOpen(false); }}
                                />
                            ) : null}
                            {g && g.items.length
                                ? <GearSheet items={g.items} />
                                : <div className="empty lc-empty">Kein Gear bekannt — in keiner Auswertung gesehen. Oben ein Log laden oder die Armory holen.</div>}
                        </>
                    ) : null}

                    {section === "bis" ? (
                        <>
                            <PartHead
                                icon="inv_misc_gem_variety_02"
                                title="Offene BiS-Teile"
                                crumb={`${r.character} › BiS-Lücken`}
                                tip={r.bis.sourceLabel || "BiS-Liste"}
                                tipSub={[
                                    r.bis.source === "wowhead" ? "Geschriebene Wowhead-Liste: nennt Items, keine Sockel und keine Verzauberungen." : "Simuliertes WoWSims-Set.",
                                    r.bis.borrowedFrom ? `Liste von ${r.bis.borrowedFrom}.` : "",
                                    r.bis.tier ? `Tier ${r.bis.tier.toUpperCase()}${r.bis.exact ? "" : " (neueste verfügbare Liste)"}.` : "",
                                ].filter(Boolean).join(" ")}
                                action={r.bis.total ? <Badge tone="ok">{r.bis.owned}/{r.bis.total} getragen</Badge> : undefined}
                            />
                            {!r.bis.total ? (
                                <div className="empty lc-empty">Für diese Spec und dieses Tier gibt es keine BiS-Liste.</div>
                            ) : !gaps.length ? (
                                <div className="empty lc-empty">Trägt die ganze Liste.</div>
                            ) : (
                                <div className="lc-dlist">
                                    {gaps.map((item) => (
                                        <div key={item.id} className="lc-dlist-row">
                                            <ItemLink id={item.id} name={item.name} iconUrl={item.iconUrl} quality={item.quality} />
                                            <ContentBadge contentId={item.contentId} label={item.boss} />
                                            <span className="lc-muted">{item.boss}{item.ilvl ? ` · ilvl ${item.ilvl}` : ""}</span>
                                            <Link className={buttonClass("ghost", "sm", true, "lc-dlist-act")} to={dropHref(item.id)}>
                                                <WowIcon name="inv_misc_bag_10" size={18} />Als Drop prüfen
                                            </Link>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : null}

                    {section === "loot" ? (
                        <>
                            <PartHead
                                icon="inv_misc_bag_10"
                                title="Erhaltener Loot"
                                crumb={`${r.character} › Loot`}
                                tip="Im Content-Filter"
                                tipSub="Offspec, Entzaubern und Bank zählen nicht als erhaltener Loot."
                                action={<Badge count>{r.lootCount}</Badge>}
                            />
                            {r.items.length ? (
                                <div className="lc-dlist">
                                    {r.items.map((item, i) => (
                                        <div key={`${item.itemId}-${item.awardedAt}-${i}`} className="lc-dlist-row">
                                            <ItemLink id={item.itemId} name={item.itemName} iconUrl={item.itemIconUrl} quality={item.itemQuality} />
                                            <ContentBadge contentId={item.contentId} tier={item.tier} />
                                            {item.reasonLabel ? <ReasonBadge label={item.reasonLabel} tone={item.reasonTone} title={item.reason} /> : <span />}
                                            <span className="lc-muted">{item.eventLabel}</span>
                                            <span className="lc-dlist-date">{item.awardedAt ? fmtMs(item.awardedAt, false) : ""}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="empty lc-empty">Im gewählten Content nichts bekommen.</div>
                            )}
                            {r.otherCount ? <div className="lc-muted lc-note">Dazu {r.otherCount} × Offspec, Entzaubern oder Bank — zählt nicht als erhaltener Loot.</div> : null}
                        </>
                    ) : null}
                </div>

                <div className="dlg-foot lc-dlg-foot">
                    {canWrite ? (
                        <Button variant="danger" size="sm" icon={<AbsenceIcon />} running={busy.has(`exclude:${r.character}`)} onClick={() => onExclude(r.character)}>
                            Nicht einplanen
                        </Button>
                    ) : null}
                    {g && r.simSupported ? (
                        <Button variant="ghost" size="sm" icon="inv_gizmo_02" running={busy.has(`export:${r.character}`)} onClick={() => onExport(r.character)}>
                            Sim-Export
                        </Button>
                    ) : null}
                    <span className="lc-grow" />
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    {canWrite ? (
                        <Button variant="run" icon="inv_shield_06" running={busy.has(`armory:${r.character}`)} onClick={() => onArmory(r.character)}>
                            Gear aus Armory holen
                        </Button>
                    ) : null}
                </div>
            </div>
        </dialog>
    );
}
