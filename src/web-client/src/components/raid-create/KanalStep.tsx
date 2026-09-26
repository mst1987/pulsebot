import { Link } from "react-router-dom";
import type { EventSource, RaidCreateContext } from "../../api";
import { useT } from "../../i18n";
import { normalizeChannelName } from "../../lib/channelNames";
import { eventDay } from "../../lib/raidTime";
import Badge from "../ui/Badge";
import Segment from "../ui/Segment";
import WowIcon from "../ui/WowIcon";
import NamingBadge from "../channels/NamingBadge";
import { SwitchRow } from "../RaidPlanFields";
import type { ChannelMode } from "./createHelpers";
import { Label } from "./CreateParts";
import type { RaidCreateForm } from "./useRaidCreateForm";

/**
 * Step "Kanal & Anmeldung": where it is posted (new by the category's schema, a
 * clone, or an existing channel), how people sign up (preset from the category),
 * the voice channel, the announcement and the deadline — or, for Raid-Helper,
 * its template.
 */
export function KanalStep({ f, ctx }: { f: RaidCreateForm; ctx: RaidCreateContext }) {
    const t = useT();
    const { form, patch, changePlan, editing, canClone, sourceEvent, naming, schema, categoryName, categoryChannels, eh, startPreview, rhTemplates, rhTemplate } = f;
    const { categoryId, source, channelMode, channelId, channelName, channelTouched, voiceChannelId, announce, plan, templateId } = form;
    const deadlineAt = startPreview && plan.deadlineHours > 0 ? eventDay(startPreview - plan.deadlineHours * 3600) : null;
    const modes = [
        { value: "new" as ChannelMode, label: t("raidCreate.kanal.modeNew"), disabled: !categoryId },
        ...(canClone ? [{ value: "clone" as ChannelMode, label: t("raidCreate.kanal.modeClone") }] : []),
        { value: "existing" as ChannelMode, label: t("raidCreate.kanal.modeExisting") },
    ];
    return (
        <>
            {!editing && (
                <div className="field">
                    <Label text={t("raidCreate.kanal.source")} tip={t("raidCreate.kanal.sourceTip")} />
                    <Segment<EventSource> ariaLabel={t("raidCreate.kanal.source")} value={source} onChange={(v) => patch({ source: v })}
                        options={[{ value: "eventhelper", label: "EventHelper", icon: "inv_misc_note_05" }, { value: "raidhelper", label: "Raid-Helper", icon: "inv_misc_map_01" }]} />
                </div>
            )}
            {editing
                ? (
                    <div className="re-summary">
                        <WowIcon name="inv_letter_15" size={28} />
                        <div className="re-opt-text">
                            <span className="kicker">{t("raidCreate.kanal.channel")}</span>
                            <strong className="re-mono">#{channelName || channelId}</strong>
                        </div>
                        <Badge tip={t("raidCreate.kanal.staysTip")} tipSub={t("raidCreate.kanal.staysSub")}>{t("raidCreate.kanal.stays")}</Badge>
                    </div>
                )
                : (
                    <div className="field">
                        <div className="re-label-row">
                            <Label text={t("raidCreate.kanal.channel")} htmlFor="re-channel" tip={t("raidCreate.kanal.channelTip", { channel: sourceEvent?.channelName || "…" })} />
                            <Segment<ChannelMode> size="sm" ariaLabel={t("raidCreate.kanal.channel")} value={channelMode} onChange={(m) => patch({ channelMode: m, channelTouched: false })} options={modes} />
                        </div>
                        {channelMode === "existing"
                            ? (ctx.channels.length
                                ? (
                                    <select id="re-channel" value={channelId} onChange={(e) => patch({ channelId: e.target.value })} required>
                                        <option value="">{t("raidCreate.kanal.channelPick")}</option>
                                        {(categoryChannels.length ? categoryChannels : ctx.channels).map((c) => <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                                    </select>
                                )
                                : <input id="re-channel" type="text" value={channelId} onChange={(e) => patch({ channelId: e.target.value })} placeholder={t("raidCreate.kanal.channelIdPlaceholder")} required />)
                            : (
                                <>
                                    <input id="re-channel" className="re-mono re-chan-name" type="text" value={channelName}
                                        onChange={(e) => patch({ channelName: e.target.value, channelTouched: true })} required
                                        data-tip={t("raidCreate.kanal.channelName")}
                                        data-tip-sub={`${naming ? naming.label : t("raidCreate.kanal.schema", { schema: schema?.schema || ctx.defaultSchema || "" })}${categoryName ? ` · ${categoryName}` : ""}`} />
                                    {naming && (
                                        <div className="re-naming">
                                            {channelTouched && naming.name !== normalizeChannelName(channelName)
                                                ? <Badge tip={t("raidCreate.kanal.manualTip")} tipSub={t("raidCreate.kanal.manualSub", { name: naming.name, label: naming.label, design: naming.design })}>{t("raidCreate.kanal.manual")}</Badge>
                                                : <NamingBadge naming={naming} />}
                                        </div>
                                    )}
                                </>
                            )}
                    </div>
                )}
            {eh && (
                <div className="field">
                    <Label text={t("raidCreate.kanal.voice")} htmlFor="re-voice" tip={t("raidCreate.kanal.voiceTip")} />
                    {(ctx.voiceChannels || []).length
                        ? (
                            <select id="re-voice" value={voiceChannelId} onChange={(e) => patch({ voiceChannelId: e.target.value, voiceTouched: true })}>
                                <option value="">{t("raidCreate.kanal.voiceNone")}</option>
                                {(ctx.voiceChannels || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                            </select>
                        )
                        : <span className="note">{t("raidCreate.kanal.voiceMissing")}</span>}
                </div>
            )}
            {eh && !editing && (
                <div className="rt-switches">
                    <SwitchRow
                        label={t("raidCreate.kanal.announce")}
                        tip={t("raidCreate.kanal.announceTip")}
                        checked={announce} onChange={(v) => patch({ announce: v, announceTouched: true })} />
                </div>
            )}
            {eh
                ? (
                    <div className="field">
                        <Label text={t("raidCreate.kanal.deadline")} htmlFor="re-deadline" tip={t("raidCreate.kanal.deadlineTip")} />
                        <div className="re-deadline">
                            <input id="re-deadline" type="number" min={0} max={336} value={plan.deadlineHours || ""} placeholder={t("raidCreate.kanal.deadlineNone")}
                                onChange={(e) => changePlan({ ...plan, deadlineHours: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                            <span className="re-sub">{t("raidCreate.kanal.hoursBefore")}</span>
                            {deadlineAt && <Badge tone="accent">{deadlineAt.day} · {deadlineAt.time}</Badge>}
                        </div>
                    </div>
                )
                : (
                    <div className="field">
                        <div className="re-label-row">
                            <Label text={t("raidCreate.kanal.rhTemplate")} htmlFor="re-template" tip={t("raidCreate.kanal.rhTemplateTip")} />
                            <Link className="re-link" to="/raids/raid-templates">{t("raidCreate.templatesLink")}</Link>
                        </div>
                        <select id="re-template" value={templateId} onChange={(e) => patch({ templateId: e.target.value, templateTouched: true })} required>
                            <option value="">{t("raidCreate.kanal.rhPick")}</option>
                            {templateId && !rhTemplate && <option value={templateId}>{t("raidCreate.kanal.rhUnknown", { id: templateId })}</option>}
                            {rhTemplates.map((tpl) => <option key={tpl.id} value={tpl.raidhelperTemplateId}>{tpl.name || t("raidCreate.noName")} · ID {tpl.raidhelperTemplateId}</option>)}
                        </select>
                    </div>
                )}
        </>
    );
}
