import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CharGearReport, GearIssue, GearItem, HistoryCharData } from "../../api";
import { fmtMs } from "../../lib/format";
import { itemQualityColor, itemQualityProps } from "../../lib/itemQuality";
import { SLOT_LABELS, findingLabel, findingsForSlot } from "../../lib/rosterView";
import { Badge, PartHead, WowIcon, buttonClass } from "../../components/ui";
import { CheckIcon, XIcon } from "../../components/icons";
import { GEAR_BOTTOM, GEAR_LEFT, GEAR_RIGHT, isEnchantable, NO_RAID_VALUE, SOCKET_DE, socketIconUrl } from "./charGear";

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

export function EvaluationLink({ gear, variant = "ghost", size = "sm" }: { gear: CharGearReport | null; variant?: "ghost" | "primary"; size?: "sm" | "md" }) {
    if (!gear?.reportRefId) return null;
    return (
        <a className={buttonClass(variant, size, true)} href={`/r/${gear.reportRefId}`} target="_blank" rel="noopener noreferrer">
            <WowIcon name="inv_misc_pocketwatch_01" size={size === "sm" ? 18 : 22} />
            Auswertung öffnen
        </a>
    );
}

export function GearSection({ data, onOpen }: { data: HistoryCharData; onOpen: (slot: string) => void }) {
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
