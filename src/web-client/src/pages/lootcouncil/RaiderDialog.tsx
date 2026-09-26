// A raider's details, in a dialog over the list: the numbers once more, then
// three sections — the worn set with where it comes from, the open BiS pieces,
// and the loot received. Everything about one raider that the old roster block
// carried at the same time for every raider (gear band, source pill, log panel,
// sim export) lives here now, one raider at a time.
//
// A local dialog rather than the shared <Modal>: its head carries the raider's
// name in class colour and the role switch, which the shared head (a string
// title) has no place for. Same `.dlg` classes, same native <dialog> behaviour.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CouncilExport, CouncilLog, CouncilRaider, SimResult, WornItem } from "../../api";
import { Badge, Button, IconButton, Modal, PartHead, Segment, WowIcon, buttonClass } from "../../components/ui";
import { AbsenceIcon, CopyIcon, ExternalIcon, XIcon } from "../../components/icons";
import { ReasonBadge } from "../../components/loot/LootBadges";
import { useT } from "../../i18n";
import { fmtMs } from "../../lib/format";
import { itemQualityProps } from "../../lib/itemQuality";
import { refreshWowheadLinks } from "../../lib/wowheadTooltips";
import { dropHref, gearCounts, roleLabel, wornWowheadUrl } from "./council";
import { ContentBadge, ItemLink, RaiderIdent } from "./ItemBits";
import { GearBadges, WornIcon } from "./GearBadges";
import { NeedBar } from "./NeedBar";

type Section = "gear" | "bis" | "loot";
type LogPick = { reportId?: string; link?: string };

// The slot groups a character sheet reads in (slot ids from
// utils/logcheck/gearIssues.js): armour top to bottom, rings and trinkets, weapons.
// The group names are keys (lootcouncil.dialog.sheet.*), translated at render.
const GEAR_GROUPS: { id: string; slots: number[] }[] = [
    { id: "armour", slots: [0, 1, 2, 14, 4, 8, 9, 5, 6, 7] },
    { id: "jewellery", slots: [10, 11, 12, 13] },
    { id: "weapons", slots: [15, 16, 17] },
];

