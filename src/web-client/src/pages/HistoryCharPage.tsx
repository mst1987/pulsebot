// One character (design issue #218): who is it and how does it stand — in one
// hero —, then one of three parts behind a section switch: its equipment with
// every finding of the last evaluation sitting on the slot it is about, its
// loot history, and its attendance night by night. A click on a slot opens the
// item's details in a modal.
//
// Two answers feed it: /api/history/char (loot, live Battle.net gear, the gear
// findings) and /api/roster/char (role, categories, attendance, the drop source
// and BiS specs of the worn items). The second is best-effort — without it the
// page loses those parts, never the rest.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import {
    getHistoryChar, getRosterChar, deleteLootItems, canAccess,
    type ApiError, type CharGearReport, type GearIssue, type GearItem, type HistoryCharData, type LootItem, type RosterCharData,
} from "../api";
import { fmtMs } from "../lib/format";
import { itemQualityColor, itemQualityProps, qualityName } from "../lib/itemQuality";
import { usePersistedSearchParam } from "../lib/persistedState";
import { refreshWowheadLinks } from "../lib/wowheadTooltips";
import { wowheadItemUrl } from "../lib/wowheadItems";
import { classColorProps } from "../components/ClassSpec";
import { LootTable } from "../components/LootTable";
import type { ShellContext } from "../components/Shell";
import { useToast } from "../components/Jobs";
import { AttendanceBar, IconLink, RoleBadge } from "../components/RosterCommon";
import { SLOT_LABELS, attendanceTone, combineAttendance, findingLabel, findingsForSlot, nightLabel } from "../lib/rosterView";
import { Badge, Button, IconTile, Modal, PartHead, WowIcon, buttonClass } from "../components/ui";
import { CheckIcon, XIcon } from "../components/icons";
import "../styles/roster-charakter.css";
import RaidLoader from "../components/ui/RaidLoader";

type CharTab = "gear" | "loot" | "attendance";
const CHAR_TABS: CharTab[] = ["gear", "loot", "attendance"];

// Character-sheet order in two columns, weapons underneath. Shirt and tabard
// are left out: they take a slot on the sheet and carry no raid value.
const GEAR_LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST"];
const GEAR_RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const GEAR_BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const NO_RAID_VALUE = new Set(["SHIRT", "TABARD"]);
const SOCKET_DE: Record<string, string> = { RED: "Rot", YELLOW: "Gelb", BLUE: "Blau", META: "Meta", PRISMATIC: "Prismatisch" };
// The game's own empty-socket art (same files Wowhead's tooltips use).
const SOCKET_ICON: Record<string, string> = {
    RED: "socket-red", YELLOW: "socket-yellow", BLUE: "socket-blue", META: "socket-meta", PRISMATIC: "socket-prismatic",
};
function socketIconUrl(type: string): string {
    return `https://wow.zamimg.com/images/icons/${SOCKET_ICON[type] || SOCKET_ICON.PRISMATIC}.gif`;
}

// Slots that can carry a permanent enchant in TBC — same set as the CLA's gear
// audit (config/claData.js ENCHANTABLE_SLOTS), in Blizzard slot keys. Rings are
// enchanter-only, so a missing mark there would be a false alarm.
const ENCHANTABLE_SLOTS = new Set(["HEAD", "SHOULDER", "CHEST", "LEGS", "FEET", "WRIST", "HANDS", "BACK", "MAIN_HAND", "OFF_HAND"]);

// An off-hand *held* item (tome, orb) takes no enchant — only shields and
// off-hand weapons do. Same heuristic as the CLA (gearIssues.js's isShieldMisc).
function isEnchantable(g: GearItem, slot: string): boolean {
    if (!ENCHANTABLE_SLOTS.has(slot)) return false;
    if (slot === "OFF_HAND" && g.iconUrl.indexOf("_misc_") > -1) return false;
    return true;
}

// Wowhead item URL carrying the character's actual enchant + gems.
function gearWowheadUrl(g: GearItem): string {
    const params: string[] = [];
    if (g.enchantIds.length) params.push(`ench=${g.enchantIds[0]}`);
    const gemIds = g.sockets.map((s) => s.gemId).filter((id): id is number => !!id);
    if (gemIds.length) params.push(`gems=${gemIds.join(":")}`);
    return wowheadItemUrl(g.itemId, params);
}

