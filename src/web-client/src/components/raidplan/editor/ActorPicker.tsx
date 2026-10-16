import type { CSSProperties, MouseEvent } from "react";
import { X } from "lucide-react";
import type { Actor, ActorSection } from "../../../lib/raidplan/sceneActions";
import { useT } from "../../../i18n";

const SECTIONS: ActorSection[] = ["groups", "players", "enemies", "marks"];

/** One actor as a chip: its colour dot with a letter or number, its name; picked = accent. */
function ActorChip({ a, on, acts, small = false, onClick }: { a: Actor; on: boolean; acts: boolean; small?: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
    const t = useT();
    return (
        <button
            type="button" className={`rp-actor${on ? " is-on" : ""}${small ? " is-small" : ""}`} aria-pressed={on} onClick={onClick}
            data-tip={a.sub || undefined} style={{ "--rp-ac": a.color } as CSSProperties}
        >
            <span className="rp-actor-dot" aria-hidden="true">{a.ini}</span>
            <span className="rp-actor-name">{a.label}</span>
            {acts && <span className="rp-actor-acts" aria-label={t("raidBoard.anim.actsHere")} data-tip={t("raidBoard.anim.actsHere")} />}
        </button>
    );
}

/**
 * "Wer?" of the animation editor (design B): everyone and everything on the board that can act, in sections - groups (a picked group
 * opens its raiders, each can be picked alone), players and places, enemies, marks and areas. A click picks one (the map lights them
 * up), Shift + click adds or removes; the head says what is picked. The same picking works on the map (Alt + click = one raider).
 */
export default function ActorPicker({ actors, sel, active, actsIn, onPick, onClear }: {
    actors: Actor[];
    sel: string[];
    /** the action assistant waits for "Wer?": the picker is framed */
    active: boolean;
    /** whether an actor already does something in this frame (a small mark) */
    actsIn: (ref: string) => boolean;
    onPick: (ref: string, add: boolean) => void;
    onClear: () => void;
}) {
    const t = useT();
    const picked = new Set(sel);
    const pick = (ref: string) => (e: MouseEvent<HTMLButtonElement>) => onPick(ref, e.shiftKey || e.ctrlKey || e.metaKey);
    return (
        <section className={`rp-actors${active ? " is-active" : ""}`} aria-label={t("raidBoard.anim.who")}>
            <div className="rp-actors-head">
                <strong>{t("raidBoard.anim.who")}</strong>
                <span className="rp-muted">{t("raidBoard.anim.whoHint")}</span>
                {sel.length > 0 && (
                    <button type="button" className="rp-actors-clear" onClick={onClear}><X size={13} aria-hidden="true" />{t("raidBoard.anim.clearPick")}</button>
                )}
            </div>
            {SECTIONS.map((sec) => {
                const list = actors.filter((a) => a.section === sec);
                if (list.length === 0) return null;
                return (
                    <div key={sec} className="rp-actors-sec">
                        <span className="rp-actors-label">{t(`raidBoard.anim.section.${sec}`)}</span>
                        <div className="rp-actors-chips">
                            {list.map((a) => {
                                const open = sec === "groups" && (picked.has(a.ref) || a.raiders.some((r) => picked.has(r.ref)));
                                return (
                                    <div key={a.ref} className={`rp-actor-wrap${open ? " is-open" : ""}`}>
                                        <ActorChip a={a} on={picked.has(a.ref)} acts={actsIn(a.ref)} onClick={pick(a.ref)} />
                                        {open && (
                                            <div className="rp-actor-raiders" role="group" aria-label={t("raidBoard.anim.raidersOf", { label: a.label })}>
                                                {a.raiders.length > 0 ? (
                                                    <>
                                                        <span className="rp-actors-label">{t("raidBoard.anim.alone")}</span>
                                                        {a.raiders.map((r) => <ActorChip key={r.ref} a={r} small on={picked.has(r.ref)} acts={actsIn(r.ref)} onClick={pick(r.ref)} />)}
                                                    </>
                                                ) : <span className="rp-muted rp-actors-note">{t("raidBoard.anim.noRaiders")}</span>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
