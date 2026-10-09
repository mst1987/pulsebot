import type { ReactNode } from "react";
import type { RaidCreateContext } from "../../api";
import { useT } from "../../i18n";
import { PLAN_MAX_DURATION, PLAN_MIN_DURATION } from "../../lib/raids/eventPlan";
import { XIcon } from "../ui/icons";
import { Button } from "../ui/Button";
import Expand from "../ui/Expand";
import WowIcon from "../ui/WowIcon";
import { EMPTY_ICON } from "./createHelpers";
import { Label } from "./CreateParts";
import type { RaidCreateForm } from "./useRaidCreateForm";

/**
 * Step "Termin": title, date, time (and the optional duration), the category;
 * leader and description folded under "Weitere Angaben". The duration starts
 * empty unless a raid template brings one (#305), and can be cleared again.
 */
export function TerminStep({ f, ctx, userId, summaryIcon }: { f: RaidCreateForm; ctx: RaidCreateContext; userId: string; summaryIcon: ReactNode }) {
    const t = useT();
    const { form, patch, editing, choice, sourceEvent, baseTemplate, categories, eh, endPreview, moreOpen, setMoreOpen, setStep, changePlan, applyCategory } = f;
    const { title, date, time, leaderId, leaderOther, description, categoryId, plan, channelMode } = form;
    const candidates = ctx ? ctx.leaderCandidates || [] : [];
    const leaderName = (candidates.find((c) => c.id === leaderId) || { name: "" }).name;
    const leaderText = leaderId === userId ? t("raidCreate.termin.leaderYou") : leaderId ? t("raidCreate.termin.leaderId", { id: leaderName || leaderId }) : t("raidCreate.termin.noLeader");
    const descText = description.trim()
        ? (sourceEvent && description === sourceEvent.description ? t("raidCreate.termin.descTaken") : t("raidCreate.termin.descSet"))
        : t("raidCreate.termin.descNone");
    let startName = t("raidCreate.start.empty");
    if (choice?.kind === "event" && sourceEvent) startName = `${sourceEvent.title || t("raidCreate.noTitle")}${sourceEvent.categoryName ? ` · ${sourceEvent.categoryName}` : ""}`;
    else if (choice?.kind === "template") startName = baseTemplate?.name || t("raidCreate.noName");
    return (
        <>
            {!editing && (
                <div className="re-summary">
                    {choice?.kind === "empty" ? <span className="raid-ic"><WowIcon name={EMPTY_ICON} size={36} className="a" /></span> : summaryIcon}
                    <div className="re-opt-text">
                        <span className="kicker">{choice?.kind === "template" ? t("raidCreate.termin.kindTemplate") : t("raidCreate.termin.kindStart")}</span>
                        <strong>{startName}</strong>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setStep("start")}>{t("raidCreate.termin.change")}</Button>
                </div>
            )}
            <div className="field">
                <Label text={t("raidCreate.termin.title")} htmlFor="re-title" />
                <input id="re-title" type="text" value={title} onChange={(e) => patch({ title: e.target.value })} placeholder="Hyjal + Black Temple" required />
            </div>
            <div className={eh ? "re-grid3" : "re-grid2"}>
                <div className="field re-f-date">
                    <Label text={t("raidCreate.termin.date")} htmlFor="re-date" />
                    <input id="re-date" type="date" value={date} onChange={(e) => patch({ date: e.target.value })} required />
                </div>
                <div className="field">
                    <Label text={t("raidCreate.termin.time")} htmlFor="re-time" />
                    <input id="re-time" type="time" value={time} onChange={(e) => patch({ time: e.target.value })} required />
                </div>
                {eh && (
                    <div className="field">
                        <Label text={t("raidCreate.termin.durationOptional")} htmlFor="re-duration" tip={t("raidCreate.termin.durationTip", { min: PLAN_MIN_DURATION, max: PLAN_MAX_DURATION })} />
                        <div className={`re-unit${plan.durationMinutes !== null ? " has-value" : ""}`}>
                            <input
                                id="re-duration" type="number" inputMode="numeric" aria-label={t("raidCreate.termin.durationAria")}
                                min={PLAN_MIN_DURATION} max={PLAN_MAX_DURATION} step={15} placeholder={t("raidCreate.termin.durationPlaceholder")}
                                value={plan.durationMinutes ?? ""}
                                onChange={(e) => changePlan({ ...plan, durationMinutes: e.target.value === "" ? null : Math.floor(Number(e.target.value)) })}
                            />
                            <span className="re-unit-txt" aria-hidden="true">{t("raidCreate.termin.minutes")}</span>
                            {plan.durationMinutes !== null && (
                                <button type="button" className="re-unit-clear" aria-label={t("raidCreate.termin.durationClear")} data-tip={t("raidCreate.termin.durationClear")}
                                    onClick={() => changePlan({ ...plan, durationMinutes: null })}>
                                    <XIcon />
                                </button>
                            )}
                        </div>
                        {endPreview && <span className="re-end">{t("raidCreate.termin.end", { time: endPreview.time })}</span>}
                    </div>
                )}
            </div>
            {categories.length > 0 && (
                <div className="field">
                    <Label text={t("raidCreate.termin.category")} htmlFor="re-category" tip={editing ? t("raidCreate.termin.categoryTipEdit") : t("raidCreate.termin.categoryTip")} />
                    <select id="re-category" value={categoryId} disabled={editing} onChange={(e) => {
                        applyCategory(ctx, e.target.value);
                        if (channelMode === "clone" && sourceEvent?.categoryId !== e.target.value) patch({ channelMode: "new" });
                    }}>
                        <option value="">{t("raidCreate.termin.categoryPick")}</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
            )}
            <div className={`re-more${moreOpen ? " open" : ""}`}>
                <div className="re-more-head">
                    <WowIcon name="inv_misc_book_09" size={22} />
                    <div className="re-opt-text">
                        <strong>{t("raidCreate.termin.more")}</strong>
                        <span className="re-sub">{leaderText} · {descText}</span>
                    </div>
                    <Expand open={moreOpen} onToggle={() => setMoreOpen((o) => !o)} />
                </div>
                {moreOpen && (
                    <div className="re-more-body">
                        <div className="field">
                            <Label text={t("raidCreate.termin.leader")} htmlFor="re-leader" tip={t("raidCreate.termin.leaderTip")} />
                            <select
                                id="re-leader" value={leaderOther ? "" : leaderId}
                                onChange={(e) => {
                                    if (e.target.value) { patch({ leaderId: e.target.value, leaderOther: false }); } else { patch({ leaderOther: true }); }
                                }}
                            >
                                {candidates.map((c) => (
                                    <option key={c.id} value={c.id}>{c.id === userId ? t("raidCreate.termin.leaderOptionYou", { name: c.name || c.id }) : c.name || c.id}</option>
                                ))}
                                <option value="">{t("raidCreate.termin.leaderOther")}</option>
                            </select>
                            {leaderOther && (
                                <input className="re-mono" type="text" value={leaderId} onChange={(e) => patch({ leaderId: e.target.value })} placeholder={t("raidCreate.termin.leaderPlaceholder")} aria-label={t("raidCreate.termin.leader")} required />
                            )}
                        </div>
                        <div className="field">
                            <Label text={t("raidCreate.termin.description")} htmlFor="re-desc" tip={t("raidCreate.termin.descriptionTip")} />
                            <textarea id="re-desc" value={description} onChange={(e) => patch({ description: e.target.value })} placeholder={t("raidCreate.termin.descriptionPlaceholder")} />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
