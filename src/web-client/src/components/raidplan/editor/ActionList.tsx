import { useState, type CSSProperties } from "react";
import { Pencil, Route, Trash2 } from "lucide-react";
import type { RaidplanEase, RaidplanLoop, RaidplanScene } from "../../../api";
import { buttonClass } from "../../ui/Button";
import { EASES, PATH_LIMITS, patchChange, removeLoop, setPath, updateLoop, valueAfter, BADGE_PRESETS } from "../../../lib/raidplan/sceneEdit";
import { removePart, type ActionPart, type Actor } from "../../../lib/raidplan/sceneActions";
import { BadgePicker, LoopEditor, Row, Stepper } from "./AnimParts";
import type { Draw } from "./AnimWorkspace";
import { useT } from "../../../i18n";

const s1 = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
/** a person walks, a thing moves */
const walks = (a: Actor | undefined) => !!a && (a.section === "groups" || a.section === "players");

/**
 * "Was passiert in diesem Takt" (design B): every part of every change of the frame as a sentence - "Gruppe 3 läuft nach links
 * unten", "Gruppe 3 bekommt Bloodboil" - with when and how long, and the loops that start in it. A click on a sentence picks its
 * actor (the map lights him up); "Ändern" opens what can be set for it right there, the bin takes that part off.
 */
