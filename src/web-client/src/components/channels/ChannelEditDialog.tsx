import { useState, type FormEvent } from "react";
import type { Channel, ChannelChanges, ChannelsData } from "../../api";
// ChannelChanges is the shape onSave hands over.
import { Badge, Button, Modal } from "../ui";
import { ChannelTypeIcon, PurposeBadge, StatusBadge, TagIcon } from "./channelBits";
import { ChannelStatusBadges } from "./ChannelTree";
import { changedFields, isTextLike, rightsStatus, SLOWMODE_OPTIONS, slowmodeLabel } from "../../lib/channels";
import { normalizeForType } from "../../lib/channelNames";

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
            kicker={`Kanäle › ${channel.category || "Ohne Kategorie"}`}
            title={`#${channel.name} bearbeiten`}
            width={620}
            initialFocus="#kn-edit-name"
            hint={channel.parentId !== archiveId
                ? <Button variant="ghost" size="sm" onClick={onArchive}>Archivieren …</Button>
                : <Badge>im Archiv</Badge>}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
                    <Button type="submit" form="kn-edit" disabled={!n}>Speichern</Button>
                </>
            )}
        >
            <form id="kn-edit" className="kn-dlg-stack" onSubmit={submit}>
                <div className="kn-field">
                    <label htmlFor="kn-edit-name">Name</label>
                    <div className="kn-input">
                        {textLike && <span>#</span>}
                        <input id="kn-edit-name" type="text" value={name} maxLength={100} onChange={(e) => setName(normalizeForType(e.target.value, channel.type, false))} />
                    </div>
                </div>
                {textLike && (
                    <div className="kn-field">
                        <label htmlFor="kn-edit-topic">Thema</label>
                        <textarea id="kn-edit-topic" className="kn-textarea" rows={3} maxLength={1024} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="kein Thema" />
                    </div>
                )}
                <div className="kn-grid2">
                    <div className="kn-field">
                        <label htmlFor="kn-edit-cat">Kategorie</label>
                        <select id="kn-edit-cat" className="kn-select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                            <option value="">— keine Kategorie —</option>
                            {data.categories.filter((c) => c.id !== archiveId || c.id === channel.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    {textLike && (
                        <div className="kn-field">
                            <label htmlFor="kn-edit-slow">Slowmode</label>
                            <select id="kn-edit-slow" className="kn-select" value={slowmode} onChange={(e) => setSlowmode(Number(e.target.value))}>
                                {SLOWMODE_OPTIONS.map((s) => <option key={s} value={s}>{slowmodeLabel(s)}</option>)}
                            </select>
                        </div>
                    )}
                </div>
                <div className="kn-field">
                    <label>Status</label>
                    <div className="kn-chips">
                        <ChannelStatusBadges channel={channel} data={data} />
                        {details?.permissionsLocked === true && <Badge tip="Rechte von der Kategorie" tipSub="Der Kanal übernimmt die Rechte seiner Kategorie. Verschieben ändert daran nichts — die Rechte bleiben, wie sie sind.">Rechte von Kategorie</Badge>}
                        {details?.permissionsLocked === false && <Badge tip="Eigene Rechte" tipSub="Der Kanal hat eigene Rechte, abweichend von der Kategorie. Rollen-Rechte werden in Discord gepflegt.">eigene Rechte</Badge>}
                        {rights && <StatusBadge status={rights} />}
                        {purposes.map((p) => <PurposeBadge key={p.id} purpose={p} />)}
                        {canAssign && textLike && <Button size="sm" variant="ghost" icon={<TagIcon />} onClick={onAssign}>Zweck zuordnen</Button>}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
