// The dropdown filter menus of the Kaderplaner's lists: one button per menu with
// the number of picks, the options with a check, an icon or an answer's colour
// dot where it helps and the count each would leave (lib/kader/filters.ts). The
// active picks show as removable chips (FilterChips).
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Chip } from "../../components/ui";
import { CheckIcon, ChevronDownIcon } from "../../components/ui/icons";
import { useDismiss } from "../../hooks/useDismiss";
import { useT } from "../../i18n";
import { chipsOf, countFor, toggle, type FilterDef, type FilterState } from "../../lib/kader/filters";
import { toneAttrs } from "../../lib/kader/colors";
import { ClassIcon, Count, RoleIcon, SpecIcon } from "./parts";
import { LeadAvatar } from "./Leads";
import type { KaderRole } from "../../api";

function OptionIcon({ icon }: { icon: NonNullable<FilterDef<unknown>["options"][number]["icon"]> }) {
    if (icon.kind === "class") return <ClassIcon classKey={icon.key} size={18} />;
    if (icon.kind === "spec") return <SpecIcon specKey={icon.key} size={18} />;
    return <RoleIcon role={icon.key as KaderRole} size={18} />;
}

export function FilterMenus<T>({ items, defs, state, onChange, children }: {
    items: T[];
    defs: FilterDef<T>[];
    state: FilterState;
    onChange: (next: FilterState) => void;
    /** More controls in the same row (search first, a segment, a button). */
    children?: ReactNode;
}) {
    const t = useT();
    const [open, setOpen] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, open !== null, () => setOpen(null));
    return (
        <div className="kp-filterrow" ref={ref}>
            {children}
            {defs.map((def) => {
                const n = (state[def.key] || []).length;
                return (
                    <div key={def.key} className="kp-menuwrap">
                        <button
                            type="button"
                            className={`kp-menubtn${n ? " kp-active" : ""}${open === def.key ? " kp-open" : ""}`}
                            aria-expanded={open === def.key}
                            aria-haspopup="true"
                            onClick={() => setOpen(open === def.key ? null : def.key)}
                        >
                            {def.label}
                            {n > 0 && <span className="kp-menubadge">{n}</span>}
                            <ChevronDownIcon />
                        </button>
                        {open === def.key && (
                            <div className="kp-menu" role="menu" aria-label={def.label}>
                                {def.options.map((o) => {
                                    const checked = (state[def.key] || []).includes(o.value);
                                    return (
                                        <button key={o.value} type="button" role="menuitemcheckbox" aria-checked={checked} className="kp-menuopt" onClick={() => onChange(toggle(state, def.key, o.value))}>
                                            <span className={`kp-check${checked ? " kp-on" : ""}`}>{checked && <CheckIcon />}</span>
                                            {o.icon && <OptionIcon icon={o.icon} />}
                                            {o.lead !== undefined && <LeadAvatar userId={o.lead} size={18} />}
                                            {o.tone && <span className="kp-tonedot" aria-hidden="true" {...toneAttrs(o.tone)} />}
                                            <span className={`kp-grow${o.color ? " class-colored" : ""}`} style={o.color ? { "--cc": o.color } as CSSProperties : undefined}>{o.label}</span>
                                            <Count n={countFor(items, defs, state, def, o)} tip={t("kader.playersN", { count: countFor(items, defs, state, def, o) })} className="kp-count-quiet" />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/** The active picks as chips, with "Alle entfernen". */
export function FilterChips<T>({ defs, state, onChange }: { defs: FilterDef<T>[]; state: FilterState; onChange: (next: FilterState) => void }) {
    const t = useT();
    const chips = chipsOf(defs, state);
    if (!chips.length) return null;
    return (
        <>
            {chips.map((c) => <Chip key={`${c.key}-${c.value}`} onRemove={() => onChange(toggle(state, c.key, c.value))} removeLabel={t("kader.filter.remove", { label: c.label })}>{c.label}</Chip>)}
            <button type="button" className="kp-link" onClick={() => onChange({})}>{t("kader.filter.clear")}</button>
        </>
    );
}
