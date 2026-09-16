import { Link } from "react-router-dom";
import type { ChannelPurpose, ChannelsData } from "../../api";
import { Badge, IconButton, IconTile, Modal } from "../ui";
import { CheckIcon } from "../icons";
import { ChannelChip, PencilIcon, StatusBadge } from "./channelBits";

// What the bot uses which channel for (design issue #216). Since the tree
// (#259) the purposes stand in each channel's tooltip; the full table opens as
// a dialog from the page's side panel, so the page itself stays one list.

export function PurposeList({ data, canEdit, onEdit }: {
    data: ChannelsData;
    canEdit: boolean;
    onEdit: (purpose: ChannelPurpose) => void;
}) {
    return (
        <div className="kn-table" role="table" aria-label="Zwecke">
            <div className="kn-purpose kn-th" role="row">
                <span role="columnheader" data-tip="Zweck" data-tip-sub="Wofür der Bot die Kanäle benutzt. Hover über den Namen erklärt, was er dort tut.">Zweck</span>
                <span role="columnheader">Kanal</span>
                <span role="columnheader" data-tip="Status" data-tip-sub="Ob der Zweck gesetzt ist, der Kanal noch existiert und der Bot dort darf, was er muss.">Status</span>
                <span role="columnheader" />
            </div>
            {data.purposes.map((p) => (
                <div key={p.id} className="kn-purpose" role="row" data-purpose={p.id}>
                    <div className="kn-purpose-name">
                        <IconTile icon={p.icon} tone={p.ids.length ? "channels" : "bad"} />
                        <span className="tipped" tabIndex={0} data-tip={p.label} data-tip-sub={p.hint}>{p.label}</span>
                    </div>
                    <div className="kn-chips">
                        {p.items.length
                            ? p.items.map((i) => (
                                <ChannelChip
                                    key={i.id}
                                    name={i.found ? i.name : i.id}
                                    category={p.kind === "category"}
                                    missing={!i.found}
                                    tip={i.found ? undefined : i.status.label}
                                    tipSub={i.found ? undefined : i.status.tip}
                                />
                            ))
                            : <span className="kn-muted">nicht gesetzt</span>}
                    </div>
                    <div><StatusBadge status={p.status} /></div>
                    <div className="kn-actions">
                        {canEdit
                            ? <IconButton size="sm" icon={<PencilIcon />} tip={`${p.label} zuordnen`} tipSub={p.multiple ? "Mehrere möglich." : undefined} onClick={() => onEdit(p)} />
                            : (
                                <Link
                                    className="ibtn sm"
                                    to={`/settings?section=${encodeURIComponent(p.section)}`}
                                    aria-label="In Einstellungen öffnen"
                                    data-tip="In Einstellungen öffnen"
                                    data-tip-sub="Zwecke sind Einstellungen — ändern braucht Schreibrecht auf Einstellungen."
                                >
                                    <PencilIcon />
                                </Link>
                            )}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** The summary badges of the purposes ("5 gesetzt · 1 fehlt"). */
export function PurposeSummaryBadges({ data }: { data: ChannelsData }) {
    const { set, missing, warnings } = data.purposeSummary;
    return (
        <>
            <Badge tone="ok" icon={<CheckIcon />}>{set} gesetzt</Badge>
            {missing > 0 && <Badge tone="bad">{missing} fehlt</Badge>}
            {warnings > 0 && <Badge tone="mid" tip="Gesetzt, wirkt aber nicht" tipSub="Kanal fehlt oder der Bot darf dort nicht lesen/schreiben — Details am Status.">{warnings} {warnings === 1 ? "Warnung" : "Warnungen"}</Badge>}
        </>
    );
}

export function PurposesDialog({ data, canEdit, onEdit, onClose }: {
    data: ChannelsData;
    canEdit: boolean;
    onEdit: (purpose: ChannelPurpose) => void;
    onClose: () => void;
}) {
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_note_02"
            tone="channels"
            kicker="Kanäle › Zwecke"
            title="Wofür der Bot welche Kanäle nutzt"
            width={920}
            hint={<span className="kn-chips"><PurposeSummaryBadges data={data} /></span>}
        >
            <PurposeList data={data} canEdit={canEdit} onEdit={onEdit} />
        </Modal>
    );
}
