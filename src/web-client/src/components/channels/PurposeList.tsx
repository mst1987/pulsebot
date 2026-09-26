import { Link } from "react-router-dom";
import type { ChannelPurpose, ChannelsData } from "../../api";
import { Badge, IconButton, IconTile, Modal } from "../ui";
import { CheckIcon } from "../icons";
import { ChannelChip, PencilIcon, StatusBadge } from "./channelBits";
import { purposeHint, purposeLabel } from "../../lib/channels";
import { tParts, useT } from "../../i18n";

// What the bot uses which channel for (design issue #216). Since the tree
// (#259) the purposes stand in each channel's tooltip; the full table opens as
// a dialog from the page's side panel, so the page itself stays one list.

export function PurposeList({ data, canEdit, onEdit }: {
    data: ChannelsData;
    canEdit: boolean;
    onEdit: (purpose: ChannelPurpose) => void;
}) {
    const t = useT();
    return (
        <div className="kn-table" role="table" aria-label={t("channels.purposeList.label")}>
            <div className="kn-purpose kn-th" role="row">
                <span role="columnheader" data-tip={t("channels.purposeList.purpose")} data-tip-sub={t("channels.purposeList.purposeSub")}>{t("channels.purposeList.purpose")}</span>
                <span role="columnheader">{t("channels.purposeList.channel")}</span>
                <span role="columnheader" data-tip={t("channels.purposeList.status")} data-tip-sub={t("channels.purposeList.statusSub")}>{t("channels.purposeList.status")}</span>
                <span role="columnheader" />
            </div>
            {data.purposes.map((p) => (
                <div key={p.id} className="kn-purpose" role="row" data-purpose={p.id}>
                    <div className="kn-purpose-name">
                        <IconTile icon={p.icon} tone={p.ids.length ? "channels" : "bad"} />
                        <span className="tipped" tabIndex={0} data-tip={purposeLabel(p)} data-tip-sub={purposeHint(p)}>{purposeLabel(p)}</span>
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
                            : <span className="kn-muted">{t("channels.purposeList.notSet")}</span>}
                    </div>
                    <div><StatusBadge status={p.status} /></div>
                    <div className="kn-actions">
                        {canEdit
                            ? <IconButton size="sm" icon={<PencilIcon />} tip={t("channels.purposeList.assign", { label: purposeLabel(p) })} tipSub={p.multiple ? t("channels.purposeList.multiple") : undefined} onClick={() => onEdit(p)} />
                            : (
                                <Link
                                    className="ibtn sm"
                                    to={`/settings?section=${encodeURIComponent(p.section)}`}
                                    aria-label={t("channels.purposeList.openSettings")}
                                    data-tip={t("channels.purposeList.openSettings")}
                                    data-tip-sub={t("channels.purposeList.openSettingsSub")}
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
    const t = useT();
    const { set, missing, warnings } = data.purposeSummary;
    return (
        <>
            <Badge tone="ok" icon={<CheckIcon />}>{tParts("channels.purposeList.set", { count: set })}</Badge>
            {missing > 0 && <Badge tone="bad">{tParts("channels.purposeList.missing", { count: missing })}</Badge>}
            {warnings > 0 && <Badge tone="mid" tip={t("channels.purposeList.warningsTip")} tipSub={t("channels.purposeList.warningsSub")}>{t("channels.purposeList.warnings", { count: warnings })}</Badge>}
        </>
    );
}

export function PurposesDialog({ data, canEdit, onEdit, onClose }: {
    data: ChannelsData;
    canEdit: boolean;
    onEdit: (purpose: ChannelPurpose) => void;
    onClose: () => void;
}) {
    const t = useT();
    return (
        <Modal
            open
            onClose={onClose}
            icon="inv_misc_note_02"
            tone="channels"
            kicker={t("channels.purposeList.dialogKicker")}
            title={t("channels.purposeList.dialogTitle")}
            width={920}
            hint={<span className="kn-chips"><PurposeSummaryBadges data={data} /></span>}
        >
            <PurposeList data={data} canEdit={canEdit} onEdit={onEdit} />
        </Modal>
    );
}
