import { useState } from "react";
import { saveRecruitmentTemplate, updateRecruitmentPost, type ApiError, type RecruitmentData, type RecruitmentTemplate, type RecruitmentPost } from "../../api";
import { useDraftState } from "../../lib/persistedState";
import { messageLink } from "../../lib/discordLinks";
import { ExternalIcon } from "../../components/icons";
import { useToast } from "../../components/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { useT } from "../../i18n";
import { ICONS, openExternal } from "./shared";
import { DraftBadge, TipLabel } from "./RecruitmentBits";
import { MessageFields } from "./MessageFields";

export function TemplateEditor({ data, template, postedIn, onSaved, onClose }: {
    data: RecruitmentData;
    /** null while creating. */
    template: RecruitmentTemplate | null;
    postedIn: number;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    // A recruitment text is written, not filled in — so it is kept as a draft,
    // per template (the "new" form and each edited template have their own).
    const initial = { name: template?.name ?? "", content: template?.content ?? "", buttonLabel: template?.buttonLabel ?? "" };
    const [draft, patch, clearDraft] = useDraftState(`recruitment-template:${template?.id ?? "new"}`, initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const dirty = draft.name !== initial.name || draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await saveRecruitmentTemplate({ id: template?.id, ...draft });
            clearDraft();
            onSaved(template ? t("recruitment.editor.saved") : t("recruitment.editor.created"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };
    const cancel = () => { clearDraft(); onClose(); };

    return (
        <Modal
            open onClose={onClose} width={1120} icon={ICONS.templates} tone="recruitment" initialFocus="#rc-name"
            kicker={template ? t("recruitment.editor.editTemplate") : t("recruitment.templates.new")}
            title={draft.name.trim() || template?.name || t("recruitment.templates.new")}
            hint={(
                <span className="rc-foot-badges">
                    {postedIn > 0 && <Badge tone="accent" icon={ICONS.posts}>{t("recruitment.editor.postedIn", { count: postedIn })}</Badge>}
                    <DraftBadge dirty={dirty} />
                </span>
            )}
            footer={(
                <>
                    <Button variant="ghost" onClick={cancel}>{t("common.cancel")}</Button>
                    <Button type="submit" form="rc-template-form" running={busy}>{template ? t("common.save") : t("recruitment.editor.createTemplate")}</Button>
                </>
            )}
        >
            <form id="rc-template-form" onSubmit={submit}>
                <MessageFields
                    data={data} content={draft.content} setContent={(v) => patch({ content: v })}
                    buttonLabel={draft.buttonLabel} setButtonLabel={(v) => patch({ buttonLabel: v })}
                >
                    <div className="field">
                        <TipLabel label={t("common.name")} htmlFor="rc-name" tip={t("common.name")} tipSub={t("recruitment.editor.nameTipSub")} />
                        <input id="rc-name" type="text" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t("recruitment.editor.namePlaceholder")} required />
                    </div>
                </MessageFields>
            </form>
        </Modal>
    );
}

export function PostEditor({ data, post, templateName, onSaved, onClose }: {
    data: RecruitmentData;
    post: RecruitmentPost;
    templateName: string;
    onSaved: (msg: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    // Draft per post, so edits to a live message survive a detour to another tab.
    const initial = { content: post.content, buttonLabel: post.buttonLabel };
    const [draft, patch, clearDraft] = useDraftState(`recruitment-post:${post.id}`, initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const dirty = draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await updateRecruitmentPost({ id: post.id, ...draft });
            clearDraft();
            onSaved(t("recruitment.editor.postUpdated"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open onClose={onClose} width={1120} icon={ICONS.posts} tone="recruitment" initialFocus="#rc-content"
            kicker={t("recruitment.editor.editPost")}
            title={`#${post.channelName || post.channelId}`}
            hint={(
                <span className="rc-foot-badges">
                    {templateName && <Badge tone="accent" icon={ICONS.templates}>{templateName}</Badge>}
                    <DraftBadge dirty={dirty} />
                </span>
            )}
            footer={(
                <>
                    <Button variant="ghost" icon={<ExternalIcon />} onClick={() => openExternal(messageLink(post.guildId, post.channelId, post.messageId))}>{t("recruitment.posts.openInDiscord")}</Button>
                    <Button variant="ghost" onClick={() => { clearDraft(); onClose(); }}>{t("common.cancel")}</Button>
                    <Button type="submit" form="rc-post-form" running={busy}>{t("recruitment.editor.saveAndUpdate")}</Button>
                </>
            )}
        >
            <form id="rc-post-form" onSubmit={submit}>
                <MessageFields
                    data={data} content={draft.content} setContent={(v) => patch({ content: v })}
                    buttonLabel={draft.buttonLabel} setButtonLabel={(v) => patch({ buttonLabel: v })}
                />
            </form>
        </Modal>
    );
}
