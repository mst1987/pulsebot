import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import WowIcon from "../../../components/ui/WowIcon";
import { CLASS_IDS, classIconOf, classPlaceName, classRefIcon } from "../../../lib/assign";
import { CLASS_COLOR, CLASS_ROLES, MAX_CLASS_N, classGroups, numbersLabel } from "../../../lib/classRefs";
import { useT } from "../../../i18n";

/** One chosen class (or general role) of a row: its icon, "Jäger 1-2" and the count stepper "- x2 +"; the cross takes it out. */
export function ClassCountChip({ classId, role, ns, disabled, onCount }: { classId: string; role: string; ns: number[]; disabled?: boolean; onCount: (count: number) => void }) {
    const t = useT();
    const count = ns.length;
    const name = classPlaceName(classId, role);
    return (
        <span className="rp-achip rp-cpick-sel rp-ccount" style={{ ["--cc" as string]: CLASS_COLOR[classId] }}>
            <WowIcon name={classRefIcon(classId, role)} size={16} />
            <span className="rp-ccount-name">{name} {numbersLabel(ns)}</span>
            {!disabled && (
                <span className="rp-ccount-step" role="group" aria-label={`${t("raidBoard.class.count")}: ${name}`}>
                    <button type="button" aria-label={t("raidBoard.class.fewer")} data-tip={t("raidBoard.class.fewer")} disabled={count <= 1} onClick={() => onCount(count - 1)}><Minus size={12} /></button>
                    <b className="rp-ccount-n" aria-live="polite">x{count}</b>
                    <button type="button" aria-label={t("raidBoard.class.more")} data-tip={t("raidBoard.class.more")} disabled={count >= MAX_CLASS_N} onClick={() => onCount(count + 1)}><Plus size={12} /></button>
                </span>
            )}
            {disabled && <b className="rp-ccount-n">x{count}</b>}
            {!disabled && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={() => onCount(0)}><X size={12} /></button>}
        </span>
    );
}

/**
 * "Klasse" as who does a task (or at whom): the nine classes as chips. A click asks for one more of that class (Jäger 1, then Jäger 2 ...;
 * the running number counts on over all rows of the same task, so a second misdirect row gets the next hunter). The classes the catalog
 * suggests for this kind of task carry a mark, and an optional role limits the next ones added (Priest - healer). What is chosen shows
 * as ONE chip per class with its count ("Jäger 1-2  - x2 +"); the raid's players fill them in automatically (lib/classRefs.ts).
 */
export default function ClassPicker({ refs, suggested, disabled, onAdd, onCount, label, defaultRole = "" }: {
    /** the role new references get (healing: healer, tanking: tank): the class alone is never enough */
    defaultRole?: string;
    /** the class references chosen so far (assignee or target form) */
    refs: string[];
    /** the classes the catalog suggests for this kind of task */
    suggested: string[];
    disabled?: boolean;
    /** one more of a class (and role) */
    onAdd: (classId: string, role: string) => void;
    /** the count of a class (and role) set to a number (0 = out) */
    onCount: (classId: string, role: string, count: number) => void;
    label: string;
}) {
    const t = useT();
    const [role, setRole] = useState(defaultRole);
    const groups = classGroups(refs);
    return (
        <div className="rp-cpick" role="group" aria-label={label}>
            <span className="rp-kicker">{label}</span>
            <span className="rp-am-chips">
                {CLASS_IDS.map((c) => (
                    <button
                        key={c} type="button" disabled={disabled} className={`rp-fchip rp-classchip rp-cpick-chip${suggested.indexOf(c) >= 0 ? " is-suggested" : ""}`}
                        style={{ ["--cc" as string]: CLASS_COLOR[c] }} data-tip={`${t(`wow.class.${c}`)}${suggested.indexOf(c) >= 0 ? ` · ${t("raidBoard.class.suggested")}` : ""}`} aria-label={t(`wow.class.${c}`)}
                        onClick={() => onAdd(c, role)}
                    >
                        <WowIcon name={classIconOf(c)} size={28} />
                    </button>
                ))}
            </span>
            <span className="rp-cpick-roles" role="group" aria-label={t("raidBoard.class.role")}>
                <span className="rp-muted">{t("raidBoard.class.role")}</span>
                {["", ...CLASS_ROLES.filter((r) => r !== "melee" && r !== "ranged")].map((r) => (
                    <button key={r || "any"} type="button" className={`rp-fchip${role === r ? " is-on" : ""}`} aria-pressed={role === r} onClick={() => setRole(r)}>{r ? t(`raidBoard.class.roles.${r}`) : t("raidBoard.class.anySpec")}</button>
                ))}
            </span>
            {groups.length > 0 && (
                <span className="rp-am-chips">
                    {groups.map((g) => <ClassCountChip key={`${g.classId}|${g.role}`} classId={g.classId} role={g.role} ns={g.ns} disabled={disabled} onCount={(n) => onCount(g.classId, g.role, n)} />)}
                </span>
            )}
        </div>
    );
}
