import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import {
    archiveChannels, canAccess, deleteChannels, getChannels, patchChannels, quickCreateChannels, saveChannelConfig,
    type Channel, type ChannelChanges, type ChannelPurpose, type ChannelResult,
    type QuickCreateInput, type RenamePreviewRow } from "../api";
import { useApi } from "../hooks/useApi";
import type { ShellContext } from "../components/Shell";
import { Badge, IconButton, PageHead, Segment, SplitButton, useConfirm } from "../components/ui";
import { useJobs } from "../components/Jobs";
import { TagIcon } from "../components/channels/channelBits";
import {
    AssignChannelDialog, CreateChannelDialog, DuplicateChannelDialog, PurposeDialog } from "../components/channels/ChannelDialogs";
import { ChannelTree } from "../components/channels/ChannelTree";
import { BulkBar, BulkEditDialog, RenameSchemaDialog } from "../components/channels/ChannelBulk";
import { ChannelEditDialog } from "../components/channels/ChannelEditDialog";
import { QuickCreateDialog } from "../components/channels/QuickCreateDialog";
import { CategorySchemaDialog } from "../components/channels/CategorySchemaDialog";
import { ArchiveSettingsDialog, ArchiveTab, DeleteChannelsDialog } from "../components/channels/ArchiveTab";
import { PurposesDialog, PurposeSummaryBadges } from "../components/channels/PurposeList";
import { BULK_DELETE_WORD, deleteWarnings, pastEventChannels, resultMessage, runInSteps } from "../lib/channels";
import "../styles/channels.css";
import RaidLoader from "../components/ui/RaidLoader";
import { tParts, useT } from "../i18n";

// Kanäle (design #216, reworked as the Discord overview in #259): one list —
// the server's categories and channels like Discord's sidebar — with inline
// rename, a selection that brings up a bar for bulk changes, and an archive tab
// where an admin deletes what is no longer needed. Everything else lives in
// tooltips and dialogs: the purposes (what the bot uses a channel for), the full
// edit, quick-create by schema. Changes go to Discord one channel at a time with
// a short pause, the progress in the job toast.

type Dialog =
    | { kind: "purposes" }
    | { kind: "purpose"; purpose: ChannelPurpose }
    | { kind: "assign"; channel: Channel }
    | { kind: "duplicate"; channel: Channel }
    | { kind: "create" }
    | { kind: "quick" }
    | { kind: "schema"; categoryId: string }
    | { kind: "edit"; channel: Channel }
    | { kind: "bulk"; focus: "category" | "topic" }
    | { kind: "rename" }
    // `anywhere`: from the channel list, not the archive — any channel, never a category.
    | { kind: "delete"; ids: string[]; anywhere?: boolean }
    | { kind: "archive-settings"; then?: string[] }
    | null;

type ArchiveSettingsInput = { archiveCategoryId?: string; archiveDeleteHintDays: number; createArchiveCategory?: string };

/** One big figure of the side panel, optionally a button. */
function Figure({ label, value, tone, tip, tipSub, onClick }: {
    label: string;
    value: number;
    tone?: "mid";
    tip: string;
    tipSub: string;
    onClick?: () => void;
}) {
    const body = (
        <>
            <span className="kn-kicker">{label}</span>
            <span className={`kn-figure-val${tone ? ` ${tone}` : ""}`}>{value}</span>
        </>
    );
    return onClick
        ? <button type="button" className="kn-figure" data-tip={tip} data-tip-sub={tipSub} onClick={onClick}>{body}</button>
        : <div className="kn-figure" tabIndex={0} data-tip={tip} data-tip-sub={tipSub}>{body}</div>;
}

