import type { ReactNode } from "react";
import type { Role, TextChannel } from "../api";
import Badge from "./ui/Badge";
import { InfoMarkIcon, LockIcon } from "./icons";

// Small pieces the Einstellungen page shares between its sections: the round
// info button that carries what used to be a paragraph of explanation, a field
// label with that button, the "Nur Voll-Admins" badge, the few line icons only
// this module draws (the shared ones are in ./icons), and the channel/role pickers that replace
// typed Discord ids. Local to this module on purpose (design issue #224); the
// shared building blocks in ./ui stay untouched.

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

/** The round "i": focusable, explains itself in the tooltip box. */
export function InfoTip({ head, sub }: { head: string; sub?: string }) {
    return (
        <span className="info" tabIndex={0} role="img" aria-label={head} data-tip={head} data-tip-sub={sub}>
            <InfoMarkIcon />
        </span>
    );
}

/** A field's name with the hint that used to sit under the input as a tooltip. */
export function FieldLabel({ children, htmlFor, tip, tipSub }: {
    children: ReactNode;
    htmlFor?: string;
    tip?: string;
    tipSub?: string;
}) {
    return (
        <div className="field-label">
            {htmlFor ? <label htmlFor={htmlFor}>{children}</label> : <span>{children}</span>}
            {tip && <InfoTip head={tip} sub={tipSub} />}
        </div>
    );
}

export function AdminOnlyBadge() {
    return (
        <Badge icon={<LockIcon />} tip="Nur Voll-Admins" tipSub="Rollen mit Schreibrecht auf „Einstellungen“ sehen diesen Block nicht und können ihn nicht speichern.">
            Nur Voll-Admins
        </Badge>
    );
}

/**
 * A text channel by name. The id stays the stored value and sits in the
 * option's tooltip; an id the bot does not list (deleted channel, bot offline)
 * stays selectable as "unbekannt", and without any list the field is the old
 * id input, so nothing becomes unsavable while Discord is away.
 */
export function ChannelPicker({ id, value, channels, onChange, placeholder = "— kein Kanal —" }: {
    id?: string;
    value: string;
    channels: TextChannel[];
    onChange: (next: string) => void;
    placeholder?: string;
}) {
    if (!channels.length) {
        return <input id={id} type="text" className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Discord-Channel-ID" />;
    }
    const known = !value || channels.some((c) => c.id === value);
    return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-tip={value ? `ID ${value}` : undefined}>
            <option value="">{placeholder}</option>
            {!known && <option value={value}>unbekannt ({value})</option>}
            {channels.map((c) => (
                <option key={c.id} value={c.id}>#{c.name}{c.category ? ` · ${c.category}` : ""}</option>
            ))}
        </select>
    );
}

/** A role by name — the same fallbacks as ChannelPicker. */
export function RolePicker({ id, value, roles, onChange, placeholder = "— keine Rolle —" }: {
    id?: string;
    value: string;
    roles: Role[];
    onChange: (next: string) => void;
    placeholder?: string;
}) {
    if (!roles.length) {
        return <input id={id} type="text" className="mono" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Discord-Rollen-ID" />;
    }
    const known = !value || roles.some((r) => r.id === value);
    return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} data-tip={value ? `ID ${value}` : undefined}>
            <option value="">{placeholder}</option>
            {!known && <option value={value}>unbekannt ({value})</option>}
            {roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>)}
        </select>
    );
}
