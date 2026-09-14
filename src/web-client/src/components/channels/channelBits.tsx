import type { ChannelPurpose, PurposeStatus } from "../../api";
import { Badge, WowIcon } from "../ui";
import { ChannelsIcon } from "../icons";
import { TYPE_ANNOUNCEMENT, TYPE_FORUM, TYPE_STAGE, TYPE_VOICE } from "../../lib/channels";

// Small pieces the Kanäle page and its dialogs share (design issue #216):
// line icons for the channel types and the two row actions, the mono channel
// chip, the purpose badge and the status badge.

export function VoiceIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
    );
}

export function AnnouncementIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10v4l11 5V5L3 10Z" />
            <path d="M18 9a4 4 0 0 1 0 6" />
        </svg>
    );
}

export function ForumIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16v10H9l-5 4V5Z" />
        </svg>
    );
}

export function StageIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="9" r="3" />
            <path d="M6 20a6 6 0 0 1 12 0" />
        </svg>
    );
}

export function TagIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12V4h8l10 10-8 8L3 12Z" />
            <circle cx="7.5" cy="8.5" r="1.5" />
        </svg>
    );
}

export function PencilIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
            <path d="m13.5 6.5 4 4" />
        </svg>
    );
}

/** The line icon for a Discord channel type. */
export function ChannelTypeIcon({ type }: { type: number }) {
    switch (type) {
        case TYPE_VOICE: return <VoiceIcon />;
        case TYPE_ANNOUNCEMENT: return <AnnouncementIcon />;
        case TYPE_FORUM: return <ForumIcon />;
        case TYPE_STAGE: return <StageIcon />;
        default: return <ChannelsIcon />;
    }
}

/** Mono chip "#name" — or, for a category, the name in capitals. */
export function ChannelChip({ name, category = false, missing = false, tip, tipSub }: {
    name: string;
    category?: boolean;
    missing?: boolean;
    tip?: string;
    tipSub?: string;
}) {
    return (
        <span className={`kn-chan${category ? " cat" : ""}${missing ? " missing" : ""}`} data-tip={tip} data-tip-sub={tipSub}>
            {!category && <i>#</i>}
            {name}
        </span>
    );
}

/** A status coming from the server (PurposeStatus) as a badge with its explanation. */
export function StatusBadge({ status }: { status: PurposeStatus }) {
    return (
        <Badge tone={status.tone || undefined} tip={status.tip ? status.label : undefined} tipSub={status.tip || undefined}>
            {status.label}
        </Badge>
    );
}

/** Badge "<icon> Raid-Anmeldung" on a channel row or a source card. */
export function PurposeBadge({ purpose, label }: { purpose: Pick<ChannelPurpose, "icon" | "label" | "hint">; label?: string }) {
    return (
        <Badge className="area" icon={purpose.icon} tip={purpose.label} tipSub={purpose.hint}>
            {label ?? purpose.label}
        </Badge>
    );
}

/** A purpose as a toggle chip with its WoW icon ("Gleich zuordnen", "Zweck zuordnen"). */
export function PurposeChip({ purpose, on, onToggle, disabled, tipSub }: {
    purpose: ChannelPurpose;
    on: boolean;
    onToggle: () => void;
    disabled?: boolean;
    tipSub?: string;
}) {
    return (
        <button
            type="button"
            className={`kn-zweck${on ? " on" : ""}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={onToggle}
            data-tip={purpose.label}
            data-tip-sub={tipSub ?? purpose.hint}
        >
            <WowIcon name={purpose.icon} size={20} />
            {purpose.label}
        </button>
    );
}
