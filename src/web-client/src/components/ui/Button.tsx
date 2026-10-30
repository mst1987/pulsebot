import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import WowIcon from "./icons/WowIcon";
import { ChevronDownIcon } from "./icons/icons";
import { t } from "../../i18n";
import { useDismiss } from "../../hooks/useDismiss";

// One button system for the whole menu (see the "Bausteine" artboard of the
// Grundgerüst canvas). What a button does shows in its colour (styles/base.css):
//   primary — the main action / next step of a section (version accent): create, open, post,
//   go      — commit something positive, filled green: save, confirm, approve, sign up,
//   yes     — a positive choice beside a negative one, green outline (`pressed` fills it),
//   no      — say no without destroying anything, red outline: decline, absent, reject,
//   danger  — destructive (delete, remove, reset), always behind useConfirm(),
//   ghost   — neutral: cancel, close, back, details, filters, navigation,
//   run     — starts a job (spinner on the button, progress in the toast).
// A leading icon is a WoW icon when the action has a game meaning, otherwise a
// line icon from ../icons passed as a node.

export type ButtonVariant = "primary" | "ghost" | "run" | "danger" | "go" | "yes" | "no";

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

/** The class list a variant/size maps to — also used by links styled as buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md", hasIcon = false, extra = ""): string {
    return [
        "btn",
        variant === "primary" ? "" : `btn-${variant}`,
        size === "sm" ? "btn-sm" : "",
        hasIcon ? "has-icon" : "",
        extra,
    ].filter(Boolean).join(" ");
}

function iconNode(icon: string | ReactNode | undefined, size: "md" | "sm") {
    if (!icon) return null;
    return typeof icon === "string" ? <WowIcon name={icon} size={size === "sm" ? 18 : 22} /> : icon;
}

export function Button({ variant = "primary", size = "md", icon, running = false, pressed, className = "", type = "button", disabled, children, ...rest }: NativeButton & {
    variant?: ButtonVariant;
    size?: "md" | "sm";
    /** A WoW icon name, or a line icon node. */
    icon?: string | ReactNode;
    /** A `run` button whose job is going: spinner instead of the icon, inert. */
    running?: boolean;
    /** A `yes`/`no` choice that is the current one: filled, and aria-pressed for screen readers. */
    pressed?: boolean;
    children: ReactNode;
}) {
    return (
        <button
            {...rest}
            type={type}
            className={buttonClass(variant, size, !!icon || running, `${running ? "is-running" : ""} ${className}`.trim())}
            disabled={disabled || running}
            aria-busy={running || undefined}
            aria-pressed={pressed === undefined ? rest["aria-pressed"] : pressed}
        >
            {running ? <span className="btn-spin" aria-hidden="true" /> : iconNode(icon, size)}
            {children}
        </button>
    );
}

/**
 * A square icon-only button. `tip` is required: an icon alone says nothing to
 * someone who has not clicked it yet, and it is also the button's accessible name.
 * `tone` gives it the meaning colour before any hover: danger (red, deletes),
 * yes (green, approve/confirm), no (red, reject/decline); `pressed` fills yes/no.
 * ghost has no frame until hovered (a quiet × beside a value).
 */
export function IconButton({ icon, tip, tipSub, size = "md", tone, pressed, className = "", type = "button", ...rest }: Omit<NativeButton, "title"> & {
    icon: string | ReactNode;
    tip: string;
    tipSub?: string;
    size?: "md" | "sm";
    tone?: "danger" | "yes" | "no" | "ghost";
    pressed?: boolean;
}) {
    return (
        <button
            {...rest}
            type={type}
            className={["ibtn", size === "sm" ? "sm" : "", tone || "", className].filter(Boolean).join(" ")}
            aria-pressed={pressed === undefined ? rest["aria-pressed"] : pressed}
            aria-label={rest["aria-label"] || tip}
            data-tip={tip}
            data-tip-sub={tipSub}
        >
            {typeof icon === "string" ? <WowIcon name={icon} size={size === "sm" ? 20 : 24} /> : icon}
        </button>
    );
}

export type SplitOption = { id: string; label: string; icon?: string; onSelect: () => void; disabled?: boolean };

/** The main action plus a chevron that opens its variants ("In Discord posten ▾"). */
export function SplitButton({ label, icon, onClick, options, disabled, menuTip = t("common.moreOptions") }: {
    label: string;
    icon?: string | ReactNode;
    onClick: () => void;
    options: SplitOption[];
    disabled?: boolean;
    menuTip?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useDismiss(ref, open, () => setOpen(false));

    return (
        <div className="split" ref={ref}>
            <Button icon={icon} onClick={onClick} disabled={disabled}>{label}</Button>
            <button
                type="button"
                className="btn-caret"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={menuTip}
                data-tip={menuTip}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
            >
                <ChevronDownIcon />
            </button>
            {open && (
                <div className="split-menu" role="menu">
                    {options.map((o) => (
                        <button
                            key={o.id}
                            type="button"
                            role="menuitem"
                            disabled={o.disabled}
                            onClick={() => { setOpen(false); o.onSelect(); }}
                        >
                            {o.icon && <WowIcon name={o.icon} size={18} />}
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
