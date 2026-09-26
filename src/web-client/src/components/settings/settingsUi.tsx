import type { Role, TextChannel } from "../../api";
import Badge from "../ui/Badge";
import { LockIcon } from "../icons";
import { useT } from "../../i18n";

// Small pieces the Einstellungen page shares between its sections: the
// "Nur Voll-Admins" badge, the few line icons only this module draws (the
// shared ones are in ./icons) and the channel/role pickers that replace typed
// Discord ids (design issue #224). Field labels and the round info button are
// shared building blocks now: ./ui/Field.

export function PenIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
    );
}

export function WarnIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
    );
}

export function CheckMark() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
        </svg>
    );
}

export function AdminOnlyBadge() {
    const t = useT();
    return (
        <Badge icon={<LockIcon />} tip={t("settings.ui.adminOnly")} tipSub={t("settings.ui.adminOnlySub")}>
            {t("settings.ui.adminOnly")}
        </Badge>
    );
}

/**
 * A text channel by name. The id stays the stored value and sits in the
 * option's tooltip; an id the bot does not list (deleted channel, bot offline)
 * stays selectable as "unbekannt", and without any list the field is the old
 * id input, so nothing becomes unsavable while Discord is away.
 */
export function ChannelPicker({ id, value, channels, onChange, placeholder }: {
    id?: string;
    value: string;
    channels: TextChannel[];
    onChange: (next: string) => void;
    /** Default: "— kein Kanal —". */
    placeholder?: string;
}) {
    const t = useT();
    if (!channels.length) {
        return <input id={id} type="text" className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("settings.ui.channelIdPlaceholder")} />;
    }
    const known = !value || channels.some((c) => c.id === value);
    return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-tip={value ? `ID ${value}` : undefined}>
            <option value="">{placeholder ?? t("settings.ui.noChannel")}</option>
            {!known && <option value={value}>{t("settings.ui.unknown", { id: value })}</option>}
            {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>
            ))}
        </select>
    );
}

/** A role by name — the same fallbacks as ChannelPicker. */
export function RolePicker({ id, value, roles, onChange, placeholder }: {
    id?: string;
    value: string;
    roles: Role[];
    onChange: (next: string) => void;
    /** Default: "— keine Rolle —". */
    placeholder?: string;
}) {
    const t = useT();
    if (!roles.length) {
        return <input id={id} type="text" className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("settings.ui.roleIdPlaceholder")} />;
    }
    const known = !value || roles.some((r) => r.id === value);
    return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-tip={value ? `ID ${value}` : undefined}>
            <option value="">{placeholder ?? t("settings.ui.noRole")}</option>
            {!known && <option value={value}>{t("settings.ui.unknown", { id: value })}</option>}
            {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
        </select>
    );
}
