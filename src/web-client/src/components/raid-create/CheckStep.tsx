import type { ReactNode } from "react";
import type { RaidCreateContext } from "../../api";
import { useT } from "../../i18n";
import { relativeDayLabel } from "../../lib/format";
import { overflowLine, sourceOf } from "../../lib/eventPlan";
import { eventDay } from "../../lib/raidTime";
import { rolePluralLabel } from "../../lib/wowNames";
import Badge from "../ui/Badge";
import { EventSub, Figure, IconStack } from "./CreateParts";
import type { RaidCreateForm } from "./useRaidCreateForm";

/** Step "Prüfen": the event as the list will show it, with what it is sent with. */
export function CheckStep({ f, ctx, userId, summaryIcon }: { f: RaidCreateForm; ctx: RaidCreateContext; userId: string; summaryIcon: ReactNode }) {
    const t = useT();
    const { form, editing, channel, sourceEvent, categoryName, eh, startPreview, endPreview, chosenInstances, rhTemplate } = f;
    const { title, channelMode, channelName, channelId, plan, source, categoryId, voiceChannelId, announce, templateId, leaderId, description } = form;
    const when = eventDay(startPreview);
    let where: ReactNode = <code>#{channel?.name || channelName || channelId}</code>;
    if (!editing && channelMode === "clone") where = <>{t("raidCreate.check.new")} <code>#{channelName}</code>, {t("raidCreate.check.clonedFrom")} <code>#{sourceEvent?.channelName}</code></>;
    else if (!editing && channelMode === "new") where = <>{t("raidCreate.check.new")} <code>#{channelName}</code>{categoryName ? ` ${t("raidCreate.check.inCategory", { name: categoryName })}` : ""}</>;
    return (
        <>
            <div className="re-review">
                {eh ? <IconStack icons={chosenInstances.map((i) => i.icon)} /> : summaryIcon}
                <div className="re-ev">
                    <span className="re-title">{title}</span>
                    <span className="re-sub"><EventSub ev={{ channelName: channelName || channel?.name, categoryName }} /></span>
                </div>
                <div className="re-when"><b>{when.day}</b><span>{when.time}{startPreview ? ` · ${relativeDayLabel(startPreview)}` : ""}</span></div>
            </div>
            {eh && (
                <div className="re-figs">
                    <Figure label={t("raidCreate.check.size")} value={plan.size} />
                    <Figure label={rolePluralLabel("tank")} value={plan.tank} />
                    <Figure label={rolePluralLabel("healer")} value={plan.healer} />
                    <Figure label={rolePluralLabel("dps")} value={Math.max(0, plan.size - plan.tank - plan.healer)} />
                </div>
            )}
            <dl className="re-facts">
                <dt>{t("raidCreate.check.signup")}</dt>
                <dd>{eh ? "EventHelper" : "Raid-Helper"}{!editing && source !== sourceOf(ctx.signupSources, categoryId) && <Badge tone="mid">{t("raidCreate.check.differs")}</Badge>}</dd>
                {eh
                    ? (
                        <>
                            <dt>{t("raidCreate.check.raid")}</dt>
                            <dd>{chosenInstances.map((i) => i.name).join(" + ") || "—"}{chosenInstances.some((i) => i.status === "incomplete") && <Badge tone="mid">{t("raidCreate.incomplete")}</Badge>}</dd>
                            <dt>{t("raidCreate.check.duration")}</dt>
                            <dd>{t("raidCreate.check.durationValue", { minutes: plan.durationMinutes })}{endPreview ? ` · ${t("raidCreate.termin.end", { time: endPreview.time })}` : ""}</dd>
                            <dt>{t("raidCreate.check.voice")}</dt>
                            <dd>{voiceChannelId ? (ctx.voiceChannels || []).find((c) => c.id === voiceChannelId)?.name || voiceChannelId : t("raidCreate.check.none")}</dd>
                            <dt>{t("raidCreate.check.deadline")}</dt>
                            <dd>{plan.deadlineHours > 0 ? t("raidCreate.check.deadlineValue", { hours: plan.deadlineHours }) : t("raidCreate.check.none")}</dd>
                            <dt>{t("raidCreate.check.whenFull")}</dt>
                            <dd>{overflowLine(plan)}</dd>
                            {!editing && (
                                <>
                                    <dt>{t("raidCreate.check.announcement")}</dt>
                                    <dd>{announce ? t("raidCreate.check.announcePing") : t("raidCreate.check.announceNone")}</dd>
                                </>
                            )}
                        </>
                    )
                    : (
                        <>
                            <dt>{t("raidCreate.check.template")}</dt>
                            <dd>{rhTemplate ? rhTemplate.name || t("raidCreate.noName") : t("raidCreate.check.ownId")} <Badge>{t("raidCreate.check.id", { id: templateId })}</Badge></dd>
                        </>
                    )}
                <dt>{t("raidCreate.check.channel")}</dt>
                <dd>{where}</dd>
                <dt>{t("raidCreate.check.leader")}</dt>
                <dd>{leaderId === userId ? t("raidCreate.check.you") : <code>{leaderId}</code>}</dd>
                <dt>{t("raidCreate.check.description")}</dt>
                <dd className="re-desc-preview">{description.trim() || "—"}</dd>
            </dl>
        </>
    );
}
