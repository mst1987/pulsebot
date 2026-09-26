import { useRef, useState, type ReactNode } from "react";
import { IconButton } from "../../components/ui/Button";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { DotsIcon } from "./ClaIcons";

// ---- row menu ----

export type MenuItem = { id: string; label: string; icon: ReactNode; onSelect?: () => void; href?: string; external?: boolean; danger?: boolean } | "sep";

/** "⋯" icon button with a popover of the row's rarely needed actions. */
export function RowMenu({ items, label }: { items: MenuItem[]; label: string }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useDismiss(ref, open, () => setOpen(false));

    // no separator at the start, the end, or twice in a row
    const clean = items.filter((it, i, all) => it !== "sep" || (i > 0 && i < all.length - 1 && all[i - 1] !== "sep"));

    return (
        <div className="la-menu" ref={ref}>
            <IconButton
                icon={<DotsIcon />} tip={t("cla.menu.more")} size="sm" aria-label={label}
                aria-haspopup="menu" aria-expanded={open}
                className={open ? "on" : undefined}
                onClick={() => setOpen((o) => !o)}
            />
            {open && (
                <div className="la-menu-pop" role="menu">
                    {clean.map((it, i) => {
                        if (it === "sep") return <div key={`sep-${i}`} className="la-msep" role="separator" />;
                        const cls = `la-mi${it.danger ? " danger" : ""}`;
                        return it.href
                            ? (
                                <a
                                    key={it.id} role="menuitem" className={cls} href={it.href}
                                    {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                    onClick={() => setOpen(false)}
                                >{it.icon}{it.label}</a>
                            )
                            : (
                                <button key={it.id} type="button" role="menuitem" className={cls} onClick={() => { setOpen(false); it.onSelect?.(); }}>
                                    {it.icon}{it.label}
                                </button>
                            );
                    })}
                </div>
            )}
        </div>
    );
}