/** The worn set in three columns, each piece with its icon, name and slot. */
function GearSheet({ items }: { items: WornItem[] }) {
    const t = useT();
    const groups = GEAR_GROUPS.map((g) => ({ ...g, items: g.slots.flatMap((s) => items.filter((i) => i.slot === s)) }));
    // A slot id the groups do not know still gets shown, under the armour.
    const rest = items.filter((i) => !GEAR_GROUPS.some((g) => g.slots.includes(i.slot)));
    groups[0].items.push(...rest);
    return (
        <div className="lc-sheet">
            {groups.map((g) => (
                <div key={g.id} className="lc-sheet-col">
                    <div className="lc-th">{t(`lootcouncil.dialog.sheet.${g.id}`)}</div>
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
    const t = useT();
    const [link, setLink] = useState("");
    const current = raider.gear && raider.gear.source === "wcl" ? raider.gear.reportId : "";
    const submitLink = () => {
        const value = link.trim();
        if (!value || loading) return;
        onLoad({ link: value });
    };
    return (
        <div className="lc-logpanel2" role="region" aria-label={t("lootcouncil.dialog.log.aria", { character: raider.character })}>
            <div className="lc-logrow2">
                <span className="lc-logrow2-name">
                    <b>{t("lootcouncil.dialog.log.newest", { character: raider.character })}</b>
                    <span className="lc-muted">{t("lootcouncil.dialog.log.newestSub")}</span>
                </span>
                <Button size="sm" variant="run" icon="inv_scroll_03" running={loading} disabled={!logs.length} onClick={() => onLoad({})}>{t("lootcouncil.dialog.log.load")}</Button>
            </div>
            {logs.map((log) => (
                <div key={log.reportId} className={`lc-logrow2${log.reportId === current ? " current" : ""}`}>
                    <span className="lc-logrow2-name">
                        <b>{log.title || log.reportId}</b>
                        {log.eventLabel ? <span className="lc-muted">{log.eventLabel}</span> : null}
                        {log.reportId === current ? <Badge tone="ok">{t("lootcouncil.dialog.log.loaded")}</Badge> : null}
                    </span>
                    <span className="lc-logrow2-date">{log.postedAt ? fmtMs(log.postedAt, false) : ""}</span>
                    <Button size="sm" variant="ghost" disabled={loading} onClick={() => onLoad({ reportId: log.reportId })}>{t("lootcouncil.dialog.log.load")}</Button>
                </div>
            ))}
            {!logs.length ? <div className="lc-muted">{t("lootcouncil.dialog.log.none")}</div> : null}
            <div className="lc-loglink">
                <input
                    type="text"
                    value={link}
                    placeholder="https://classic.warcraftlogs.com/reports/…"
                    aria-label={t("lootcouncil.dialog.log.linkAria")}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitLink(); }}
                />
                <Button size="sm" variant="ghost" disabled={loading || !link.trim()} onClick={submitLink}>{t("lootcouncil.dialog.log.fromLink")}</Button>
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
    const t = useT();
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
            kicker={data ? t("lootcouncil.dialog.export.kicker", { spec: data.specLabel, date: fmtMs(data.seenAt, false) }) : t("lootcouncil.dialog.export.name")}
            title={data ? t("lootcouncil.dialog.export.title", { character: data.character }) : ""}
            width={720}
            footer={data ? (
                <>
                    <a className={buttonClass("ghost", "md", true)} href={data.simUrl} target="_blank" rel="noreferrer"><ExternalIcon />{t("lootcouncil.dialog.export.open")}</a>
                    <Button icon={<CopyIcon />} onClick={copy}>{copied ? t("common.copied") : t("lootcouncil.dialog.export.copyJson")}</Button>
                </>
            ) : null}
        >
            {data ? (
                <div className="lc-export">
                    <ol className="lc-export-steps">
                        <li>{t("lootcouncil.dialog.export.step1")} <b>{data.simUrl.replace("https://", "")}</b> {t("lootcouncil.dialog.export.step1Note")}</li>
                        <li>{t("lootcouncil.dialog.export.step2")} <b>Import</b> → <b>From JSON</b></li>
                        <li>{t("lootcouncil.dialog.export.step3")}</li>
                        <li><b>Simulate</b> {t("lootcouncil.dialog.export.step4")}</li>
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
    const t = useT();
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
    const { noench, sockets } = gearCounts(g ? g.items : []);
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
        { id: "gear", label: t("lootcouncil.dialog.section.gear"), icon: "inv_chest_cloth_49", count: gearIssues, tone: gearIssues ? "mid" : undefined },
        { id: "bis", label: t("lootcouncil.dialog.section.bis"), icon: "inv_misc_gem_variety_02", count: gaps.length },
        { id: "loot", label: t("lootcouncil.dialog.section.loot"), icon: "inv_misc_bag_10", count: r.lootCount },
    ];

    return (
        <dialog
            ref={ref}
            className="dlg lc-dlg"
            aria-label={t("lootcouncil.list.detailsAria", { character: r.character })}
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
                        sub={<span className="kicker">{t("lootcouncil.dialog.kicker", { rank, total })}</span>}
                    />
                    <span className="lc-dlg-spec">{r.specLabel}{r.className ? ` ${r.className}` : ""}</span>
                    <span className="lc-grow" />
                    {canWrite && r.roleOptions.length > 1 ? (
                        <Segment
                            ariaLabel={t("lootcouncil.dialog.roleAria", { character: r.character })}
                            value={r.role}
                            size="sm"
                            onChange={(role) => onRole(r.character, r.roleOverride === role ? "" : role as "caster" | "healer")}
                            options={r.roleOptions.map((o) => ({
                                value: o as "caster" | "healer",
                                label: roleLabel(o),
                                disabled: busy.has(`role:${r.character}`),
                                tip: r.roleOverride === o
                                    ? t("lootcouncil.dialog.roleFixed")
                                    : t("lootcouncil.dialog.rolePlanAs", { role: roleLabel(o) }),
                            }))}
                        />
                    ) : null}
                    <IconButton icon={<XIcon />} tip={t("common.close")} size="sm" onClick={onClose} />
                </div>

                <div className="dlg-body lc-dlg-body">
                    <div className="lc-stats">
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip={t("lootcouncil.word.need")} data-tip-sub={t("lootcouncil.dialog.needTipSub")}>{t("lootcouncil.word.need")}</span>
                            <NeedBar width={140} subject={{
                                needScore: r.needScore, needParts: r.needParts, daysSinceLoot: r.daysSinceLoot,
                                lootCount: r.lootCount, bisOwned: r.bis.owned, bisTotal: r.bis.total,
                            }}
                            />
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th">{t("lootcouncil.word.last")}</span>
                            <span className="lc-stat2-v" data-tip={r.lastAwardAt ? t("lootcouncil.waited.lastAward", { date: fmtMs(r.lastAwardAt, false) }) : t("lootcouncil.waited.never")}>
                                {r.lastAwardAt ? <>{r.daysSinceLoot} <small>{t("lootcouncil.word.daysUnit")}</small></> : <>∞ <small>{t("lootcouncil.word.never")}</small></>}
                            </span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip={t("lootcouncil.word.items")} data-tip-sub={t("lootcouncil.dialog.itemsTipSub")}>{t("lootcouncil.word.items")}</span>
                            <span className="lc-stat2-v">{r.lootCount} <small>{t("lootcouncil.dialog.itemsSub", { total: r.lootTotal })}</small></span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th">BiS</span>
                            <span className="lc-stat2-v">{r.bis.total ? <>{r.bis.owned}<small>/{r.bis.total}</small></> : <small>{t("lootcouncil.word.noList")}</small>}</span>
                        </div>
                        <div className="lc-stat2">
                            <span className="lc-th tipped" data-tip="DPS" data-tip-sub={t("lootcouncil.dialog.dpsTipSub")}>DPS</span>
                            <span className="lc-stat2-v">
                                {entry && entry.baseline !== null ? <>{Math.round(entry.baseline)} <small>WoWSims</small></> : <small>{r.simSupported ? t("lootcouncil.sim.notSimulated") : t("lootcouncil.dialog.noSim")}</small>}
                            </span>
                        </div>
                    </div>

                    <div className="lc-secs" role="tablist" aria-label={t("lootcouncil.dialog.sections")}>
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
                                title={t("lootcouncil.dialog.gearTitle")}
                                crumb={t("lootcouncil.dialog.gearCrumb", { character: r.character })}
                                action={canWrite ? (
                                    <Segment
                                        ariaLabel={t("lootcouncil.dialog.sourceAria", { character: r.character })}
                                        value={logOpen ? "wcl" : source}
                                        onChange={onSource}
                                        options={[
                                            { value: "log", label: t("lootcouncil.gear.evaluation"), icon: "inv_misc_pocketwatch_01", disabled: loadingLog,
                                                tip: source === "log" ? t("lootcouncil.dialog.sourceLogTip") : t("lootcouncil.dialog.sourceLogBackTip") },
                                            { value: "wcl", label: "Log", icon: "inv_scroll_03",
                                                tip: t("lootcouncil.dialog.sourceWclTip") },
                                            { value: "armory", label: "Armory", icon: "inv_shield_06", disabled: busy.has(`armory:${r.character}`),
                                                tip: source === "armory" ? t("lootcouncil.dialog.sourceArmoryAgainTip") : t("lootcouncil.dialog.sourceArmoryTip") },
                                        ]}
                                    />
                                ) : undefined}
                            />
                            <div className="lc-hints lc-gearbadges">
                                <GearBadges gear={g} bisOwned={r.bis.owned} bisTotal={r.bis.total} character={r.character} roleLabel={r.role === "healer" ? t("lootcouncil.gear.dpsGear") : t("lootcouncil.gear.healGear")} />
                                {r.armoryUrl ? (
                                    <a className="lc-extlink" href={r.armoryUrl} target="_blank" rel="noopener noreferrer">
                                        {t("lootcouncil.dialog.armoryLink")} <ExternalIcon />
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
                                : <div className="empty lc-empty">{t("lootcouncil.dialog.noGear")}</div>}
                        </>
                    ) : null}

                    {section === "bis" ? (
                        <>
                            <PartHead
                                icon="inv_misc_gem_variety_02"
                                title={t("lootcouncil.dialog.bisTitle")}
                                crumb={t("lootcouncil.dialog.bisCrumb", { character: r.character })}
                                tip={r.bis.sourceLabel || t("lootcouncil.candidates.listTip")}
                                tipSub={[
                                    r.bis.source === "wowhead" ? t("lootcouncil.dialog.wowheadNote") : t("lootcouncil.dialog.wowsimsNote"),
                                    r.bis.borrowedFrom ? t("lootcouncil.dialog.listOf", { from: r.bis.borrowedFrom }) : "",
                                    r.bis.tier ? t(r.bis.exact ? "lootcouncil.dialog.tierExact" : "lootcouncil.dialog.tierOlder", { tier: r.bis.tier.toUpperCase() }) : "",
                                ].filter(Boolean).join(" ")}
                                action={r.bis.total ? <Badge tone="ok">{t("lootcouncil.dialog.bisWorn", { owned: r.bis.owned, total: r.bis.total })}</Badge> : undefined}
                            />
                            {!r.bis.total ? (
                                <div className="empty lc-empty">{t("lootcouncil.dialog.noBisList")}</div>
                            ) : !gaps.length ? (
                                <div className="empty lc-empty">{t("lootcouncil.dialog.fullList")}</div>
                            ) : (
                                <div className="lc-dlist">
                                    {gaps.map((item) => (
                                        <div key={item.id} className="lc-dlist-row">
                                            <ItemLink id={item.id} name={item.name} iconUrl={item.iconUrl} quality={item.quality} />
                                            <ContentBadge contentId={item.contentId} label={item.boss} />
                                            <span className="lc-muted">{item.boss}{item.ilvl ? ` · ilvl ${item.ilvl}` : ""}</span>
                                            <Link className={buttonClass("ghost", "sm", true, "lc-dlist-act")} to={dropHref(item.id)}>
                                                <WowIcon name="inv_misc_bag_10" size={18} />{t("lootcouncil.word.checkAsDrop")}
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
                                title={t("lootcouncil.dialog.section.loot")}
                                crumb={t("lootcouncil.dialog.lootCrumb", { character: r.character })}
                                tip={t("lootcouncil.dialog.lootTip")}
                                tipSub={t("lootcouncil.dialog.lootTipSub")}
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
                                <div className="empty lc-empty">{t("lootcouncil.dialog.noLoot")}</div>
                            )}
                            {r.otherCount ? <div className="lc-muted lc-note">{t("lootcouncil.items.otherNote", { count: r.otherCount })}</div> : null}
                        </>
                    ) : null}
                </div>

                <div className="dlg-foot lc-dlg-foot">
                    {canWrite ? (
                        <Button variant="danger" size="sm" icon={<AbsenceIcon />} running={busy.has(`exclude:${r.character}`)} onClick={() => onExclude(r.character)}>
                            {t("lootcouncil.page.excludeAction")}
                        </Button>
                    ) : null}
                    {g && r.simSupported ? (
                        <Button variant="ghost" size="sm" icon="inv_gizmo_02" running={busy.has(`export:${r.character}`)} onClick={() => onExport(r.character)}>
                            {t("lootcouncil.dialog.export.name")}
                        </Button>
                    ) : null}
                    <span className="lc-grow" />
                    <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
                    {canWrite ? (
                        <Button variant="run" icon="inv_shield_06" running={busy.has(`armory:${r.character}`)} onClick={() => onArmory(r.character)}>
                            {t("lootcouncil.gear.armoryFetch")}
                        </Button>
                    ) : null}
                </div>
            </div>
        </dialog>
    );
}
