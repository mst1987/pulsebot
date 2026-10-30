import { useState } from "react";
import { saveRecruitmentTemplate, updateRecruitmentPost, type ApiError, type RecruitmentData, type RecruitmentTemplate, type RecruitmentPost } from "../../api";
import { useDraftState } from "../../lib/ui/persistedState";
import { messageLink } from "../../lib/discord/discordLinks";
import { ExternalIcon, SaveIcon, PlusIcon } from "../../components/ui/icons";
import { useToast } from "../../components/shell/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Segment from "../../components/ui/Segment";
import { useT } from "../../i18n";
import { ICONS, openExternal } from "./shared";
import { DraftBadge, TipLabel } from "./RecruitmentBits";
import { MessageFields } from "./MessageFields";
import { isDiscordInviteUrl } from "../../lib/discord/inviteLink";
import { FORUM_TITLE_MAX } from "./linkDraft";

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
    // The game version its applications are for (#553): a new template starts on the main version.
    const initial = { name: template?.name ?? "", content: template?.content ?? "", buttonLabel: template?.buttonLabel ?? "", versionId: template?.versionId || data.mainVersion || "" };
    const [stored, patch, clearDraft] = useDraftState(`recruitment-template:${template?.id ?? "new"}`, initial);
    // A draft kept from before #553 has no version yet.
    const draft = { ...stored, versionId: stored.versionId || initial.versionId };
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const dirty = draft.name !== initial.name || draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel || draft.versionId !== initial.versionId;

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
                    <Button type="submit" form="rc-template-form" variant={template ? "go" : "primary"} icon={template ? <SaveIcon /> : <PlusIcon />} running={busy}>{template ? t("common.save") : t("recruitment.editor.createTemplate")}</Button>
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
                    {(data.gameVersions || []).length > 1 && (
                        <div className="field">
                            <TipLabel label={t("recruitment.version.label")} tip={t("recruitment.version.label")} tipSub={t("recruitment.version.labelSub")} />
                            <Segment
                                size="sm" ariaLabel={t("recruitment.version.label")} value={draft.versionId}
                                onChange={(versionId) => patch({ versionId })}
                                options={(data.gameVersions || []).map((v) => ({ value: v.id, label: v.short, tip: v.label }))}
                            />
                        </div>
                    )}
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
    const isLink = post.buttonKind === "link";
    const isForum = !!post.parentChannelId;
    const initial = { content: post.content, buttonLabel: post.buttonLabel, linkUrl: post.linkUrl || "", forumTitle: post.forumTitle || "" };
    const [draft, patch, clearDraft] = useDraftState(`recruitment-post:${post.id}`, initial);
    const [busy, setBusy] = useState(false);
    const toast = useToast();
    const linkUrl = draft.linkUrl ?? "";
    const forumTitle = draft.forumTitle ?? "";
    const dirty = draft.content !== initial.content || draft.buttonLabel !== initial.buttonLabel
        || linkUrl !== initial.linkUrl || forumTitle !== initial.forumTitle;
    const linkBad = isLink && !isDiscordInviteUrl(linkUrl);
    const titleBad = isForum && !forumTitle.trim();

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            const saved = await updateRecruitmentPost({
                id: post.id, content: draft.content, buttonLabel: draft.buttonLabel,
                ...(isLink ? { linkUrl: linkUrl.trim() } : {}),
                ...(isForum ? { forumTitle: forumTitle.trim() } : {}),
            });
            clearDraft();
            // The text is saved; only the forum post's title could not change (Discord: 2 renames per 10 minutes).
            if (saved?.notice === "title_rate_limited") toast(t("recruitment.editor.titleRateLimited"), "warn");
            else if (saved?.notice === "title_failed") toast(t("recruitment.editor.titleFailed"), "warn");
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
            title={isForum ? (post.forumTitle || post.channelName || post.channelId) : `#${post.channelName || post.channelId}`}
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
                    <Button type="submit" form="rc-post-form" variant="go" icon={<SaveIcon />} running={busy} disabled={linkBad || titleBad}>{t("recruitment.editor.saveAndUpdate")}</Button>
                </>
            )}
        >
            <form id="rc-post-form" onSubmit={submit}>
                <MessageFields
                    data={data} content={draft.content} setContent={(v) => patch({ content: v })}
                    buttonLabel={draft.buttonLabel} setButtonLabel={(v) => patch({ buttonLabel: v })}
                    buttonKind={isLink ? "link" : "apply"} forumTitle={isForum ? forumTitle : undefined}
                >
                    {isForum && (
                        <div className="field">
                            <TipLabel
                                label={t("recruitment.postDialog.forumTitle")} htmlFor="rc-forum-title"
                                tip={t("recruitment.postDialog.forumTitle")} tipSub={t("recruitment.postDialog.forumTitleSub")}
                                extra={<span className="rc-kind">{t("recruitment.postDialog.titleCount", { count: Array.from(forumTitle).length, max: FORUM_TITLE_MAX })}</span>}
                            />
                            <input
                                id="rc-forum-title" type="text" maxLength={FORUM_TITLE_MAX} value={forumTitle} required aria-invalid={titleBad}
                                onChange={(e) => patch({ forumTitle: e.target.value })}
                            />
                        </div>
                    )}
                    {isLink && (
                        <div className="field">
                            <TipLabel label={t("recruitment.postDialog.linkUrl")} htmlFor="rc-link-url" tip={t("recruitment.postDialog.linkUrl")} tipSub={t("recruitment.postDialog.linkUrlSub")} />
                            <input
                                id="rc-link-url" type="url" value={linkUrl} aria-invalid={linkBad} required
                                onChange={(e) => patch({ linkUrl: e.target.value })} placeholder="https://discord.gg/..."
                            />
                            {linkBad && <div className="rc-postdlg-hint" role="alert">{t("recruitment.postDialog.linkInvalid")}</div>}
                        </div>
                    )}
                </MessageFields>
            </form>
        </Modal>
    );
}
