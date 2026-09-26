import { useEffect, useMemo, useState, type ReactNode } from "react";
import { postRecruitmentTemplate, type ApiError, type RecruitmentData, type TextChannel } from "../../api";
import { useDraftState } from "../../lib/persistedState";
import DiscordPreview from "./DiscordPreview";
import { useToast } from "../../components/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { useT } from "../../i18n";
import { TipLabel, WantedIcons } from "./RecruitmentBits";
import { ICONS } from "./shared";

export function PostDialog({ data, presetTemplateId, onPosted, onClose }: {
    data: RecruitmentData;
    presetTemplateId: string;
    onPosted: (msg: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    const [target, patchTarget] = useDraftState("recruitment-post-target", { templateId: data.templates[0]?.id ?? "", channelId: "" });
    const [posting, setPosting] = useState(false);
    const toast = useToast();

    // "Posten" on a template row picks that template.
    useEffect(() => {
        if (presetTemplateId) patchTarget({ templateId: presetTemplateId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presetTemplateId]);

    const template = data.templates.find((tpl) => tpl.id === target.templateId) || data.templates[0] || null;
    const byCategory = useMemo(() => {
        const groups = new Map<string, TextChannel[]>();
        for (const c of data.channels) {
            const key = c.category || t("recruitment.postDialog.noCategory");
            groups.set(key, [...(groups.get(key) || []), c]);
        }
        return [...groups.entries()];
    }, [data.channels, t]);

    const ready = !!(data.activeGuildId && template && target.channelId);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!template) return;
        setPosting(true);
        try {
            await postRecruitmentTemplate({ templateId: template.id, channelId: target.channelId });
            onPosted(t("recruitment.postDialog.posted"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setPosting(false);
        }
    };

    let body: ReactNode;
    if (!data.activeGuildId) {
        body = <div className="rc-empty"><Badge tone="mid">{t("recruitment.postDialog.noServer")}</Badge><span>{t("recruitment.postDialog.noServerText")}</span></div>;
    } else if (!data.templates.length) {
        body = <div className="rc-empty"><Badge tone="mid">{t("recruitment.postDialog.noTemplate")}</Badge><span>{t("recruitment.postDialog.noTemplateText")}</span></div>;
    } else {
        body = (
            <form id="rc-postdlg-form" onSubmit={submit} className="rc-editor">
                <div className="rc-fields">
                    <div className="field">
                        <TipLabel label={t("recruitment.postDialog.template")} htmlFor="rc-pick-template" />
                        <select id="rc-pick-template" value={template?.id || ""} onChange={(e) => patchTarget({ templateId: e.target.value })} required>
                            {data.templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name || t("recruitment.postDialog.noName")}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <TipLabel label={t("recruitment.postDialog.channel")} htmlFor="rc-pick-channel" tip={t("recruitment.postDialog.channel")} tipSub={t("recruitment.postDialog.channelSub")} />
                        {data.channels.length
                            ? (
                                <select id="rc-pick-channel" value={target.channelId} onChange={(e) => patchTarget({ channelId: e.target.value })} required>
                                    <option value="">{t("recruitment.postDialog.pickChannel")}</option>
                                    {byCategory.map(([cat, list]) => (
                                        <optgroup key={cat} label={cat}>
                                            {list.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            )
                            : (
                                <input
                                    id="rc-pick-channel" type="text" value={target.channelId}
                                    onChange={(e) => patchTarget({ channelId: e.target.value })} placeholder={t("recruitment.postDialog.channelId")} required
                                />
                            )}
                    </div>
                    {template && (
                        <div className="rc-postdlg-meta">
                            <span className="kicker">{t("recruitment.postDialog.wanted")}</span>
                            <WantedIcons content={template.content} data={data} />
                        </div>
                    )}
                </div>
                <div className="rc-preview">
                    <div className="kicker rc-preview-head">{t("recruitment.postDialog.preview")}</div>
                    {template && <DiscordPreview content={template.content} buttonLabel={template.buttonLabel} emojis={data.emojis} channels={data.channels} />}
                </div>
            </form>
        );
    }

    return (
        <Modal
            open onClose={onClose} width={data.activeGuildId && data.templates.length ? 1040 : 520}
            icon={ICONS.post} tone="recruitment" kicker={t("recruitment.page.title")} title={t("recruitment.postDialog.title")} initialFocus="select, .btn-ghost"
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    {data.activeGuildId && data.templates.length > 0 && (
                        <Button type="submit" form="rc-postdlg-form" icon={ICONS.post} running={posting} disabled={!ready}>{t("recruitment.postDialog.submit")}</Button>
                    )}
                </>
            )}
        >
            {body}
        </Modal>
    );
}
