// Pieces several roster views show (#654-#657): the version line under a
// roster's name, its main Discord role as a chip, a member's avatar, a
// character chip (spec icon, name in class colour), the square status fields
// to pick one status, a −/+ stepper, and the calm notice that lists the role
// writes that did not go through. Styles in styles/rosters.css.
import type { CSSProperties, ReactNode } from "react";
import type { RosterHead, RosterMember, RosterRoleResult, RosterStatus } from "../../api";
import { useT } from "../../i18n";
import { InfoIcon, MinusIcon, PlusIcon } from "../../components/ui/icons";
import { STATUS_ORDER, initialOf } from "../../lib/roster/rosters";
import { charIcon, charLine, failedRoleLines, type AnyChar } from "../../lib/roster/rosterEdit";

/** The version dot and the line under a roster's name: version · raids. */
export function VersionLine({ versionId, parts }: { versionId: string; parts: string[] }) {
    return (
        <span className="rn-ver">
            <i className={`ver-dot ver-${versionId}`} aria-hidden="true" />
            {parts.filter(Boolean).join(" · ")}
        </span>
    );
}

/** The roster's main Discord role as a chip in the role's colour. */
export function RoleChip({ role }: { role: RosterHead["mainRole"] }) {
    const t = useT();
    if (!role) {
        return <span className="rn-role rn-role-none" data-tip={t("roster.overview.noRole")} data-tip-sub={t("roster.overview.noRoleSub")}><i />{t("roster.overview.noRole")}</span>;
    }
    return (
        <span className="rn-role" style={{ "--rc": role.color || "var(--muted)" } as CSSProperties}>
            <i />@{role.name || role.id}
        </span>
    );
}

/** A person's round avatar: the Discord picture, else the initial on the first character's class colour. */
export function MemberAvatar({ member, large = false }: { member: Pick<RosterMember, "avatarUrl" | "displayName" | "chars">; large?: boolean }) {
    const color = member.chars[0]?.classColor || "";
    const cls = large ? "rn-ava rn-ava-lg" : "rn-ava";
    if (member.avatarUrl) return <img className={cls} src={member.avatarUrl} alt="" loading="lazy" />;
    return <span className={cls} style={color ? { "--av": color } as CSSProperties : undefined} aria-hidden="true">{initialOf(member.displayName)}</span>;
}

/** One character chip: spec icon, the name in class colour; the first one emphasised, the others muted. */
export function CharChip({ char, first = true }: { char: AnyChar; first?: boolean }) {
    const t = useT();
    const icon = charIcon(char);
    const line = charLine(char);
    return (
        <span
            className={`rn-char${first ? " is-first" : " is-alt"}`}
            style={char.classColor ? { "--cc": char.classColor } as CSSProperties : undefined}
            data-tip={line || char.name}
            data-tip-sub={first ? t("roster.detail.firstChar") : t("roster.detail.otherChar")}
        >
            {icon ? <img src={icon} alt="" width={22} height={22} loading="lazy" /> : <span className="rn-char-ph" aria-hidden="true" />}
            <em className={char.classColor ? "class-colored" : undefined}>{char.name}</em>
        </span>
    );
}

/** The four square status fields as a single choice (the member drawer, the add dialog). */
export function StatusPicker({ value, onChange, disabled = false, label }: { value: RosterStatus; onChange: (s: RosterStatus) => void; disabled?: boolean; label: string }) {
    const t = useT();
    return (
        <div className="rn-states" role="radiogroup" aria-label={label}>
            {STATUS_ORDER.map((s) => (
                <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={value === s}
                    className={`rn-state${value === s ? " is-on" : ""}`}
                    data-st={s}
                    data-tip={t(`roster.status.${s}`)}
                    data-tip-sub={t(`roster.statusSub.${s}`)}
                    disabled={disabled}
                    onClick={() => { if (value !== s) onChange(s); }}
                >
                    <i aria-hidden="true" />{t(`roster.status.${s}`)}
                </button>
            ))}
        </div>
    );
}

/** A number with − and + (slots); the value is spoken with its word. */
export function Stepper({ label, icon, value, onChange, min = 0, max = 200, disabled = false, disabledTip }: {
    label: string;
    icon?: ReactNode;
    value: number;
    onChange: (next: number) => void;
    min?: number;
    max?: number;
    disabled?: boolean;
    disabledTip?: string;
}) {
    const t = useT();
    return (
        <div className="rn-step-ed" data-tip={disabled ? disabledTip : undefined}>
            <span className="rn-step-lbl">{icon}{label}</span>
            <div className="rn-stepper" role="group" aria-label={label}>
                <button type="button" aria-label={t("roster.form.less", { label })} disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))}><MinusIcon /></button>
                <b aria-live="polite">{value}</b>
                <button type="button" aria-label={t("roster.form.more", { label })} disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}><PlusIcon /></button>
            </div>
        </div>
    );
}

/** A calm info box: an icon and the text beside it. */
export function Notice({ children, tone }: { children: ReactNode; tone?: "warn" }) {
    return (
        <div className={`rn-notice${tone ? ` rn-notice-${tone}` : ""}`}>
            <InfoIcon />
            <div>{children}</div>
        </div>
    );
}

/** The role writes that did not go through, as a calm notice; nothing when every write worked. */
export function RoleResults({ results }: { results: RosterRoleResult[] | undefined }) {
    const t = useT();
    const lines = failedRoleLines(results);
    if (!lines.length) return null;
    return (
        <Notice tone="warn">
            <b>{t("roster.roles.failedHead")}</b>
            <ul className="rn-lines">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </Notice>
    );
}