function averageItemLevel(data: HistoryCharData): number {
    if (data.charSummary?.itemLevel) return data.charSummary.itemLevel;
    const levels = (data.gear || []).map((g) => g.level || 0).filter((n) => n > 0);
    if (!levels.length) return 0;
    return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
}

function HeroStat({ label, tip, tipSub, tone, children }: { label: string; tip: string; tipSub?: string; tone?: "total" | "ok" | "mid" | "warn"; children: ReactNode }) {
    return (
        <div className={`ros-hstat${tone ? ` is-${tone}` : ""}`}>
            <span className="ros-hstat-label" data-tip={tip} data-tip-sub={tipSub}>{label}</span>
            <span className="ros-hstat-value">{children}</span>
        </div>
    );
}

function CharHero({ data, roster, loading, onReload }: { data: HistoryCharData; roster: RosterCharData | null; loading: boolean; onReload: () => void }) {
    const info = data.info;
    const summary = data.charSummary;
    const gear = data.gearIssues;
    const avgIlvl = averageItemLevel(data);
    const realm = data.realm || summary?.realm || "";
    const colored = classColorProps(info?.classColor);
    const att = roster ? combineAttendance(Object.values(roster.attendance)) : null;
    const high = gear ? gear.issues.filter((i) => i.severity === "high").length : 0;
    const when = gear?.generatedAt ? fmtMs(gear.generatedAt, false) : "";

    return (
        <header className="dash-card ros-hero" style={{ "--class-color": info?.classColor || undefined } as CSSProperties}>
            <div className="ros-hero-main">
                <div className="ros-portrait">
                    {info?.className
                        ? <WowIcon name={`classicon_${info.className.toLowerCase()}`} size={46} />
                        : <span className="ros-portrait-ph">{(data.character || "?").slice(0, 1).toUpperCase()}</span>}
                    {!!summary?.level && <span className="ros-lvl" data-tip="Level" data-tip-sub="Laut Battle.net-Profil.">{summary.level}</span>}
                </div>
                <div className="ros-hero-ident">
                    <div className="kicker">Charakter</div>
                    <h1 className="ros-hero-title">{data.character}</h1>
                    <div className="ros-hero-sub">
                        {info?.className
                            ? (
                                <span className={`ros-hero-class ${colored.className || ""}`} style={colored.style}>
                                    {!!info.iconUrl && <img src={info.iconUrl} alt="" />}
                                    {info.spec ? `${info.spec} ${info.className}` : info.className}
                                </span>
                            )
                            : <span>Klasse noch nicht aufgelöst</span>}
                        {!!realm && <><span aria-hidden="true">·</span><span>{realm}</span></>}
                        {!!roster?.role && <RoleBadge role={roster.role} />}
                        {roster?.categories.map((c) => (
                            <Badge key={c.id} icon={c.icon || "achievement_guildperk_everybodysfriend"} tip={c.name} tipSub={c.contents.join(" · ") || undefined}>
                                {c.name}
                            </Badge>
                        ))}
                    </div>
                </div>
                <div className="ros-hero-actions">
                    <IconLink href={data.wclUrl} icon="inv_misc_pocketwatch_01" tip="Warcraft Logs" size="md" />
                    <IconLink href={data.armoryUrl} icon="inv_shirt_guildtabard_01" tip="Armory" size="md" />
                    {data.gearConfigured
                        ? <Button variant="run" icon="trade_engineering" running={loading} onClick={onReload}>Gear neu laden</Button>
                        : <Link className={buttonClass("ghost", "md", true)} to="/settings?section=battlenet"><WowIcon name="trade_engineering" size={22} />Battle.net einrichten</Link>}
                </div>
            </div>
            <div className="ros-hero-foot">
                <HeroStat
                    label="Ø iLvl"
                    tone="total"
                    tip="Ø Item-Level"
                    tipSub={data.charSummary?.itemLevel ? "Laut Battle.net-Profil." : "Mittel über das Gear, das die Battle.net-API zurückgegeben hat."}
                >
                    {avgIlvl || "–"}
                </HeroStat>
                {att && (
                    <HeroStat
                        label="Anwesenheit"
                        tone={att.pct === null ? undefined : ({ ok: "ok", mid: "mid", bad: "warn" } as const)[attendanceTone(att.pct) || "ok"]}
                        tip={att.total ? `${att.attended} von ${att.total} Raids` : "Keine Raids gezählt"}
                        tipSub="Über alle Raid-Kategorien des Charakters, je Kategorie die letzten 11 Raids."
                    >
                        {att.pct === null ? "–" : <>{att.pct}<small>% · {att.attended}/{att.total}</small></>}
                    </HeroStat>
                )}
                <HeroStat
                    label="Gear-Probleme"
                    tone={gear ? (gear.issueCount ? "warn" : "ok") : undefined}
                    tip={gear ? `${gear.issueCount} Befund${gear.issueCount === 1 ? "" : "e"}` : "nicht ausgewertet"}
                    tipSub={gear ? `Auswertung ${[gear.reportTitle || gear.zone, when].filter(Boolean).join(" vom ")}.` : "In keiner der gespeicherten Auswertungen enthalten."}
                >
                    {gear ? <>{gear.issueCount}{!!high && <small>{high} schwer</small>}</> : "–"}
                </HeroStat>
                <HeroStat label="Loot" tip="Importierte Items" tipSub="Aus den Gargul-/RCLootcouncil-Importen.">
                    {data.items.length}<small>Items</small>
                </HeroStat>
                {!!summary?.lastLogin && <span className="ros-hero-seen">zuletzt online {nightLabel(summary.lastLogin)}</span>}
            </div>
        </header>
    );
}

