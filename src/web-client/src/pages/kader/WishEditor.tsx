// The wishes of one player: the ordered list with its add row (the interview and
// the "Specs bearbeiten" dialog), the add row on its own (AddSpecDialog) and the
// quiet pencil that opens that dialog (drawer, pool, overview).
import { useState } from "react";
import type { KaderWish } from "../../api";
import { Button, IconButton } from "../../components/ui";
import { ChevronDownIcon, EditIcon, PlusIcon, XIcon } from "../../components/ui/icons/icons";
import { useT } from "../../i18n";
import { MAX_WISHES, moveWish, placeWish } from "../../lib/kader/interview";
import { classDef, className, specName, specRole } from "../../lib/kader/model";
import { roleLabel } from "../../lib/wow/wowNames";
import { useKader } from "./kaderContext";
import { Grip, PickIcon, PickLabel, SpecIcon } from "./parts";

/**
 * A class and one of its spec icons, then the button. `onAdd` may answer later:
 * the choice is cleared unless it resolves to false (a refused save keeps it).
 */
export function WishAddRow({ wishes, busy = false, onAdd }: { wishes: KaderWish[]; busy?: boolean; onAdd: (pick: KaderWish) => void | Promise<boolean> }) {
    const t = useT();
    const { view } = useKader();
    const [cls, setCls] = useState("");
    const [spec, setSpec] = useState("");
    const def = classDef(view.classes, cls);
    const pick = cls && spec ? { className: cls, spec } : null;
    const known = !!pick && wishes.some((w) => w.spec === pick.spec);

    const pickClass = (key: string) => {
        setCls(key);
        const d = classDef(view.classes, key);
        setSpec(d && d.specs[0] ? d.specs[0].key : "");
    };
    const reset = () => {
        setCls("");
        setSpec("");
    };
    const add = () => {
        if (!pick || known || wishes.length >= MAX_WISHES) return;
        const answer = onAdd(pick);
        if (answer === undefined) reset();
        else void answer.then((ok) => { if (ok) reset(); });
    };

    return (
        <div className="kp-wishadd">
            <label className="field">
                <span className="field-label">{t("kader.field.class")}</span>
                <select value={cls} onChange={(e) => pickClass(e.target.value)}>
                    <option value="">{t("kader.interview.pickClass")}</option>
                    {view.classes.map((c) => <option key={c.key} value={c.key}>{className(view.classes, c.key)}</option>)}
                </select>
            </label>
            {def && (
                <div className="kp-specpick" role="radiogroup" aria-label={t("kader.field.spec")}>
                    {def.specs.map((s) => {
                        const on = spec === s.key;
                        const taken = wishes.some((w) => w.spec === s.key);
                        return (
                            <button key={s.key} type="button" role="radio" aria-checked={on} disabled={taken}
                                aria-label={`${specName(view.classes, s.key)} · ${className(view.classes, def.key)}`}
                                data-tip={taken ? t("kader.interview.specTaken", { spec: specName(view.classes, s.key) }) : `${specName(view.classes, s.key)} · ${roleLabel(s.role)}`}
                                className={`kp-specbtn${on ? " kp-on" : ""}`} onClick={() => setSpec(s.key)}>
                                <SpecIcon specKey={s.key} size={26} />
                            </button>
                        );
                    })}
                </div>
            )}
            <Button variant="ghost" icon={<PlusIcon />} disabled={busy || !pick || known || wishes.length >= MAX_WISHES} onClick={add}>{t("kader.interview.addWish")}</Button>
        </div>
    );
}

/** The wishes in order: drag or the arrows move one; a class and one of its spec icons add one. */
export function WishEditor({ wishes, prefill, locked, onChange }: { wishes: KaderWish[]; prefill: KaderWish | null; locked: boolean; onChange: (wishes: KaderWish[]) => void }) {
    const t = useT();
    const { view } = useKader();
    const [from, setFrom] = useState<number | null>(null);

    return (
        <>
            <ol className="kp-wishes" aria-label={t("kader.interview.wishes")}>
                {wishes.length === 0 && <li className="kp-hint">{t("kader.interview.noWishesYet")}</li>}
                {wishes.map((w, i) => {
                    const role = specRole(view.classes, w.spec);
                    const pre = !!prefill && prefill.spec === w.spec;
                    return (
                        <li
                            key={w.spec}
                            className={`kp-wish${i === 0 ? " kp-first" : ""}${from === i ? " kp-dragging" : ""}`}
                            draggable={!locked}
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(i)); e.dataTransfer.effectAllowed = "move"; setFrom(i); }}
                            onDragOver={(e) => { if (from !== null) e.preventDefault(); }}
                            onDrop={(e) => { e.preventDefault(); if (from !== null) onChange(placeWish(wishes, from, i)); setFrom(null); }}
                            onDragEnd={() => setFrom(null)}
                        >
                            {!locked && <Grip />}
                            <span className="kp-rank kp-mono">{i + 1}</span>
                            <PickIcon pick={w} size={30} />
                            <span className="kp-col kp-grow">
                                <PickLabel pick={w} className="kp-strong" />
                                <span className="kp-sub">{role ? roleLabel(role) : ""}{pre ? ` · ${t("kader.interview.prefilledShort")}` : ""}</span>
                            </span>
                            {!locked && (
                                <span className="kp-wish-act">
                                    <IconButton icon={<ChevronDownIcon />} className="kp-flip" size="sm" tip={t("kader.interview.up")} disabled={i === 0} onClick={() => onChange(moveWish(wishes, i, -1))} />
                                    <IconButton icon={<ChevronDownIcon />} size="sm" tip={t("kader.interview.down")} disabled={i === wishes.length - 1} onClick={() => onChange(moveWish(wishes, i, 1))} />
                                    <IconButton icon={<XIcon />} size="sm" tip={t("kader.interview.removeWish")} onClick={() => onChange(wishes.filter((_, j) => j !== i))} />
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
            {!locked && <WishAddRow wishes={wishes} onAdd={(pick) => onChange([...wishes, pick])} />}
        </>
    );
}

/** The quiet pencil beside a player's specs; opens "Specs bearbeiten". Nothing without write access. */
export function EditWishesButton({ userId, name }: { userId: string; name: string }) {
    const t = useT();
    const { canWrite, open } = useKader();
    if (!canWrite) return null;
    return <IconButton icon={<EditIcon />} size="sm" tip={t("kader.wishes.edit")} aria-label={t("kader.wishes.editOf", { name })} onClick={() => open({ type: "wishes", userId })} />;
}
