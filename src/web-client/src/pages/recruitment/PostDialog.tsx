import { useEffect, useMemo, useState, type ReactNode } from "react";
import { postRecruitmentTemplate, type ApiError, type RecruitmentData, type RecruitmentTarget } from "../../api";
import { useDraftState } from "../../lib/ui/persistedState";
import DiscordPreview from "./DiscordPreview";
import { useToast } from "../../components/shell/Jobs";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Segment from "../../components/ui/Segment";
import { useT } from "../../i18n";
import { TipLabel, WantedIcons } from "./RecruitmentBits";
import { LinkButtonFields } from "./LinkButtonFields";
import { EMPTY_LINK, FORUM_TITLE_MAX, linkOf, type LinkDraft } from "./linkDraft";
import { ICONS } from "./shared";

type ButtonKind = "apply" | "link";

type PostDraft = LinkDraft & {
    templateId: string;
    channelId: string;
    buttonKind: ButtonKind;
    forumTitle: string;
};

export function PostDialog({ data, presetTemplateId, onPosted, onClose }: {
    data: RecruitmentData;
    presetTemplateId: string;
    onPosted: (msg: string) => void;
    onClose: () => void;
}) {
    const t = useT();
    const [draft, patch] = useDraftState<PostDraft>("recruitment-post-target", {
        ...EMPTY_LINK, templateId: data.templates[0]?.id ?? "", channelId: "", buttonKind: "apply", forumTitle: "",
    });
    const [posting, setPosting] = useState(false);
    const toast = useToast();

    // "Posten" on a template row picks that template.
    useEffect(() => {
        if (presetTemplateId) patch({ templateId: presetTemplateId });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presetTemplateId]);

    const template = data.templates.find((tpl) => tpl.id === draft.templateId) || data.templates[0] || null;
    // Text channels and forums; an older server answer has only the text channels.
    const targets: RecruitmentTarget[] = useMemo(
        () => data.targets ?? data.channels.map((c) => ({ id: c.id, name: c.name, category: c.category, parentId: "", kind: "text" as const })),
        [data.targets, data.channels],
    );
    const servers = data.inviteServers ?? [];
    // The invite starts on the server an existing recruitment post is on, else the active one.
    const preferredGuildId = data.posts.find((p) => p.guildId)?.guildId || data.activeGuildId;
    const byCategory = useMemo(() => {
        const groups = new Map<string, RecruitmentTarget[]>();
        for (const c of targets) {
            const key = c.category || t("recruitment.postDialog.noCategory");
            groups.set(key, [...(groups.get(key) || []), c]);
        }
        return [...groups.entries()];
    }, [targets, t]);

    const picked = targets.find((c) => c.id === draft.channelId) || null;
    const isForum = picked?.kind === "forum";
    const kind: ButtonKind = draft.buttonKind === "link" ? "link" : "apply";
    const link = kind === "link" ? linkOf(draft, servers) : "";
    const title = draft.forumTitle.trim();

    const pickTarget = (id: string) => {
        const next = targets.find((c) => c.id === id);
        const p: Partial<PostDraft> = { channelId: id };
        // A forum post has no apply flow of its own: it points to a server, so the link is the default.
        if (next?.kind === "forum") {
            p.buttonKind = "link";
            if (!draft.forumTitle.trim()) p.forumTitle = Array.from(template?.name || "").slice(0, FORUM_TITLE_MAX).join("");
        }
        patch(p);
    };

    const ready = !!(data.activeGuildId && template && draft.channelId)
        && (!isForum || !!title)
        && (kind === "apply" || !!link);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!template || !ready) return;
        setPosting(true);
        try {
            await postRecruitmentTemplate({
                templateId: template.id,
                channelId: draft.channelId,
                ...(kind === "link" ? { buttonKind: "link" as const, linkUrl: link, buttonLabel: draft.linkLabel.trim() } : {}),
                ...(isForum ? { forumTitle: title } : {}),
            });
            // The next post starts fresh: no title, link or label left over; template and channel stay, and so does the
            // button kind a forum starts with (the link).
            patch({ ...EMPTY_LINK, buttonKind: isForum ? "link" : "apply", forumTitle: "" });
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
                        <select id="rc-pick-template" value={template?.id || ""} onChange={(e) => patch({ templateId: e.target.value })} required>
                            {data.templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name || t("recruitment.postDialog.noName")}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <TipLabel label={t("recruitment.postDialog.channel")} htmlFor="rc-pick-channel" tip={t("recruitment.postDialog.channel")} tipSub={t("recruitment.postDialog.channelSub")} />
                        {targets.length
                            ? (
                                <select id="rc-pick-channel" value={draft.channelId} onChange={(e) => pickTarget(e.target.value)} required>
                                    <option value="">{t("recruitment.postDialog.pickChannel")}</option>
                                    {byCategory.map(([cat, list]) => (
                                        <optgroup key={cat} label={cat}>
                                            {list.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.kind === "forum" ? `${c.name} (${t("recruitment.postDialog.forum")})` : `#${c.name}`}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            )
                            : (
                                <input
                                    id="rc-pick-channel" type="text" value={draft.channelId}
                                    onChange={(e) => patch({ channelId: e.target.value })} placeholder={t("recruitment.postDialog.channelId")} required
                                />
                            )}
                    </div>
                    {isForum && (
                        <div className="field">
                            <TipLabel
                                label={t("recruitment.postDialog.forumTitle")} htmlFor="rc-forum-title"
                                tip={t("recruitment.postDialog.forumTitle")} tipSub={t("recruitment.postDialog.forumTitleSub")}
                                extra={<span className="rc-kind">{t("recruitment.postDialog.titleCount", { count: Array.from(draft.forumTitle).length, max: FORUM_TITLE_MAX })}</span>}
                            />
                            <input
                                id="rc-forum-title" type="text" maxLength={FORUM_TITLE_MAX} value={draft.forumTitle} required aria-invalid={!title}
                                onChange={(e) => patch({ forumTitle: e.target.value })}
                            />
                        </div>
                    )}
                    <div className="rc-postdlg-section">
                        <div className="field">
                            <TipLabel label={t("recruitment.postDialog.button")} tip={t("recruitment.postDialog.button")} tipSub={t("recruitment.postDialog.buttonSub")} />
                            <Segment<ButtonKind>
                                ariaLabel={t("recruitment.postDialog.button")} size="sm" value={kind}
                                onChange={(v) => patch({ buttonKind: v })}
                                options={[
                                    { value: "apply", label: t("recruitment.postDialog.kindApply"), tip: t("recruitment.postDialog.kindApply"), tipSub: t("recruitment.postDialog.kindApplySub") },
                                    { value: "link", label: t("recruitment.postDialog.kindLink"), tip: t("recruitment.postDialog.kindLink"), tipSub: t("recruitment.postDialog.kindLinkSub") },
                                ]}
                            />
                        </div>
                        {kind === "link" && (
                            <LinkButtonFields
                                servers={servers} draft={draft} patch={patch}
                                preferredGuildId={preferredGuildId} defaultLabel={data.defaultLinkLabel}
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
                    {template && (
                        <DiscordPreview
                            content={template.content}
                            buttonKind={kind}
                            buttonLabel={kind === "link" ? (draft.linkLabel.trim() || data.defaultLinkLabel || "") : template.buttonLabel}
                            forumTitle={isForum ? draft.forumTitle : undefined}
                            emojis={data.emojis} channels={data.channels}
                        />
                    )}
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
                        <Button type="submit" form="rc-postdlg-form" icon={ICONS.post} running={posting} disabled={!ready}>
                            {isForum ? t("recruitment.postDialog.submitForum") : t("recruitment.postDialog.submit")}
                        </Button>
                    )}
                </>
            )}
        >
            {body}
        </Modal>
    );
}
