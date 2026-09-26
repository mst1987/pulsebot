import type { HistoryCharData, RosterCharData } from "../../api";
import { fmtMs } from "../../lib/format";
import { itemQualityColor, qualityName } from "../../lib/itemQuality";
import { SLOT_LABELS, findingLabel, findingsForSlot, nightLabel } from "../../lib/rosterView";
import { Badge, Button, IconTile, Modal, buttonClass } from "../../components/ui";
import { gearWowheadUrl, isEnchantable, SOCKET_DE, socketIconUrl } from "./charGear";
import { EvaluationLink } from "./GearSection";

export function ItemDetailModal({ slot, data, roster, onClose }: { slot: string; data: HistoryCharData; roster: RosterCharData | null; onClose: () => void }) {
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