export default function ActionList({ scene, frame, parts, loops, index, canWrite, upd, draw, onDraw, sel, onPick }: {
    scene: RaidplanScene;
    frame: number;
    parts: ActionPart[];
    loops: RaidplanLoop[];
    index: Map<string, Actor>;
    canWrite: boolean;
    upd: (fn: (s: RaidplanScene) => RaidplanScene, coalesce?: boolean) => void;
    draw: Draw;
    onDraw: (d: Draw) => void;
    sel: string[];
    onPick: (ref: string) => void;
}) {
    const t = useT();
    const [open, setOpen] = useState("");
    const off = !canWrite;
    const actor = (ref: string) => index.get(ref);
    const nameOf = (ref: string) => (actor(ref) ? actor(ref)!.label : t("raidBoard.anim.object"));

    const sentence = (p: ActionPart): string => {
        const a = actor(p.obj);
        if (p.part === "move") {
            const dir = p.dir ? t(`raidBoard.anim.dir.${p.dir}`) : t("raidBoard.anim.dir.none");
            return t(walks(a) ? "raidBoard.anim.act.walk" : "raidBoard.anim.act.move", { dir });
        }
        if (p.part === "badge") {
            const icon = String(p.value || "");
            // taken off: the debuff it had before this frame, by its name
            const lost = icon ? "" : String((frame > 0 && valueAfter(scene, frame - 1, p.obj, "badge")) || "");
            if (!icon) return lost && BADGE_PRESETS.includes(lost) ? t("raidBoard.anim.act.badgeLost", { name: t(`raidBoard.anim.preset.${lost}`) }) : t("raidBoard.anim.act.badgeOff");
            return t("raidBoard.anim.act.badgeOn", { name: BADGE_PRESETS.includes(icon) ? t(`raidBoard.anim.preset.${icon}`) : t("raidBoard.anim.act.anIcon") });
        }
        if (p.part === "pulse") return t(p.value ? "raidBoard.anim.act.pulseOn" : "raidBoard.anim.act.pulseOff");
        if (p.part === "hidden") return t(p.value ? "raidBoard.anim.act.hide" : "raidBoard.anim.act.show");
        if (p.part === "rotation") return t("raidBoard.anim.act.turn", { deg: Number(p.value) });
        if (p.part === "opacity") return t("raidBoard.anim.act.opacity", { n: Math.round(Number(p.value) * 100) });
        return t("raidBoard.anim.act.scale", { n: Math.round(Number(p.value) * 100) });
    };
    const meta = (p: ActionPart): string[] => {
        const c = p.change;
        const out = frame === 0 ? [t("raidBoard.anim.when.start")] : [c.delay > 0 ? t("raidBoard.anim.when.after", { s: s1(c.delay) }) : t("raidBoard.anim.when.now")];
        if (frame > 0 && p.part !== "badge" && p.part !== "pulse") out.push(t("raidBoard.anim.when.takes", { s: s1(c.dur) }), t(`raidBoard.anim.easeName.${c.ease}`));
        if (p.part === "move" && p.points > 0) out.push(t("raidBoard.anim.when.points", { n: p.points }));
        return out;
    };
    const avatar = (ref: string) => {
        const a = actor(ref);
        return <span className="rp-act-dot" aria-hidden="true" style={{ "--rp-ac": a ? a.color : "#9aa0aa" } as CSSProperties}>{a ? a.ini : "?"}</span>;
    };

    if (parts.length === 0 && loops.length === 0) {
        return <p className="rp-muted rp-anim-note">{frame === 0 ? t("raidBoard.anim.startNote") : t("raidBoard.anim.nothingYet")}</p>;
    }
    return (
        <ul className="rp-acts" aria-label={t("raidBoard.anim.whatHappens")}>
            {parts.map((p) => {
                const key = `${p.obj}|${p.part}`;
                const c = p.change;
                const editing = open === key;
                const drawing = !!draw && draw.kind === "move" && draw.obj === p.obj;
                return (
                    <li key={key} className={`rp-act${sel.includes(p.obj) ? " is-picked" : ""}${editing ? " is-open" : ""}`}>
                        <div className="rp-act-row">
                            <button type="button" className="rp-act-main" onClick={() => onPick(p.obj)} aria-label={`${nameOf(p.obj)} ${sentence(p)}`}>
                                {avatar(p.obj)}
                                <span className="rp-act-text">
                                    <span className="rp-act-sentence"><strong>{nameOf(p.obj)}</strong> {sentence(p)}</span>
                                    <span className="rp-act-meta">{meta(p).map((m) => <span key={m}>{m}</span>)}</span>
                                </span>
                            </button>
                            {canWrite && (
                                <>
                                    <button type="button" className="rp-anim-iconbtn" aria-expanded={editing} aria-label={t("raidBoard.anim.editAction", { what: `${nameOf(p.obj)} ${sentence(p)}` })} data-tip={t("raidBoard.anim.edit")} onClick={() => setOpen(editing ? "" : key)}><Pencil size={14} aria-hidden="true" /></button>
                                    <button type="button" className="rp-anim-iconbtn" aria-label={t("raidBoard.anim.removeAction", { what: `${nameOf(p.obj)} ${sentence(p)}` })} data-tip={t("raidBoard.anim.remove")} onClick={() => { upd((s) => removePart(s, frame, p.obj, p.part)); if (editing) setOpen(""); }}><Trash2 size={14} aria-hidden="true" /></button>
                                </>
                            )}
                        </div>
                        {editing && (
                            <div className="rp-act-edit">
                                {frame > 0 && (
                                    <>
                                        <Row label={t("raidBoard.anim.delay")}>
                                            <Stepper value={c.delay} min={0} max={60} step={0.1} unit="s" decimals={1} label={t("raidBoard.anim.delay")} disabled={off} onChange={(v) => upd((s) => patchChange(s, frame, p.obj, { delay: v }))} />
                                        </Row>
                                        <Row label={t("raidBoard.anim.duration")}>
                                            <Stepper value={c.dur} min={0} max={60} step={0.1} unit="s" decimals={1} label={t("raidBoard.anim.duration")} disabled={off} onChange={(v) => upd((s) => patchChange(s, frame, p.obj, { dur: v }))} />
                                        </Row>
                                        <div className="rp-anim-eases" role="radiogroup" aria-label={t("raidBoard.anim.ease")}>
                                            {EASES.map((e: RaidplanEase) => (
                                                <button key={e} type="button" role="radio" aria-checked={c.ease === e} disabled={off} className={`rp-anim-chip${c.ease === e ? " is-on" : ""}`} onClick={() => upd((s) => patchChange(s, frame, p.obj, { ease: e }))} data-tip={t(`raidBoard.anim.easeTip.${e}`)}>{t(`raidBoard.anim.easeName.${e}`)}</button>
                                            ))}
                                        </div>
                                        <p className="rp-muted rp-anim-note">{t("raidBoard.anim.timingShared", { name: nameOf(p.obj) })}</p>
                                    </>
                                )}
                                {p.part === "move" && frame > 0 && (
                                    <Row label={p.points > 0 ? t("raidBoard.anim.wayN", { n: p.points }) : t("raidBoard.anim.way")}>
                                        <span className="rp-anim-wayctl">
                                            <button type="button" className={buttonClass(drawing ? "primary" : "ghost", "sm", true)} disabled={off || (!drawing && p.points >= PATH_LIMITS.path)} aria-pressed={drawing} onClick={() => { onPick(p.obj); onDraw(drawing ? null : { kind: "move", obj: p.obj }); }}>
                                                <Route size={13} aria-hidden="true" />{drawing ? t("raidBoard.anim.drawDone") : t("raidBoard.anim.drawWay")}
                                            </button>
                                            {p.points > 0 && <button type="button" className={buttonClass("ghost", "sm")} disabled={off} onClick={() => upd((s) => setPath(s, frame, p.obj, []))}>{t("raidBoard.anim.straight")}</button>}
                                        </span>
                                    </Row>
                                )}
                                {drawing && <p className="rp-anim-drawnote" role="status">{t("raidBoard.anim.drawNote")}</p>}
                                {p.part === "badge" && p.value !== "" && <BadgePicker value={String(p.value || "")} disabled={off} onPick={(icon) => upd((s) => patchChange(s, frame, p.obj, { badge: icon }))} />}
                                {p.part === "rotation" && (
                                    <Row label={t("raidBoard.anim.rotation")}>
                                        <Stepper value={Number(p.value)} min={0} max={359} step={15} unit="°" label={t("raidBoard.anim.rotation")} disabled={off} onChange={(v) => upd((s) => patchChange(s, frame, p.obj, { rotation: ((v % 360) + 360) % 360 }))} />
                                    </Row>
                                )}
                                {p.part === "opacity" && (
                                    <Row label={t("raidBoard.anim.opacity")}>
                                        <Stepper value={Math.round(Number(p.value) * 100)} min={10} max={100} step={10} unit="%" label={t("raidBoard.anim.opacity")} disabled={off} onChange={(v) => upd((s) => patchChange(s, frame, p.obj, { opacity: v / 100 }))} />
                                    </Row>
                                )}
                                {p.part === "scale" && (
                                    <Row label={t("raidBoard.anim.size")}>
                                        <Stepper value={Math.round(Number(p.value) * 100)} min={25} max={400} step={10} unit="%" label={t("raidBoard.anim.size")} disabled={off} onChange={(v) => upd((s) => patchChange(s, frame, p.obj, { scale: v / 100 }))} />
                                    </Row>
                                )}
                            </div>
                        )}
                    </li>
                );
            })}
            {loops.map((l) => {
                const key = `loop|${l.id}`;
                const editing = open === key;
                return (
                    <li key={key} className={`rp-act${sel.includes(l.obj) ? " is-picked" : ""}${editing ? " is-open" : ""}`}>
                        <div className="rp-act-row">
                            <button type="button" className="rp-act-main" onClick={() => onPick(l.obj)} aria-label={`${nameOf(l.obj)} ${t(l.closed ? "raidBoard.anim.act.loop" : "raidBoard.anim.act.loopOpen")}`}>
                                {avatar(l.obj)}
                                <span className="rp-act-text">
                                    <span className="rp-act-sentence"><strong>{nameOf(l.obj)}</strong> {t(l.closed ? "raidBoard.anim.act.loop" : "raidBoard.anim.act.loopOpen")}</span>
                                    <span className="rp-act-meta">
                                        <span>{t("raidBoard.anim.when.at", { s: s1(l.from) })}</span>
                                        <span>{t("raidBoard.anim.when.round", { s: s1(l.period) })}</span>
                                        {l.trail && <span>{t("raidBoard.anim.trail")}</span>}
                                    </span>
                                </span>
                            </button>
                            {canWrite && (
                                <>
                                    <button type="button" className="rp-anim-iconbtn" aria-expanded={editing} aria-label={t("raidBoard.anim.editAction", { what: `${nameOf(l.obj)} ${t("raidBoard.anim.act.loop")}` })} data-tip={t("raidBoard.anim.edit")} onClick={() => setOpen(editing ? "" : key)}><Pencil size={14} aria-hidden="true" /></button>
                                    <button type="button" className="rp-anim-iconbtn" aria-label={t("raidBoard.anim.removeAction", { what: `${nameOf(l.obj)} ${t("raidBoard.anim.act.loop")}` })} data-tip={t("raidBoard.anim.remove")} onClick={() => { upd((s) => removeLoop(s, l.id)); onDraw(null); }}><Trash2 size={14} aria-hidden="true" /></button>
                                </>
                            )}
                        </div>
                        {editing && (
                            <div className="rp-act-edit">
                                <LoopEditor loop={l} length={scene.length} off={off} drawing={!!draw && draw.kind === "loop" && draw.id === l.id}
                                    onDraw={(on) => { onPick(l.obj); onDraw(on ? { kind: "loop", id: l.id } : null); }} onChange={(patch) => upd((s) => updateLoop(s, l.id, patch))}
                                />
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
