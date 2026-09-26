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
import "../styles/kanaele.css";
import RaidLoader from "../components/ui/RaidLoader";

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
        await run({ label, detail: `${ids.length} ${ids.length === 1 ? "Kanal" : "Kanäle"}`, icon: "inv_letter_15", describe: (m: string) => ({ message: m }) }, async (update) => {
            const results = await runInSteps(ids, step, {
                onProgress: (n, total) => update({ progress: n / total, detail: `${n} von ${total}` }),
            });
            const { message, failed } = resultMessage(results, verb);
            if (failed) throw new Error(message);
            return message;
        });
        setSelected(new Set());
        channels.reload();
    };

    const applyChanges = (ids: string[], changes: ChannelChanges, label = "Kanäle ändern") => stepJob(
        label, "geändert", ids, (id) => patchChannels([id], changes).then((r) => r.results),
    );

    const applyRename = (rows: RenamePreviewRow[]) => {
        const target = new Map(rows.map((r) => [r.id, r.to]));
        return stepJob("Umbenennen nach Schema", "umbenannt", rows.map((r) => r.id), (id) => patchChannels([id], { name: target.get(id) }).then((r) => r.results));
    };

    const archiveNow = (ids: string[]) => stepJob("Archivieren", "archiviert", ids, (id) => archiveChannels([id]).then((r) => r.results));

    const askArchive = (ids: string[], categoryName: string) => ask({
        title: ids.length === 1 ? `#${byId.get(ids[0])?.name || "Kanal"} archivieren?` : `${ids.length} Kanäle archivieren?`,
        text: `Sie wandern in „${categoryName}“, niemand kann dort mehr schreiben. Gelöscht wird nichts — das macht später ein Admin im Archiv.`,
        action: "Archivieren",
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
        if (await askArchive(ids, category?.name || "Archiv")) await archiveNow(ids);
    };

    const remove = async (ids: string[], confirm: string, anywhere = false) => {
        setDialog(null);
        await run({ label: anywhere ? "Kanäle löschen" : "Aus dem Archiv löschen", detail: `${ids.length} ${ids.length === 1 ? "Kanal" : "Kanäle"}`, icon: "inv_letter_15", describe: (m: string) => ({ message: m }) }, async () => {
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
        const label = input.withEvent ? "Kanäle und Events anlegen" : "Kanäle anlegen";
        // The message carries one line per channel whose event failed (the toast keeps the line breaks).
        await run({ label, detail: `${count} nach Schema`, icon: "inv_letter_15", expectedSeconds: Math.max(2, count * (input.withEvent ? 3 : 1)), describe: (m: string) => ({ message: m }) }, async () => {
            const result = await quickCreateChannels(input);
            if (result.failed) throw new Error(result.message || "Anlegen fehlgeschlagen.");
            return result.message || "Kanäle angelegt.";
        });
        channels.reload();
    };

    const saveArchiveSettings = async (input: ArchiveSettingsInput, then?: string[]) => {
        setDialog(null);
        const saved = await run({ label: "Archiv-Einstellungen", icon: "inv_letter_15", describe: () => ({ message: "Archiv gespeichert." }) }, () => saveChannelConfig(input));
        if (!saved) return;
        const fresh = await getChannels().catch(() => null);
        if (fresh) setData(fresh);
        // Archiving was what brought the admin here: carry on with the archive in place.
        if (then?.length && fresh?.archive.categoryId) {
            const category = fresh.categories.find((c) => c.id === fresh.archive.categoryId);
            if (await askArchive(then, category?.name || "Archiv")) await archiveNow(then);
        }
    };

    if (channels.error) return <div className="empty">Fehler beim Laden der Kanäle: {channels.error.message}</div>;
    if (!data) return <RaidLoader text="Kanäle werden geladen" />;

    if (!data.activeGuildId) {
        return (
            <>
                <PageHead icon="inv_letter_15" tone="channels" kicker="Discord-Server" title="Kanäle" />
                <div className="empty">Wähle oben einen Server, um Kanäle zu verwalten.</div>
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
                kicker={["Discord-Server", data.guildName].filter(Boolean).join(" · ")}
                title="Kanäle"
                meta={(
                    <>
                        {!data.connected && <Badge tone="mid" tip="Bot nicht verbunden" tipSub="Kanäle und Rechte kommen live aus Discord — ohne Verbindung bleibt die Liste leer.">Bot nicht verbunden</Badge>}
                        {data.connected && data.canManage === false && <Badge tone="bad" tip="Bot darf keine Kanäle verwalten" tipSub="Der Bot-Rolle fehlt „Kanäle verwalten“. Umbenennen, Archivieren und Anlegen schlagen fehl, bis das Recht in Discord gesetzt ist.">keine Kanal-Rechte</Badge>}
                    </>
                )}
                action={canWrite ? (
                    <SplitButton
                        label="Anlegen"
                        icon="inv_letter_15"
                        onClick={() => setDialog({ kind: "quick" })}
                        menuTip="Weitere Arten anzulegen"
                        options={[{ id: "single", label: "Einzelnen Kanal erstellen", onSelect: () => setDialog({ kind: "create" }) }]}
                    />
                ) : undefined}
            />

            <div className="kn-tabs">
                <Segment
                    ariaLabel="Ansicht"
                    value={tab}
                    onChange={switchTab}
                    options={[
                        { value: "channels", label: `Kanäle · ${inUse}` },
                        { value: "archive", label: `Archiv · ${data.archive.count}` },
                    ]}
                />
                {data.archive.overdue > 0 && (
                    <Badge tone="mid" tip="Archivierte Kanäle warten auf Löschung" tipSub={`${data.archive.overdue} davon länger als ${data.archive.hintDays} Tage. Gelöscht wird nie automatisch.`}>
                        {data.archive.count} warten auf Löschung
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
                            onRename={(channel, name) => applyChanges([channel.id], { name }, `#${channel.name} umbenennen`)}
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
                        <Figure label="Kanäle" value={inUse} tip="Kanäle in Benutzung" tipSub="Alle Kanäle des Servers außerhalb des Archivs." />
                        <Figure
                            label="Vergangene Events"
                            value={past.length}
                            tone={past.length ? "mid" : undefined}
                            tip="Kanäle vergangener Events"
                            tipSub={canWrite && past.length ? "Klick wählt sie alle aus — dann unten „Archivieren“." : "Kanäle, deren Event vorbei ist und die noch nicht im Archiv liegen."}
                            onClick={canWrite && past.length ? () => {
                                if (tab !== "channels") switchTab("channels");
                                select(past.map((c) => c.id), true);
                            } : undefined}
                        />
                        <Figure
                            label="Im Archiv, warten auf Löschung"
                            value={data.archive.count}
                            tone={data.archive.overdue ? "mid" : undefined}
                            tip="Archiv"
                            tipSub={data.archive.categoryId ? `Nach ${data.archive.hintDays} Tagen gelb markiert. Gelöscht wird nie automatisch — nur ein Admin im Archiv.` : "Noch keine Archiv-Kategorie festgelegt."}
                            onClick={() => switchTab("archive")}
                        />
                    </div>
                    {/* The purposes as a panel of their own: label, the three counts, one way in.
                        What used to be a sentence here is the label's tooltip; the archive
                        settings live in the archive tab, which the figure above opens. */}
                    <div className="kn-figures kn-purposes">
                        <div className="kn-purposes-head">
                            <span className="kn-kicker" tabIndex={0} data-tip="Zwecke" data-tip-sub="Wofür der Bot welche Kanäle nutzt (Log-, Bewerbungs-Kanal …). Am Kanal selbst stehen sie im Tooltip.">Zwecke</span>
                            <IconButton size="sm" icon={<TagIcon />} tip="Alle Zwecke" tipSub="Wofür der Bot welche Kanäle nutzt — alle auf einen Blick." onClick={() => setDialog({ kind: "purposes" })} />
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
                    archiveLabel="Löschen …"
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
                    onSave={(changes) => applyChanges([dialog.channel.id], changes, `#${dialog.channel.name} ändern`)}
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
                    kicker={dialog.anywhere ? "Kanäle" : "Archiv"}
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
