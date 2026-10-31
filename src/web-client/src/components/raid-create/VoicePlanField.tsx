import type { RaidCreateContext } from "../../api";
import { useLang, useT } from "../../i18n";
import { canonicalTemplate, isTemporary, LEAD_MAX, NAME_TEMPLATE_MAX, templateForLang, voiceNameFor, type TempVoiceMode, type VoicePlan } from "../../lib/discord/tempVoice";
import { Button } from "../ui/Button";
import NumberStepper from "../ui/form/NumberStepper";
import Segment from "../ui/form/Segment";
import { EditIcon, RefreshIcon } from "../ui/icons/icons";
import { Label } from "./CreateParts";
import type { RaidCreateForm } from "./useRaidCreateForm";

/**
 * "Sprachkanal für dieses Event" in the KanalStep (docs/channels.md "Sprachkanal
 * je Raid"): closed it names what the category sets; "Für dieses Event ändern"
 * opens the event's own plan - the source, the name template and the lead. The
 * Discord category and the close-after stay with the category.
 */
export function VoicePlanField({ f, ctx }: { f: RaidCreateForm; ctx: RaidCreateContext }) {
    const t = useT();
    const uiLang = useLang();
    const { form, patch, categoryVoice, categoryName, chosenInstances, startPreview } = f;
    const { voicePlan, voiceChannelId } = form;
    const voiceChannels = ctx.voiceChannels || [];
    const channelLabel = (id: string) => voiceChannels.find((c) => c.id === id)?.name || id;
    const raid = chosenInstances.map((i) => i.short || i.id).join("/") || form.title || "Raid";
    const leader = (ctx.leaderCandidates || []).find((c) => c.id === form.leaderId)?.name || "";

    if (!voicePlan) {
        const temp2 = isTemporary(categoryVoice, 2);
        const what = categoryVoice.mode === "none"
            ? t("raidCreate.kanal.voiceModeNone")
            : categoryVoice.mode === "temp"
                ? t("raidCreate.kanal.voiceAlwaysTemp")
                : temp2
                    ? t("raidCreate.kanal.voiceFixedThenTemp", { channel: channelLabel(categoryVoice.voiceChannelId) || t("raidCreate.kanal.voiceFixed") })
                    : channelLabel(categoryVoice.voiceChannelId) || t("raidCreate.kanal.voiceFixed");
        const timing = categoryVoice.mode === "temp"
            ? t("raidCreate.kanal.voiceTimingAll", { minutes: categoryVoice.leadMinutes })
            : temp2 ? t("raidCreate.kanal.voiceTiming2", { minutes: categoryVoice.leadMinutes }) : "";
        const open = () => {
            const plan: VoicePlan = { mode: categoryVoice.mode, nameTemplate: categoryVoice.nameTemplate, leadMinutes: categoryVoice.leadMinutes };
            patch({ voicePlan: plan, voiceTouched: true });
        };
        return (
            <div className="field">
                <Label text={t("raidCreate.kanal.voiceHead")} tip={t("raidCreate.kanal.voiceTip")} />
                <div className="re-summary re-voice-summary">
                    <div className="re-opt-text">
                        <strong>{what}</strong>
                        <span className="re-sub">
                            {categoryName ? t("raidCreate.kanal.voiceCategoryOf", { name: categoryName }) : t("raidCreate.kanal.voiceCategory")}
                            {timing ? ` · ${timing}` : ""}
                        </span>
                    </div>
                    <Button variant="ghost" size="sm" icon={<EditIcon />} onClick={open}>{t("raidCreate.kanal.voiceEdit")}</Button>
                </div>
            </div>
        );
    }

    const change = (next: Partial<VoicePlan>) => patch({ voicePlan: { ...voicePlan, ...next }, voiceTouched: true });
    const reset = () => patch({ voicePlan: null, voiceChannelId: categoryVoice.mode === "existing" ? categoryVoice.voiceChannelId : "", voiceTouched: false });
    const showTemp = isTemporary({ mode: voicePlan.mode, fromRaid2: categoryVoice.fromRaid2 }, 2);
    const name = (index: number, total: number) => voiceNameFor(voicePlan.nameTemplate, { raid, start: startPreview || 0, index, total, leader, lang: categoryVoice.lang });
    return (
        <div className="field re-voice-plan">
            <div className="re-label-row">
                <Label text={t("raidCreate.kanal.voiceHead")} tip={t("raidCreate.kanal.voiceTip")} />
                <Button variant="ghost" size="sm" icon={<RefreshIcon />} onClick={reset}>{t("raidCreate.kanal.voiceReset")}</Button>
            </div>
            <span className="note">{t("raidCreate.kanal.voiceDiffers")}</span>
            <Segment<TempVoiceMode> size="sm" ariaLabel={t("raidCreate.kanal.voice")} value={voicePlan.mode} onChange={(mode) => change({ mode })}
                options={[
                    { value: "none", label: t("raidCreate.kanal.voiceModeNone") },
                    { value: "existing", label: t("raidCreate.kanal.voiceModeExisting") },
                    { value: "temp", label: t("raidCreate.kanal.voiceModeTemp") },
                ]} />
            {voicePlan.mode === "existing" && (
                voiceChannels.length
                    ? (
                        <select id="re-voice" aria-label={t("raidCreate.kanal.voice")} value={voiceChannelId} onChange={(e) => patch({ voiceChannelId: e.target.value, voiceTouched: true })}>
                            <option value="">{t("raidCreate.kanal.voiceNone")}</option>
                            {voiceChannels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.category ? ` · ${c.category}` : ""}</option>)}
                        </select>
                    )
                    : <span className="note">{t("raidCreate.kanal.voiceMissing")}</span>
            )}
            {showTemp && (
                <>
                    <label className="re-voice-name">
                        <span className="kicker">{t("raidCreate.kanal.voiceName")}</span>
                        <input type="text" className="re-mono" maxLength={NAME_TEMPLATE_MAX} value={templateForLang(voicePlan.nameTemplate, uiLang)}
                            onChange={(e) => change({ nameTemplate: canonicalTemplate(e.target.value) })} />
                    </label>
                    <span className="re-sub" data-testid="voice-preview">
                        {voicePlan.mode === "temp"
                            ? t("raidCreate.kanal.voicePreview", { one: name(1, 1), two: name(1, 2), three: name(2, 2) })
                            : t("raidCreate.kanal.voicePreview2", { two: name(2, 2) })}
                    </span>
                    <div className="re-deadline">
                        <span className="re-sub">{t("raidCreate.kanal.voiceLead")}</span>
                        <NumberStepper size="sm" value={voicePlan.leadMinutes} min={0} max={LEAD_MAX} step={5} editable
                            onChange={(leadMinutes) => change({ leadMinutes })}
                            ariaLabel={t("raidCreate.kanal.voiceLead")} lessLabel={t("raidCreate.kanal.voiceLess")} moreLabel={t("raidCreate.kanal.voiceMore")} />
                        <span className="re-sub">{t("raidCreate.kanal.voiceLeadUnit")}</span>
                    </div>
                    <span className="note">{t("raidCreate.kanal.voiceClose", { minutes: categoryVoice.closeAfterMinutes })}</span>
                </>
            )}
        </div>
    );
}
