import { useState } from "react";
import WowIcon from "../../../components/ui/WowIcon";
import { CLASS_IDS, classIconOf } from "../../../lib/assign";
import { CLASS_COLOR, CLASS_ROLES, nextClassN, parseClassRef } from "../../../lib/classRefs";
import { useT } from "../../../i18n";

/**
 * "Klasse" as who does a task (or at whom): the nine classes as chips. A click adds the next one of that class (Hunter, Hunter 2 ...), the
 * classes the catalog suggests for this kind of task carry a mark, and an optional role limits the next ones added (Priest - healer). What is
 * chosen shows as removable chips; the raid's players fill them in automatically (lib/classRefs.ts), nothing else has to be chosen first.
 */
export default function ClassPicker({ refs, suggested, disabled, onAdd, onRemove, label }: {
    /** the class references chosen so far, in the target form ("Hunter:1[:role]") */
    refs: string[];
    /** the classes the catalog suggests for this kind of task */
    suggested: string[];
    disabled?: boolean;
    onAdd: (classId: string, n: number, role: string) => void;
    onRemove: (ref: string) => void;
    label: string;
}) {
    const t = useT();
    const [role, setRole] = useState("");
    return (
        <div className="rp-cpick" role="group" aria-label={label}>
            <span className="rp-kicker">{label}</span>
            <span className="rp-am-chips">
                {CLASS_IDS.map((c) => (
                    <button
                        key={c} type="button" disabled={disabled} className={`rp-fchip rp-classchip rp-cpick-chip${suggested.indexOf(c) >= 0 ? " is-suggested" : ""}`}
                        style={{ ["--cc" as string]: CLASS_COLOR[c] }} data-tip={`${t(`wow.class.${c}`)}${suggested.indexOf(c) >= 0 ? ` · ${t("raidBoard.class.suggested")}` : ""}`} aria-label={t(`wow.class.${c}`)}
                        onClick={() => onAdd(c, nextClassN(refs, c), role)}
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
            {refs.length > 0 && (
                <span className="rp-am-chips">
                    {refs.map((ref) => {
                        const q = parseClassRef(ref);
                        if (!q) return null;
                        return (
                            <span key={ref} className="rp-achip rp-cpick-sel" style={{ ["--cc" as string]: CLASS_COLOR[q.classId] }}>
                                <WowIcon name={classIconOf(q.classId)} size={16} />
                                <span>{t(`wow.class.${q.classId}`)}{q.n > 1 ? ` ${q.n}` : ""}{q.role ? ` (${t(`raidBoard.class.roles.${q.role}`)})` : ""}</span>
                                {!disabled && <button type="button" className="rp-achip-x" aria-label={t("raidBoard.assign.remove")} onClick={() => onRemove(ref)}>x</button>}
                            </span>
                        );
                    })}
                </span>
            )}
        </div>
    );
}