function FindingBadge({ issue }: { issue: GearIssue }) {
    return (
        <Badge tone={issue.severity === "high" ? "bad" : "mid"} tip={findingLabel(issue)} tipSub={`${issue.itemName || issue.slotName}: ${issue.severity === "high" ? "schwer" : "leicht"}`}>
            {findingLabel(issue)}
        </Badge>
    );
}

function GearRow({ g, slot, issues, onOpen }: { g?: GearItem; slot: string; issues: GearIssue[]; onOpen: (slot: string) => void }) {
    const label = SLOT_LABELS[slot] || slot;
    const flagged = issues.some((i) => i.severity === "high");
    if (!g) {
        return (
            <div className={`ros-gr is-empty${flagged ? " is-flag" : ""}`}>
                <span className="ros-iw"><span className="ros-iw-ph" /></span>
                <span className="ros-gb">
                    <span className="ros-iname">leer</span>
                    <span className="ros-sline"><span className="ros-slabel">{label}</span></span>
                </span>
                {issues.map((i, n) => <FindingBadge key={n} issue={i} />)}
            </div>
        );
    }
    const color = itemQualityColor(g.quality) || "var(--line)";
    const enchantable = isEnchantable(g, slot);
    const gems = g.sockets.map((s) => (s.gemName || s.gemText) || `leer (${SOCKET_DE[s.type] || s.type || "?"})`);
    const tipSub = [
        g.enchants.length ? `Verzauberung: ${g.enchants.join(", ")}` : (enchantable ? "Keine Verzauberung" : ""),
        gems.length ? `Sockel: ${gems.join(", ")}` : "",
        "Klick öffnet die Details.",
    ].filter(Boolean).join("\n");
    return (
        <button
            type="button"
            className={`ros-gr${flagged ? " is-flag" : ""}`}
            onClick={() => onOpen(slot)}
            data-tip={`${g.name || label}${g.level ? ` · iLvl ${g.level}` : ""}`}
            data-tip-sub={tipSub}
        >
            <span className="ros-iw">
                {g.iconUrl ? <img src={g.iconUrl} alt="" loading="lazy" style={{ borderColor: color }} /> : <span className="ros-iw-ph" />}
                {g.enchants.length
                    ? <span className="ros-ench ok" aria-label="verzaubert"><CheckIcon /></span>
                    : enchantable && <span className="ros-ench bad" aria-label="nicht verzaubert"><XIcon /></span>}
                {!!g.level && <span className="ros-ilvl">{g.level}</span>}
            </span>
            <span className="ros-gb">
                <span {...itemQualityProps(g.quality, "ros-iname")}>{g.name || label}</span>
                <span className="ros-sline">
                    <span className="ros-slabel">{label}</span>
                    {g.sockets.map((s, i) => {
                        const filled = !!(s.gemName || s.gemText);
                        if (filled && s.gemIconUrl) return <img key={i} className="ros-gem" src={s.gemIconUrl} alt="" loading="lazy" />;
                        if (filled) return <span key={i} className="ros-gem is-dot" />;
                        return <img key={i} className="ros-gem is-socket" src={socketIconUrl(s.type)} alt="" loading="lazy" />;
                    })}
                </span>
            </span>
            {issues.map((i, n) => <FindingBadge key={n} issue={i} />)}
        </button>
    );
}

