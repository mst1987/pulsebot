import { useState, type FormEvent } from "react";
import type { Channel, ChannelChanges, ChannelsData } from "../../api";
// ChannelChanges is the shape onSave hands over.
import { Badge, Button, Modal } from "../ui";
import { ChannelTypeIcon, PurposeBadge, StatusBadge, TagIcon } from "./channelBits";
import { ChannelStatusBadges } from "./ChannelTree";
import { changedFields, isTextLike, rightsStatus, SLOWMODE_OPTIONS, slowmodeLabel } from "../../lib/channels";
import { normalizeForType } from "../../lib/channelNames";
import { useT } from "../../i18n";

// The full edit of one channel (issue #259): name, topic, category, slowmode,
// what the rights look like, and the way into the archive. Saves only what
// changed (changedFields) — the same PATCH the bulk edit uses, with one id.

export function ChannelEditDialog({ channel, data, canAssign, onClose, onSave, onArchive, onAssign }: {
    channel: Channel;
    data: ChannelsData;
    /** Write access to Einstellungen — purposes are settings. */
    canAssign: boolean;
    onClose: () => void;
    onSave: (changes: ChannelChanges) => void;
    onArchive: () => void;
    onAssign: () => void;
}) {
    const t = useT();
    const details = data.details?.[channel.id];
    const [name, setName] = useState(channel.name);
    const [topic, setTopic] = useState(details?.topic || "");
    const [parentId, setParentId] = useState(channel.parentId || "");
    const [slowmode, setSlowmode] = useState(details?.rateLimitPerUser || 0);
    const changes = changedFields(channel, data, { name, topic, parentId, slowmode });
    const n = Object.keys(changes).length;
    const archiveId = data.archive?.categoryId || "";
    const purposes = data.purposes.filter((p) => p.kind === "channel" && p.ids.includes(channel.id));
    const rights = rightsStatus(channel, isTextLike(channel) ? "send" : null, data.connected);
    const textLike = isTextLike(channel);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (n) onSave(changes);
    };

    return (
        <Modal
            open
            onClose={onClose}
            icon={<ChannelTypeIcon type={channel.type} />}
            tone="channels"
            kicker={t("channels.kickerPath", { name: channel.category || t("channels.noCategory") })}
            title={t("channels.edit.title", { name: channel.name })}
            width={620}
            initialFocus="#kn-edit-name"
            hint={channel.parentId !== archiveId
                ? <Button variant="ghost" size="sm" onClick={onArchive}>{t("channels.edit.archive")}</Button>
                : <Badge>{t("channels.edit.inArchive")}</Badge>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="submit" form="kn-edit" disabled={!n}>{t("common.save")}</Button>
                </>
            )}
        >
            <form id="kn-edit" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-edit-name">{t("common.name")}</label>
                    <div className="kn-input">
                        {textLike && <span>#</span>}
                        <input id="kn-edit-name" type="text" value={name} maxLength={100} onChange={(e) => setName(normalizeForType(e.target.value, channel.type, false))} />
                    </div>
                </div>
                {textLike && (
                    <div className="kn-field">
                        <label htmlFor="kn-edit-topic">{t("channels.topic")}</label>
                        <textarea id="kn-edit-topic" className="kn-textarea" rows={3} maxLength={1024} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("channels.edit.noTopic")} />
                    </div>
                )}
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-edit-cat">{t("channels.category")}</label>
                        <select id="kn-edit-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                            <option value="">{t("channels.noCategoryOption")}</option>
                            {data.categories.filter((c) => c.id !== archiveId || c.id === channel.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    {textLike && (
                        <div className="kn-field">
                            <label htmlFor="kn-edit-slow">{t("channels.slowmode")}</label>
                            <select id="kn-edit-slow" className="kn-select" value={slowmode} onChange={(e) => setSlowmode(Number(e.target.value))}>
                                {SLOWMODE_OPTIONS.map((s) => <option key={s} value={s}>{slowmodeLabel(s)}</option>)}
                            </select>
                        </div>
                    )}
                </div>
                <div className="kn-field">
                    <label>{t("channels.edit.status")}</label>
                    <div className="kn-chips">
                        <ChannelStatusBadges channel={channel} data={data} />
                        {details?.permissionsLocked === true && <Badge tip={t("channels.edit.rightsCategoryTip")} tipSub={t("channels.edit.rightsCategorySub")}>{t("channels.edit.rightsCategory")}</Badge>}
                        {details?.permissionsLocked === false && <Badge tip={t("channels.edit.rightsOwnTip")} tipSub={t("channels.edit.rightsOwnSub")}>{t("channels.edit.rightsOwn")}</Badge>}
                        {rights && <StatusBadge status={rights} />}
                        {purposes.map((p) => <PurposeBadge key={p.id} purpose={p} />)}
                        {canAssign && textLike && <Button size="sm" variant="ghost" icon={<TagIcon />} onClick={onAssign}>{t("channels.edit.assign")}</Button>}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
