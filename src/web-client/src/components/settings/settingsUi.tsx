import type { Role, TextChannel } from "../../api";
import Badge from "../ui/Badge";
import { LockIcon } from "../ui/icons";
import { tParts, useT } from "../../i18n";

// Small pieces the Einstellungen page shares between its sections: the
// "Nur Voll-Admins" badge and the channel/role pickers that replace typed
// Discord ids (design issue #224). Its line icons (pen, warning, check mark)
// joined the one icon source, ../ui/icons; field labels and the round info
// button are shared building blocks too: ../ui/Field.

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
            {!known && <option value={value}>{tParts("settings.ui.unknown", { id: value })}</option>}
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
            {!known && <option value={value}>{tParts("settings.ui.unknown", { id: value })}</option>}
            {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
        </select>
    );
}
