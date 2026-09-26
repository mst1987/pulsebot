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
    const ask = useConfirm();
    const { run } = useJobs();
    const toast = useToast();
    const [scanning, setScanning] = useState(false);
    const templateName = (id: string | undefined) => data.templates.find((t) => t.id === id)?.name || "";
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
            { label: "Server durchsuchen", icon: ICONS.scan, detail: "Sucht Bot-Nachrichten mit Bewerben-Button", describe: (x: { count: number }) => ({ message: `${x.count} Nachricht(en) gefunden oder aktualisiert.` }) },
            () => scanRecruitmentPosts(),
        );
        setScanning(false);
        if (r) reload();
    };

    const removePost = async (p: RecruitmentPost) => {
        if (!(await ask({ title: "Aus der Verwaltung entfernen?", text: `Die Nachricht in #${p.channelName || p.channelId} bleibt in Discord bestehen — sie wird hier nur nicht mehr geführt.`, action: "Entfernen" }))) return;
        try {
            await deleteRecruitmentPost(p.id);
            onChanged("Aus der Verwaltung entfernt.");
        } catch (err) {
            toast((err as ApiError).message, "err");
        }
    };

    return (
        <>
            <PartHead
                icon={ICONS.posts} tone="recruitment" title="Gepostete Nachrichten" crumb="Recruitment › Nachrichten"
                tip="Vom Bot gepostete Nachrichten"
                tipSub="Bearbeiten ändert die Nachricht direkt in Discord. Entfernen nimmt sie nur aus der Verwaltung – die Discord-Nachricht bleibt."
                action={data.activeGuildId
                    ? <Button variant="run" size="sm" icon={ICONS.scan} running={scanning} onClick={scan}>Server durchsuchen</Button>
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
                                    <SortTh sortKey="channel" label="Channel" sort={sort} dir={dir} onSort={onSort} />
                                    <SortTh sortKey="wanted" label="Gesucht" sort={sort} dir={dir} onSort={onSort} tip="Gesuchte Specs" tipSub="Aus den „##“-Zeilen des Texts." style={{ width: 140 }} />
                                    <SortTh sortKey="template" label="Vorlage" sort={sort} dir={dir} onSort={onSort} tip="Vorlage" tipSub="Aus welcher Vorlage gepostet. Per Scan gefundene Nachrichten haben keine." style={{ width: 190 }} />
                                    <SortTh sortKey="source" label="Quelle" sort={sort} dir={dir} onSort={onSort} tip="Quelle" tipSub="Gepostet = über dieses Menü. Gefunden = beim Durchsuchen des Servers entdeckt." style={{ width: 130 }} />
                                    <SortTh sortKey="updated" label="Aktualisiert" sort={sort} dir={dir} onSort={onSort} style={{ width: 130 }} />
                                    <th style={{ width: 132 }} />
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
                                                    ? <Badge icon={ICONS.scan}>Gefunden</Badge>
                                                    : <Badge tone="accent" icon={ICONS.post}>Gepostet</Badge>}
                                            </td>
                                            <td className="mono csub">{shortStamp(p.updatedAt || p.postedAt)}</td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <div className="rc-acts">
                                                    <IconButton size="sm" icon={<ExternalIcon />} tip="In Discord öffnen" onClick={() => openExternal(messageLink(p.guildId, p.channelId, p.messageId))} />
                                                    <IconButton size="sm" icon={<EditIcon />} tip="Bearbeiten" tipSub="Text und Button — wird direkt in Discord geändert." onClick={() => editor.startEdit(p.id)} />
                                                    <IconButton size="sm" tone="danger" icon={<TrashIcon />} tip="Entfernen" tipSub="Nur aus der Verwaltung; die Discord-Nachricht bleibt." onClick={() => removePost(p)} />
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
                        <Badge>Noch keine Nachrichten</Badge>
                        <span>Poste eine Vorlage oder durchsuche den Server nach Bot-Nachrichten.</span>
                    </div>
                )}
        </>
    );
}
