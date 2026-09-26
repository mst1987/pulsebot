import type { CSSProperties } from "react";
import type { HistoryCharData, RosterCharData } from "../../api";
import { fmtMs } from "../../lib/format";
import { itemQualityColor, qualityName } from "../../lib/itemQuality";
import { SLOT_LABELS, findingLabel, findingsForSlot, nightLabel } from "../../lib/rosterView";
import { Badge, Button, IconTile, Modal, buttonClass } from "../../components/ui";
import { gearWowheadUrl, isEnchantable, SOCKET_DE, socketIconUrl } from "./charGear";
import { EvaluationLink } from "./GearSection";
import { useT } from "../../i18n";

export function ItemDetailModal({ slot, data, roster, onClose }: { slot: string; data: HistoryCharData; roster: RosterCharData | null; onClose: () => void }) {
    const t = useT();
    const g = (data.gear || []).find((x) => x.slot === slot);
    if (!g) return null;
    const issues = findingsForSlot(data.gearIssues?.issues || [], slot, g);
    const facts = g.itemId ? roster?.items[String(g.itemId)] : undefined;
    const received = data.items.filter((it) => g.itemId && it.itemId === g.itemId).sort((a, b) => b.awardedAt - a.awardedAt)[0];
    const q = qualityName(g.quality).toLowerCase();
    const enchantable = isEnchantable(g, slot);
    const kicker = [SLOT_LABELS[slot] || slot, g.level ? `iLvl ${g.level}` : "", facts?.tier || ""].filter(Boolean).join(" · ");
    const report = data.gearIssues;
    const reportName = report?.reportTitle || report?.zone || "";
    const fromReport = report?.generatedAt
        ? t("history.itemDetail.fromReportDated", { report: reportName, date: fmtMs(report.generatedAt, false) })
        : t("history.itemDetail.fromReport", { report: reportName });
    return (
        <Modal
            open
            onClose={onClose}
            icon={g.iconUrl ? <img className="ros-dlg-icon" src={g.iconUrl} alt="" style={{ "--ros-q": itemQualityColor(g.quality) || undefined } as CSSProperties} /> : "inv_misc_questionmark"}
            kicker={kicker}
            title={g.name || SLOT_LABELS[slot] || slot}
            width={600}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
                    {!!g.itemId && <a className={buttonClass("ghost")} href={gearWowheadUrl(g)} target="_blank" rel="noopener noreferrer">{t("history.shared.wowhead")}</a>}
                    <EvaluationLink gear={report} variant="primary" size="md" />
                </>
            )}
        >
            <div className={`ros-item-body${q ? ` q-${q}` : ""}`}>
                {issues.map((i, n) => (
                    <div key={n} className={`ros-find${i.severity === "high" ? " is-high" : ""}`}>
                        <IconTile icon={i.iconUrl ? <img src={i.iconUrl} alt="" /> : "inv_misc_gem_variety_02"} tone={i.severity === "high" ? "bad" : "mid"} />
                        <div>
                            <div className="ros-find-title">{findingLabel(i)} <Badge tone={i.severity === "high" ? "bad" : "mid"}>{i.severity === "high" ? t("history.shared.severityHigh") : t("history.shared.severityLow")}</Badge></div>
                            <div className="sub">
                                {fromReport}
                            </div>
                        </div>
                    </div>
                ))}
                <div className="ros-kv">
                    <div className="k">{t("history.itemDetail.enchant")}</div>
                    <div>
                        {g.enchants.length
                            ? <><span>{g.enchants.join(", ")}</span><Badge tone="ok" className="ros-kv-end">{t("history.itemDetail.present")}</Badge></>
                            : enchantable
                                ? <><span className="sub">{t("history.itemDetail.none")}</span><Badge tone="bad" className="ros-kv-end">{t("history.itemDetail.missing")}</Badge></>
                                : <span className="sub">{t("history.itemDetail.notEnchantable")}</span>}
                    </div>
                    {g.sockets.length
                        ? g.sockets.map((sk, i) => {
                            const filled = !!(sk.gemName || sk.gemText);
                            return [
                                <div key={`k${i}`} className="k">{i === 0 ? t("history.itemDetail.socket") : ""}</div>,
                                <div key={`v${i}`}>
                                    <img className="ros-kv-ico" src={filled && sk.gemIconUrl ? sk.gemIconUrl : socketIconUrl(sk.type)} alt="" />
                                    <span className={filled ? "" : "sub"}>{filled ? (sk.gemName || sk.gemText) : t("history.shared.empty")}</span>
                                    <Badge tone={filled ? undefined : "mid"} className="ros-kv-end">{SOCKET_DE[sk.type] || sk.type || "?"}</Badge>
                                </div>,
                            ];
                        })
                        : <><div className="k">{t("history.itemDetail.socket")}</div><div><span className="sub">{t("history.itemDetail.none")}</span></div></>}
                    <div className="k">{t("history.itemDetail.received")}</div>
                    <div>
                        {received
                            ? (
                                <>
                                    <span>{[nightLabel(received.awardedAt), received.eventLabel || facts?.content, received.boss || facts?.boss].filter(Boolean).join(" · ")}</span>
                                    {!!(received.reasonLabel || received.response) && <Badge tone="accent" className="ros-kv-end">{received.reasonLabel || received.response}</Badge>}
                                </>
                            )
                            : (
                                <span className="sub">
                                    {facts?.content
                                        ? t("history.itemDetail.notImportedDrop", { drop: [facts.content, facts.boss].filter(Boolean).join(" · ") })
                                        : t("history.itemDetail.notImported")}
                                </span>
                            )}
                    </div>
                    <div className="k">{t("history.itemDetail.bisFor")}</div>
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
                                    {!roster ? t("history.itemDetail.notLoaded") : facts?.contentId ? t("history.itemDetail.noBisList") : t("history.itemDetail.unknownItem")}
                                </span>
                            )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
