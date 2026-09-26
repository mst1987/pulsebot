import { useState } from "react";
import { deleteRecruitmentPost, scanRecruitmentPosts, type ApiError, type RecruitmentData, type RecruitmentPost } from "../../api";
import type { CollectionEditor } from "../../lib/collectionEditor";
import { useTableSort, type Dir } from "../../lib/tableSort";
import { specsInContent } from "../../lib/recruitmentSpecs";
import { messageLink } from "../../lib/discordLinks";
import { SortTh } from "../../components/SortTh";
import { ExternalIcon, TrashIcon } from "../../components/icons";
import { useJobs, useToast } from "../../components/Jobs";
import { useConfirm } from "../../components/ui/Modal";
import { Button, IconButton } from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import { PartHead } from "../../components/ui/PartHead";
import { useT } from "../../i18n";
import { ICONS, openExternal, shortStamp } from "./shared";
import { EditIcon, WantedIcons } from "./RecruitmentBits";

type PostSortKey = "channel" | "wanted" | "template" | "source" | "updated";

const POST_SORT_DEFAULTS: Record<PostSortKey, Dir> = { channel: "asc", wanted: "asc", template: "asc", source: "asc", updated: "desc" };

// ---- the three tabs ----

export function PostsTab({ data, editor, onChanged, reload }: {
    data: RecruitmentData;
    editor: CollectionEditor;
    onChanged: (msg: string) => void;
    reload: () => void;
}) {
    const t = useT();
    const ask = useConfirm();
    const { run } = useJobs();
    const toast = useToast();
    const [scanning, setScanning] = useState(false);
    const templateName = (id: string | undefined) => data.templates.find((tpl) => tpl.id === id)?.name || "";
    const channelOf = (id: string) => data.channels.find((c) => c.id === id);
    const { sort, dir, onSort, apply } = useTableSort<PostSortKey>("recruitment-posts-sort", POST_SORT_DEFAULTS, "updated");
    const posts = apply(data.posts, (p, key) => {
        switch (key) {
            case "channel": return (p.channelName || p.channelId || "").toLowerCase();
            case "wanted": return specsInContent(p.content, data.specCatalog).map((s) => s.name).join(" ").toLowerCase();
            case "template": return templateName(p.templateId).toLowerCase();
            case "source": return p.source || "";
            default: return p.updatedAt || p.postedAt || 0;
        }
    });

    const scan = async () => {
        setScanning(true);
        const r = await run(
            { label: t("recruitment.posts.scan"), icon: ICONS.scan, detail: t("recruitment.posts.scanDetail"), describe: (x: { count: number }) => ({ message: t("recruitment.posts.scanDone", { count: x.count }) }) },
            () => scanRecruitmentPosts(),
        );
        setScanning(false);
        if (r) reload();
    };

    const removePost = async (p: RecruitmentPost) => {
        if (!(await ask({ title: t("recruitment.posts.removeTitle"), text: t("recruitment.posts.removeText", { channel: p.channelName || p.channelId }), action: t("recruitment.posts.removeAction") }))) return;
        try {
            await deleteRecruitmentPost(p.id);
            onChanged(t("recruitment.posts.removed"));
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.posts} tone="recruitment" title={t("recruitment.posts.title")} crumb={t("recruitment.crumb.posts")}
                tip={t("recruitment.posts.tip")}
                tipSub={t("recruitment.posts.tipSub")}
                action={data.activeGuildId
                    ? <Button variant="run" size="sm" icon={ICONS.scan} running={scanning} onClick={scan}>{t("recruitment.posts.scan")}</Button>
                    : undefined}
            />
            {data.posts.length
                ? (
                    <div className="rc-tbl">
                        <table className="idx">
                            <thead>
                                <tr>
                                    {/* The Channel column takes what the fixed ones leave: a channel
                                        name is the one cell whose length nobody controls. */}
                                    <SortTh sortKey="channel" label={t("recruitment.posts.colChannel")} sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="wanted" label={t("recruitment.posts.colWanted")} sort={sort} dir={dir} onSort={onSort} tip={t("recruitment.posts.wantedTip")} tipSub={t("recruitment.posts.wantedSub")} className="rc-col-wanted" />
                                    <SortTh sortKey="template" label={t("recruitment.posts.colTemplate")} sort={sort} dir={dir} onSort={onSort} tip={t("recruitment.posts.templateTip")} tipSub={t("recruitment.posts.templateSub")} className="rc-col-template" />
                                    <SortTh sortKey="source" label={t("recruitment.posts.colSource")} sort={sort} dir={dir} onSort={onSort} tip={t("recruitment.posts.sourceTip")} tipSub={t("recruitment.posts.sourceSub")} className="rc-col-source" />
                                    <SortTh sortKey="updated" label={t("recruitment.posts.colUpdated")} sort={sort} dir={dir} onSort={onSort} className="rc-col-updated" />
                                    <th className="rc-col-postact" />
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map((p) => {
                                    const ch = channelOf(p.channelId);
                                    const tpl = templateName(p.templateId);
                                    return (
                                        <tr key={p.id} className="rc-row" onClick={() => editor.startEdit(p.id)}>
                                            {/* Cut off rather than wrapped (see recruitment.css) —
                                                the tooltip keeps the full name readable. */}
                                            <td data-tip={`#${p.channelName || ch?.name || p.channelId}`} data-tip-sub={ch?.category || undefined}>
                                                <div className="cname">#{p.channelName || ch?.name || p.channelId}</div>
                                                {ch?.category && <div className="csub">{ch.category}</div>}
                                            </td>
                                            <td><WantedIcons content={p.content} data={data} /></td>
                                            <td>{tpl ? <div className="cell-cut" data-tip={tpl}>{tpl}</div> : <span className="csub">—</span>}</td>
                                            <td>
                                                {p.source === "scan"
                                                    ? <Badge icon={ICONS.scan}>{t("recruitment.posts.found")}</Badge>
                                                    : <Badge tone="accent" icon={ICONS.post}>{t("recruitment.posts.posted")}</Badge>}
                                            </td>
                                            <td className="mono csub">{shortStamp(p.updatedAt || p.postedAt)}</td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <div className="rc-acts">
                                                    <IconButton size="sm" icon={<ExternalIcon />} tip={t("recruitment.posts.openInDiscord")} onClick={() => openExternal(messageLink(p.guildId, p.channelId, p.messageId))} />
                                                    <IconButton size="sm" icon={<EditIcon />} tip={t("recruitment.posts.editTip")} tipSub={t("recruitment.posts.editSub")} onClick={() => editor.startEdit(p.id)} />
                                                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip={t("recruitment.posts.removeTip")} tipSub={t("recruitment.posts.removeSub")} onClick={() => removePost(p)} />
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
                : (
                    <div className="rc-empty rc-empty-panel">
                        <Badge>{t("recruitment.posts.empty")}</Badge>
                        <span>{t("recruitment.posts.emptyText")}</span>
                    </div>
                )}
        </>
    );
}