export default function ChannelsPage() {
    const { user } = useOutletContext<ShellContext>();
    const channels = useApi(() => getChannels(), []);
    const { data, setData } = channels;
    const [dialog, setDialog] = useState<Dialog>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab") === "archive" ? "archive" : "channels";
    const { run } = useJobs();
    const ask = useConfirm();
    const t = useT();

    // Forget selected channels that no longer exist.
    useEffect(() => {
        if (data) setSelected((s) => new Set([...s].filter((id) => data.channels.some((c) => c.id === id))));
    }, [data]);

    // The purposes are settings: changing them takes write access to Einstellungen.
    const canEditPurposes = canAccess(user, "settings", "write");
    const canWrite = canAccess(user, "channels", "write");

    const byId = useMemo(() => new Map((data?.channels || []).map((c) => [c.id, c])), [data]);
    const selectedChannels = [...selected].map((id) => byId.get(id)).filter((c): c is Channel => !!c);

    const select = (ids: string[], on: boolean) => setSelected((s) => {
        const next = new Set(s);
        for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
        }
        return next;
    });

    const switchTab = (next: "channels" | "archive") => {
        setSelected(new Set());
        const p = new URLSearchParams(params);
        if (next === "archive") p.set("tab", "archive");
        else p.delete("tab");
        setParams(p, { replace: true });
    };

    const done = () => {
        setDialog(null);
        channels.reload();
    };

    /** A change over several channels as one job: channel by channel, progress in the toast. */
    const stepJob = async (label: string, verb: string, ids: string[], step: (id: string) => Promise<ChannelResult[]>) => {
        setDialog(null);
        await run({ label, detail: t("channels.count", { count: ids.length }), icon: "inv_letter_15", describe: (m: string) => ({ message: m }) }, async (update) => {
            const results = await runInSteps(ids, step, {
                onProgress: (n, total) => update({ progress: n / total, detail: t("channels.jobs.progress", { done: n, total }) }),
            });
            const { message, failed } = resultMessage(results, verb);
            if (failed) throw new Error(message);
            return message;
        });
        setSelected(new Set());
        channels.reload();
    };

    const applyChanges = (ids: string[], changes: ChannelChanges, label = t("channels.jobs.change")) => stepJob(
        label, t("channels.jobs.changed"), ids, (id) => patchChannels([id], changes).then((r) => r.results),
    );

    const applyRename = (rows: RenamePreviewRow[]) => {
        const target = new Map(rows.map((r) => [r.id, r.to]));
        return stepJob(t("channels.jobs.renameSchema"), t("channels.jobs.renamed"), rows.map((r) => r.id), (id) => patchChannels([id], { name: target.get(id) }).then((r) => r.results));
    };

    const archiveNow = (ids: string[]) => stepJob(t("channels.jobs.archive"), t("channels.jobs.archived"), ids, (id) => archiveChannels([id]).then((r) => r.results));

    const askArchive = (ids: string[], categoryName: string) => ask({
        title: ids.length === 1
            ? t("channels.jobs.archiveTitleOne", { name: byId.get(ids[0])?.name || t("channels.page.channelFallback") })
            : t("channels.jobs.archiveTitleMany", { count: ids.length }),
        text: t("channels.jobs.archiveText", { category: categoryName }),
        action: t("channels.jobs.archive"),
        tone: "primary",
        icon: "inv_letter_15",
    });

    const archive = async (ids: string[]) => {
        if (!data) return;
        if (!data.archive.categoryId) {
            setDialog({ kind: "archive-settings", then: ids });
            return;
        }
        const category = data.categories.find((c) => c.id === data.archive.categoryId);
        if (await askArchive(ids, category?.name || t("channels.page.archiveFallback"))) await archiveNow(ids);
    };

    const remove = async (ids: string[], confirm: string, anywhere = false) => {
        setDialog(null);
        await run({ label: anywhere ? t("channels.jobs.deleteAnywhere") : t("channels.jobs.deleteArchive"), detail: t("channels.count", { count: ids.length }), icon: "inv_letter_15", describe: (m: string) => ({ message: m }) }, async () => {
            // One request: the server checks the confirmation for the whole set and
            // deletes one channel after another with a pause.
            const result = await deleteChannels(ids, confirm, anywhere);
            if (result.failed) throw new Error(result.message);
            return result.message;
        });
        setSelected(new Set());
        channels.reload();
    };

    const quickCreate = async (input: QuickCreateInput, count: number) => {
        setDialog(null);
        const label = input.withEvent ? t("channels.jobs.createWithEvents") : t("channels.jobs.create");
        // The message carries one line per channel whose event failed (the toast keeps the line breaks).
        await run({ label, detail: t("channels.jobs.bySchema", { count }), icon: "inv_letter_15", expectedSeconds: Math.max(2, count * (input.withEvent ? 3 : 1)), describe: (m: string) => ({ message: m }) }, async () => {
            const result = await quickCreateChannels(input);
            if (result.failed) throw new Error(result.message || t("channels.jobs.createFailed"));
            return result.message || t("channels.jobs.created");
        });
        channels.reload();
    };

    const saveArchiveSettings = async (input: ArchiveSettingsInput, then?: string[]) => {
        setDialog(null);
        const saved = await run({ label: t("channels.jobs.archiveSettings"), icon: "inv_letter_15", describe: () => ({ message: t("channels.jobs.archiveSaved") }) }, () => saveChannelConfig(input));
        if (!saved) return;
        const fresh = await getChannels().catch(() => null);
        if (fresh) setData(fresh);
        // Archiving was what brought the admin here: carry on with the archive in place.
        if (then?.length && fresh?.archive.categoryId) {
            const category = fresh.categories.find((c) => c.id === fresh.archive.categoryId);
            if (await askArchive(then, category?.name || t("channels.page.archiveFallback"))) await archiveNow(then);
        }
    };

    if (channels.error) return <div className="empty">{tParts("channels.page.loadError", { error: channels.error.message })}</div>;
    if (!data) return <RaidLoader text={t("channels.page.loading")} />;

    if (!data.activeGuildId) {
        return (
            <>
                <PageHead icon="inv_letter_15" tone="channels" kicker={t("channels.page.kicker")} title={t("channels.page.title")} />
                <div className="empty">{t("channels.page.pickServer")}</div>
            </>
        );
    }

    const past = pastEventChannels(data);
    const inUse = data.channels.filter((c) => !data.archive.categoryId || c.parentId !== data.archive.categoryId).length;
    const deleteNames = dialog?.kind === "delete" ? dialog.ids.map((id) => byId.get(id)?.name || id) : [];

    return (
        <div className={`kn-page${selected.size ? " has-bulk" : ""}`}>
            <PageHead
                icon="inv_letter_15"
                tone="channels"
                kicker={[t("channels.page.kicker"), data.guildName].filter(Boolean).join(" · ")}
                title={t("channels.page.title")}
                meta={(
                    <>
                        {!data.connected && <Badge tone="mid" tip={t("channels.page.offline")} tipSub={t("channels.page.offlineSub")}>{t("channels.page.offline")}</Badge>}
                        {data.connected && data.canManage === false && <Badge tone="bad" tip={t("channels.page.noManageTip")} tipSub={t("channels.page.noManageSub")}>{t("channels.page.noManage")}</Badge>}
                    </>
                )}
                action={canWrite ? (
                    <SplitButton
                        label={t("common.create")}
                        icon="inv_letter_15"
                        onClick={() => setDialog({ kind: "quick" })}
                        menuTip={t("channels.page.createMore")}
                        options={[{ id: "single", label: t("channels.page.createSingle"), onSelect: () => setDialog({ kind: "create" }) }]}
                    />
                ) : undefined}
            />

            <div className="kn-tabs">
                <Segment
                    ariaLabel={t("channels.page.view")}
                    value={tab}
                    onChange={switchTab}
                    options={[
                        { value: "channels", label: t("channels.page.tabChannels", { count: inUse }) },
                        { value: "archive", label: t("channels.page.tabArchive", { count: data.archive.count }) },
                    ]}
                />
                {data.archive.overdue > 0 && (
                    <Badge tone="mid" tip={t("channels.page.waitingTip")} tipSub={t("channels.page.waitingSub", { overdue: data.archive.overdue, days: data.archive.hintDays })}>
                        {tParts("channels.page.waiting", { count: data.archive.count })}
                    </Badge>
                )}
            </div>

            <div className="kn-layout">
                {tab === "channels"
                    ? (
                        <ChannelTree
                            data={data}
                            selected={selected}
                            onSelect={select}
                            canWrite={canWrite}
                            onRename={(channel, name) => applyChanges([channel.id], { name }, t("channels.jobs.renameOne", { name: channel.name }))}
                            onEdit={(channel) => setDialog({ kind: "edit", channel })}
                            onDuplicate={(channel) => setDialog({ kind: "duplicate", channel })}
                            onDelete={(channel) => setDialog({ kind: "delete", ids: [channel.id], anywhere: true })}
                            onSchema={(categoryId) => setDialog({ kind: "schema", categoryId })}
                        />
                    )
                    : (
                        <ArchiveTab
                            data={data}
                            selected={selected}
                            onSelect={select}
                            canWrite={canWrite}
                            onDelete={(ids) => setDialog({ kind: "delete", ids })}
                            onSettings={() => setDialog({ kind: "archive-settings" })}
                        />
                    )}

                <aside className="kn-side">
                    <div className="kn-figures">
                        <Figure label={t("channels.page.figChannels")} value={inUse} tip={t("channels.page.figChannelsTip")} tipSub={t("channels.page.figChannelsSub")} />
                        <Figure
                            label={t("channels.page.figPast")}
                            value={past.length}
                            tone={past.length ? "mid" : undefined}
                            tip={t("channels.page.figPastTip")}
                            tipSub={canWrite && past.length ? t("channels.page.figPastPick") : t("channels.page.figPastSub")}
                            onClick={canWrite && past.length ? () => {
                                if (tab !== "channels") switchTab("channels");
                                select(past.map((c) => c.id), true);
                            } : undefined}
                        />
                        <Figure
                            label={t("channels.page.figArchive")}
                            value={data.archive.count}
                            tone={data.archive.overdue ? "mid" : undefined}
                            tip={t("channels.page.figArchiveTip")}
                            tipSub={data.archive.categoryId ? t("channels.page.figArchiveSub", { days: data.archive.hintDays }) : t("channels.page.figArchiveNone")}
                            onClick={() => switchTab("archive")}
                        />
                    </div>
                    {/* The purposes as a panel of their own: label, the three counts, one way in.
                        What used to be a sentence here is the label's tooltip; the archive
                        settings live in the archive tab, which the figure above opens. */}
                    <div className="kn-figures kn-purposes">
                        <div className="kn-purposes-head">
                            <span className="kn-kicker" tabIndex={0} data-tip={t("channels.page.purposes")} data-tip-sub={t("channels.page.purposesSub")}>{t("channels.page.purposes")}</span>
                            <IconButton size="sm" icon={<TagIcon />} tip={t("channels.page.allPurposes")} tipSub={t("channels.page.allPurposesSub")} onClick={() => setDialog({ kind: "purposes" })} />
                        </div>
                        <span className="kn-chips">
                            <PurposeSummaryBadges data={data} />
                        </span>
                    </div>
                </aside>
            </div>

            {canWrite && tab === "channels" && (
                <BulkBar
                    count={selectedChannels.length}
                    guildName={data.guildName}
                    onEdit={(focus) => setDialog({ kind: "bulk", focus })}
                    onRename={() => setDialog({ kind: "rename" })}
                    onArchive={() => archive(selectedChannels.map((c) => c.id))}
                    onDelete={() => setDialog({ kind: "delete", ids: selectedChannels.map((c) => c.id), anywhere: true })}
                    onClear={() => setSelected(new Set())}
                />
            )}
            {canWrite && tab === "archive" && (
                <BulkBar
                    count={selectedChannels.length}
                    guildName={data.guildName}
                    archiveLabel={t("channels.page.deleteMore")}
                    onArchive={() => setDialog({ kind: "delete", ids: selectedChannels.map((c) => c.id) })}
                    onClear={() => setSelected(new Set())}
                />
            )}

            {dialog?.kind === "purposes" && (
                <PurposesDialog data={data} canEdit={canEditPurposes} onEdit={(purpose) => setDialog({ kind: "purpose", purpose })} onClose={() => setDialog(null)} />
            )}
            {dialog?.kind === "purpose" && (
                <PurposeDialog purpose={dialog.purpose} data={data} onClose={() => setDialog(null)} onSaved={done} />
            )}
            {dialog?.kind === "assign" && (
                <AssignChannelDialog channel={dialog.channel} data={data} onClose={() => setDialog(null)} onSaved={done} />
            )}
            {dialog?.kind === "duplicate" && (
                <DuplicateChannelDialog source={dialog.channel} data={data} onClose={() => setDialog(null)} onDone={done} />
            )}
            {dialog?.kind === "create" && (
                <CreateChannelDialog data={data} canAssign={canEditPurposes} onClose={() => setDialog(null)} onDone={done} />
            )}
            {dialog?.kind === "quick" && (
                <QuickCreateDialog data={data} onClose={() => setDialog(null)} onCreate={quickCreate} />
            )}
            {dialog?.kind === "schema" && (
                <CategorySchemaDialog data={data} categoryId={dialog.categoryId} onClose={() => setDialog(null)} onSaved={done} />
            )}
            {dialog?.kind === "edit" && (
                <ChannelEditDialog
                    channel={dialog.channel}
                    data={data}
                    canAssign={canEditPurposes}
                    onClose={() => setDialog(null)}
                    onSave={(changes) => applyChanges([dialog.channel.id], changes, t("channels.jobs.changeOne", { name: dialog.channel.name }))}
                    onArchive={() => {
                        const id = dialog.channel.id;
                        setDialog(null);
                        archive([id]);
                    }}
                    onAssign={() => setDialog({ kind: "assign", channel: dialog.channel })}
                />
            )}
            {dialog?.kind === "bulk" && (
                <BulkEditDialog
                    channels={selectedChannels}
                    data={data}
                    focus={dialog.focus}
                    onClose={() => setDialog(null)}
                    onApply={(changes) => applyChanges(selectedChannels.map((c) => c.id), changes)}
                />
            )}
            {dialog?.kind === "rename" && (
                <RenameSchemaDialog channels={selectedChannels} data={data} onClose={() => setDialog(null)} onApply={applyRename} />
            )}
            {dialog?.kind === "delete" && (
                <DeleteChannelsDialog
                    names={deleteNames}
                    kicker={dialog.anywhere ? t("channels.page.title") : t("channels.page.archiveFallback")}
                    warnings={dialog.anywhere ? deleteWarnings(dialog.ids, data) : []}
                    onClose={() => setDialog(null)}
                    onConfirm={(confirm) => remove(dialog.ids, deleteNames.length === 1 ? confirm : BULK_DELETE_WORD, !!dialog.anywhere)}
                />
            )}
            {dialog?.kind === "archive-settings" && (
                <ArchiveSettingsDialog data={data} onClose={() => setDialog(null)} onSave={(input) => saveArchiveSettings(input, dialog.then)} />
            )}
        </div>
    );
}