function EvaluationLink({ gear, variant = "ghost", size = "sm" }: { gear: CharGearReport | null; variant?: "ghost" | "primary"; size?: "sm" | "md" }) {
    if (!gear?.reportRefId) return null;
    return (
        <a className={buttonClass(variant, size, true)} href={`/r/${gear.reportRefId}`} target="_blank" rel="noopener noreferrer">
            <WowIcon name="inv_misc_pocketwatch_01" size={size === "sm" ? 18 : 22} />
            Auswertung öffnen
        </a>
    );
}

function GearSection({ data, onOpen }: { data: HistoryCharData; onOpen: (slot: string) => void }) {
    const s = data.charSummary;
    const report = data.gearIssues;
    const issues = report?.issues || [];
    const high = issues.filter((i) => i.severity === "high").length;
    const gear = Array.isArray(data.gear) ? data.gear.filter((g) => !NO_RAID_VALUE.has(g.slot)) : [];
    const bySlot = new Map(gear.map((g) => [g.slot, g]));
    const wrongLevel = !!(s && s.level && s.level !== 70);

    const crumb = [
        gear.length ? "Battle.net-Profil" : "",
        report ? `Befunde aus ${report.reportTitle || report.zone || "der Auswertung"}${report.generatedAt ? ` vom ${fmtMs(report.generatedAt, false)}` : ""}` : "nicht ausgewertet",
    ].filter(Boolean).join(" · ");

    const slotsShown = new Set([...GEAR_LEFT, ...GEAR_RIGHT, ...GEAR_BOTTOM]);
    const matched = new Set<GearIssue>();
    const rowIssues = (slot: string) => {
        const list = findingsForSlot(issues, slot, bySlot.get(slot)).filter((i) => !matched.has(i));
        list.forEach((i) => matched.add(i));
        return list;
    };
    const row = (slot: string) => <GearRow key={slot} slot={slot} g={bySlot.get(slot)} issues={rowIssues(slot)} onOpen={onOpen} />;

    let body: ReactNode;
    if (gear.length) {
        const left = GEAR_LEFT.map(row);
        const right = GEAR_RIGHT.map(row);
        const bottom = GEAR_BOTTOM.map(row);
        const extras = gear.filter((g) => !slotsShown.has(g.slot)).map((g) => row(g.slot));
        const rest = issues.filter((i) => !matched.has(i));
        body = (
            <>
                <div className="ros-gear-grid"><div>{left}</div><div>{right}</div></div>
                <div className="ros-gear-weap">{bottom}{extras}</div>
                {!!rest.length && (
                    <div className="ros-gear-rest">
                        <span className="kicker">Ohne Slot-Zuordnung</span>
                        {rest.map((i, n) => (
                            <span key={n} className="ros-rest-row"><span className="ros-iname">{i.itemName || "–"}</span><FindingBadge issue={i} /></span>
                        ))}
                    </div>
                )}
            </>
        );
    } else {
        // No live gear: the findings still belong somewhere — as slot rows of
        // their own, so the page says what was wrong even without Battle.net.
        body = (
            <>
                <div className="ros-note">
                    {data.gearConfigured
                        ? (data.gearError || "Kein Live-Gear von der Battle.net-API verfügbar. „Gear neu laden“ fragt erneut ab.")
                        : <>Für Live-Gear den Battle.net-Zugang in den <Link to="/settings?section=battlenet">Einstellungen</Link> hinterlegen.</>}
                </div>
                {!!issues.length && (
                    <div className="ros-gear-grid is-single">
                        {issues.map((i, n) => (
                            <div key={n} className={`ros-gr is-static${i.severity === "high" ? " is-flag" : ""}`}>
                                <span className="ros-iw">{i.iconUrl ? <img src={i.iconUrl} alt="" loading="lazy" /> : <span className="ros-iw-ph" />}</span>
                                <span className="ros-gb">
                                    <span className="ros-iname">{i.itemName || "–"}</span>
                                    <span className="ros-sline"><span className="ros-slabel">{i.slotName || "Slot unbekannt"}</span></span>
                                </span>
                                <FindingBadge issue={i} />
                            </div>
                        ))}
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="dash-card ros-part">
            <PartHead
                icon="inv_helmet_98"
                tone="roster"
                title="Ausrüstung"
                crumb={crumb}
                tip="Ausrüstung"
                tipSub="Was der Charakter laut Battle.net trägt; die Befunde der neuesten Log-Auswertung sitzen an ihrem Slot. Hemd und Wappenrock fehlen, sie haben keinen Raidwert."
                action={(
                    <>
                        {!!high && <Badge tone="bad">{high} schwer</Badge>}
                        {issues.length - high > 0 && <Badge tone="mid">{issues.length - high} leicht</Badge>}
                        <EvaluationLink gear={report} />
                    </>
                )}
            />
            {wrongLevel && (
                <div className="flash flash-err ros-flash">
                    Die Blizzard-API meldet <strong>Level {s!.level}</strong> — wahrscheinlich der falsche Profile-Namespace
                    ({data.gearNamespace || "?"}). Anpassen in den <Link to="/settings?section=battlenet">Einstellungen</Link>.
                </div>
            )}
            {body}
        </div>
    );
}

function ItemDetailModal({ slot, data, roster, onClose }: { slot: string; data: HistoryCharData; roster: RosterCharData | null; onClose: () => void }) {
    const g = (data.gear || []).find((x) => x.slot === slot);
    if (!g) return null;
    const issues = findingsForSlot(data.gearIssues?.issues || [], slot, g);
    const facts = g.itemId ? roster?.items[String(g.itemId)] : undefined;
    const received = data.items.filter((it) => g.itemId && it.itemId === g.itemId).sort((a, b) => b.awardedAt - a.awardedAt)[0];
    const q = qualityName(g.quality).toLowerCase();
    const enchantable = isEnchantable(g, slot);
    const kicker = [SLOT_LABELS[slot] || slot, g.level ? `iLvl ${g.level}` : "", facts?.tier || ""].filter(Boolean).join(" · ");
    const report = data.gearIssues;
    return (
        <Modal
            open
            onClose={onClose}
            icon={g.iconUrl ? <img className="ros-dlg-icon" src={g.iconUrl} alt="" style={{ borderColor: itemQualityColor(g.quality) || undefined }} /> : "inv_misc_questionmark"}
            kicker={kicker}
            title={g.name || SLOT_LABELS[slot] || slot}
            width={600}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Schließen</Button>
                    {!!g.itemId && <a className={buttonClass("ghost")} href={gearWowheadUrl(g)} target="_blank" rel="noopener noreferrer">Auf Wowhead</a>}
                    <EvaluationLink gear={report} variant="primary" size="md" />
                </>
            )}
        >
            <div className={`ros-item-body${q ? ` q-${q}` : ""}`}>
                {issues.map((i, n) => (
                    <div key={n} className={`ros-find${i.severity === "high" ? " is-high" : ""}`}>
                        <IconTile icon={i.iconUrl ? <img src={i.iconUrl} alt="" /> : "inv_misc_gem_variety_02"} tone={i.severity === "high" ? "bad" : "mid"} />
                        <div>
                            <div className="ros-find-title">{findingLabel(i)} <Badge tone={i.severity === "high" ? "bad" : "mid"}>{i.severity === "high" ? "schwer" : "leicht"}</Badge></div>
                            <div className="sub">
                                Aus der Auswertung {report?.reportTitle || report?.zone || ""}{report?.generatedAt ? ` vom ${fmtMs(report.generatedAt, false)}` : ""}.
                            </div>
                        </div>
                    </div>
                ))}
                <div className="ros-kv">
                    <div className="k">Verzauberung</div>
                    <div>
                        {g.enchants.length
                            ? <><span>{g.enchants.join(", ")}</span><Badge tone="ok" className="ros-kv-end">vorhanden</Badge></>
                            : enchantable
                                ? <><span className="sub">keine</span><Badge tone="bad" className="ros-kv-end">fehlt</Badge></>
                                : <span className="sub">nicht verzauberbar</span>}
                    </div>
                    {g.sockets.length
                        ? g.sockets.map((sk, i) => {
                            const filled = !!(sk.gemName || sk.gemText);
                            return [
                                <div key={`k${i}`} className="k">{i === 0 ? "Sockel" : ""}</div>,
                                <div key={`v${i}`}>
                                    <img className="ros-kv-ico" src={filled && sk.gemIconUrl ? sk.gemIconUrl : socketIconUrl(sk.type)} alt="" />
                                    <span className={filled ? "" : "sub"}>{filled ? (sk.gemName || sk.gemText) : "leer"}</span>
                                    <Badge tone={filled ? undefined : "mid"} className="ros-kv-end">{SOCKET_DE[sk.type] || sk.type || "?"}</Badge>
                                </div>,
                            ];
                        })
                        : <><div className="k">Sockel</div><div><span className="sub">keine</span></div></>}
                    <div className="k">Erhalten</div>
                    <div>
                        {received
                            ? (
                                <>
                                    <span>{[nightLabel(received.awardedAt), received.eventLabel || facts?.content, received.boss || facts?.boss].filter(Boolean).join(" · ")}</span>
                                    {!!(received.reasonLabel || received.response) && <Badge tone="accent" className="ros-kv-end">{received.reasonLabel || received.response}</Badge>}
                                </>
                            )
                            : <span className="sub">nicht im Loot-Import{facts?.content ? ` · Drop: ${[facts.content, facts.boss].filter(Boolean).join(" · ")}` : ""}</span>}
                    </div>
                    <div className="k">BiS für</div>
                    <div>
                        {facts?.bisSpecs.length
                            ? (
                                <>
                                    {facts.bisSpecs.map((b) => !!b.iconUrl && <img key={b.specKey} className="ros-kv-ico" src={b.iconUrl} alt="" />)}
                                    <span>{facts.bisSpecs.map((b) => b.label).join(", ")}</span>
                                    <span className="sub ros-kv-end">WoWSims{facts.bisSpecs[0]?.tier ? ` ${facts.bisSpecs[0].tier.toUpperCase()}` : ""}</span>
                                </>
                            )
                            : (
                                <span className="sub">
                                    {!roster ? "nicht geladen" : facts?.contentId ? "auf keiner Caster-BiS-Liste" : "unbekannt – Item nicht in der Raid-Loot-Tabelle"}
                                </span>
                            )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function AttendanceSection({ roster }: { roster: RosterCharData | null }) {
    if (!roster) return <p className="sub">Anwesenheit konnte nicht geladen werden.</p>;
    if (!roster.categories.length) return <p className="sub">Der Charakter gehört zu keiner Raid-Kategorie.</p>;
    return (
        <>
            {roster.categories.map((c) => {
                const a = roster.attendance[c.id];
                const raids = a?.raids || [];
                return (
                    <div key={c.id} className="dash-card ros-part">
                        <PartHead
                            icon={c.icon || "ability_warrior_rallyingcry"}
                            tone="roster"
                            title={c.name}
                            crumb={[...c.contents, raids.length ? `letzte ${raids.length} Raids` : "keine Raids gezählt"].join(" · ")}
                            action={<AttendanceBar attendance={a} categoryName={c.name} />}
                        />
                        {raids.length
                            ? (
                                <div className="ros-nights">
                                    {raids.map((r) => (
                                        <div key={r.eventId} className="ros-night">
                                            <span className="ros-night-date">{nightLabel(r.startTime)}</span>
                                            <span className="ros-night-title">{r.title || "Raid"}</span>
                                            <Badge tone={r.attended ? "ok" : "bad"} icon={r.attended ? "ability_warrior_rallyingcry" : undefined}>
                                                {r.attended ? "da" : "gefehlt"}
                                            </Badge>
                                            <span className="sub">{r.reason}</span>
                                        </div>
                                    ))}
                                </div>
                            )
                            : <p className="sub ros-empty">Kein zugeordnetes Log und keine Raider-Zuordnung mit Anmeldungen in dieser Kategorie.</p>}
                    </div>
                );
            })}
        </>
    );
}

export default function HistoryCharPage() {
    const { user, csrfToken } = useOutletContext<ShellContext>();
    // Also reachable read-only via "Loot-Ansichten" (src/config/permissions.js).
    const canEdit = canAccess(user, "history", "write");
    const [tab, switchTab] = usePersistedSearchParam<CharTab>("history-char-tab", "tab", "gear", CHAR_TABS);
    const [searchParams, setSearchParams] = useSearchParams();
    const name = searchParams.get("name") || "";
    // The open item-details modal is in the url (?item=<slot>), so a link can
    // point straight at a piece and the back button closes it.
    const itemSlot = searchParams.get("item") || "";
    const setItemSlot = (slot: string) => {
        const params = new URLSearchParams(searchParams);
        if (slot) params.set("item", slot); else params.delete("item");
        setSearchParams(params);
    };

    const [data, setData] = useState<HistoryCharData | null>(null);
    const [roster, setRoster] = useState<RosterCharData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    const load = () => {
        setLoading(true);
        getHistoryChar(name)
            .then((d) => {
                setData(d);
                const ids = (d.gear || []).map((g) => g.itemId).filter((id): id is number => !!id);
                // Best-effort: the page stands without role, attendance and BiS facts.
                return getRosterChar(name, ids).then(setRoster).catch(() => setRoster(null));
            })
            .catch((err: ApiError) => setError(err))
            .finally(() => setLoading(false));
    };

    // A wrongly assigned award usually shows up here — on the raider who did not
    // get it. Drop the row locally instead of refetching the whole character.
    const removeItem = async (it: LootItem) => {
        try {
            await deleteLootItems(csrfToken, [it.id]);
            setData((d) => (d ? { ...d, items: d.items.filter((row) => row.id !== it.id) } : d));
            toast(`„${it.itemName || `Item ${it.itemId}`}" gelöscht.`);
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    useEffect(load, [name]);

    // Attach Wowhead tooltips to the freshly rendered item links (loot table).
    useEffect(() => { refreshWowheadLinks(); }, [data, tab]);

    if (error) return <div className="empty">Fehler beim Laden: {error.message}</div>;
    if (!data) return <RaidLoader text="Charakter wird geladen" />;

    const issueCount = data.gearIssues?.issueCount || 0;
    const issueTone = data.gearIssues?.issues.some((i) => i.severity === "high") ? "bad" : "mid";
    const att = roster ? combineAttendance(Object.values(roster.attendance)) : null;

    const sections: { id: CharTab; label: string; icon: string; count: ReactNode; tone?: string }[] = [
        { id: "gear", label: "Ausrüstung", icon: "inv_helmet_98", count: issueCount || null, tone: issueCount ? issueTone : "" },
        { id: "loot", label: "Loot-Historie", icon: "inv_misc_bag_10", count: data.items.length || null },
        { id: "attendance", label: "Anwesenheit", icon: "ability_warrior_rallyingcry", count: att?.total ? `${att.attended}/${att.total}` : null },
    ];

    return (
        <>
            <CharHero data={data} roster={roster} loading={loading} onReload={load} />

            <div className="ros-secs" role="tablist" aria-label="Bereich">
                {sections.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === s.id}
                        className={`ros-sec${tab === s.id ? " is-active" : ""}`}
                        onClick={() => switchTab(s.id)}
                    >
                        <WowIcon name={s.icon} size={20} />
                        {s.label}
                        {s.count !== null && <span className={`ros-sec-n${s.tone ? ` ${s.tone}` : ""}`}>{s.count}</span>}
                    </button>
                ))}
            </div>

            {tab === "gear" && <GearSection data={data} onOpen={setItemSlot} />}
            {tab === "loot" && (
                <div className="dash-card ros-part">
                    <PartHead
                        icon="inv_misc_bag_10"
                        tone="roster"
                        title="Loot-Historie"
                        crumb={`${data.items.length} Item${data.items.length === 1 ? "" : "s"} aus den Loot-Importen`}
                    />
                    {data.items.length
                        ? <LootTable items={data.items} showEvent onDelete={canEdit ? removeItem : undefined} />
                        : <p className="sub ros-empty">Kein Loot für diesen Charakter gespeichert.</p>}
                </div>
            )}
            {tab === "attendance" && <AttendanceSection roster={roster} />}

            {!!itemSlot && <ItemDetailModal slot={itemSlot} data={data} roster={roster} onClose={() => setItemSlot("")} />}
        </>
    );
}
