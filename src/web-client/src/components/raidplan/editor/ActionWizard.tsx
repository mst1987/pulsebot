import type { ReactNode } from "react";
import { ArrowRight, Circle, CircleDashed, Diamond, MousePointerClick, RefreshCw, RotateCw } from "lucide-react";
import Switch from "../../ui/Switch";
import { buttonClass } from "../../ui/Button";
import { BadgePicker, Row, Stepper } from "./AnimParts";
import { needsWhere, type Wizard, type WizardWhat } from "./wizardState";
import { useT } from "../../../i18n";

const TILES: { what: WizardWhat; icon: ReactNode }[] = [
    { what: "move", icon: <ArrowRight size={18} aria-hidden="true" /> },
    { what: "badge", icon: <Diamond size={18} aria-hidden="true" /> },
    { what: "fade", icon: <CircleDashed size={18} aria-hidden="true" /> },
    { what: "turn", icon: <RotateCw size={18} aria-hidden="true" /> },
    { what: "loop", icon: <RefreshCw size={18} aria-hidden="true" /> },
    { what: "pulse", icon: <Circle size={18} aria-hidden="true" /> },
];

/**
 * "Neue Aktion" (design B): Wer? (the picker under the map or the map itself) → Was? (walk, get a debuff, fade, turn, a loop, pulse)
 * → Wohin? (a click on the map; a loop takes several). Nothing moves before somebody is picked, and the head always says who.
 */
export default function ActionWizard({ wiz, set, who, names, count, canFade, canTurn, onAdd, onLoopDone, onCancel }: {
    wiz: Wizard;
    set: (w: Wizard) => void;
    /** what is picked, in a line, and the names behind it */
    who: string;
    names: string[];
    count: number;
    /** every picked actor can fade / turn (a single raider of a group cannot) */
    canFade: boolean;
    canTurn: boolean;
    /** adds an action that needs no place (debuff, fade, turn, pulse) */
    onAdd: () => void;
    onLoopDone: () => void;
    onCancel: () => void;
}) {
    const t = useT();
    const steps: Wizard["step"][] = ["who", "what", "where"];
    const at = steps.indexOf(wiz.step);
    const off = (w: WizardWhat) => count === 0 || (w === "fade" && !canFade) || (w === "turn" && !canTurn);
    const offTip = (w: WizardWhat) => (w === "turn" && !canTurn ? t("raidBoard.anim.wiz.noTurn") : w === "fade" && !canFade ? t("raidBoard.anim.wiz.noFade") : "");
    const shownNames = names.length > 6 ? `${names.slice(0, 6).join(", ")} +${names.length - 6}` : names.join(", ");
    return (
        <section className="rp-wiz" aria-label={t("raidBoard.anim.wiz.title")}>
            <div className="rp-wiz-head">
                <strong>{t("raidBoard.anim.wiz.title")}</strong>
                <ol className="rp-wiz-steps">
                    {steps.map((s, i) => (
                        <li key={s} className={i < at ? "is-stepdone" : i === at ? "is-on" : ""} aria-current={i === at ? "step" : undefined}>{i < at ? "✓" : i + 1} {t(`raidBoard.anim.wiz.step.${s}`)}</li>
                    ))}
                </ol>
            </div>

            {wiz.step === "who" ? (
                <p className="rp-wiz-who is-nopick"><MousePointerClick size={16} aria-hidden="true" />{count === 0 ? t("raidBoard.anim.wiz.pickFirst") : <span><strong>{who}</strong>{shownNames && ` · ${shownNames}`}</span>}</p>
            ) : (
                <div className="rp-wiz-who">
                    <span><strong>{who}</strong>{shownNames && <span className="rp-muted"> · {shownNames}</span>}</span>
                    <button type="button" className="rp-wiz-link" onClick={() => set({ ...wiz, step: "who" })}>{t("raidBoard.anim.wiz.change")}</button>
                </div>
            )}

            {wiz.step === "what" && (
                <>
                    <strong className="rp-wiz-q">{t("raidBoard.anim.wiz.whatQ")}</strong>
                    <div className="rp-wiz-tiles" role="radiogroup" aria-label={t("raidBoard.anim.wiz.whatQ")}>
                        {TILES.map(({ what, icon }) => (
                            <button key={what} type="button" role="radio" aria-checked={wiz.what === what} disabled={off(what)} className={`rp-wiz-tile${wiz.what === what ? " is-on" : ""}`} data-tip={offTip(what) || undefined} onClick={() => set({ ...wiz, what })}>
                                <span className="rp-wiz-ico">{icon}</span>
                                <span className="rp-wiz-tl">{t(`raidBoard.anim.wiz.what.${what}`)}</span>
                                <span className="rp-wiz-ts">{t(`raidBoard.anim.wiz.whatSub.${what}`)}</span>
                            </button>
                        ))}
                    </div>
                    {wiz.what === "badge" && (
                        <>
                            <BadgePicker value={wiz.badge} onPick={(badge) => set({ ...wiz, badge })} />
                            <Switch checked={wiz.pulseToo} onChange={(v) => set({ ...wiz, pulseToo: v })} label={t("raidBoard.anim.wiz.pulseToo")} />
                        </>
                    )}
                    {wiz.what === "fade" && (
                        <div className="rp-anim-eases" role="radiogroup" aria-label={t("raidBoard.anim.wiz.what.fade")}>
                            {(["hide", "show", "half"] as const).map((f) => (
                                <button key={f} type="button" role="radio" aria-checked={wiz.fade === f} className={`rp-anim-chip${wiz.fade === f ? " is-on" : ""}`} onClick={() => set({ ...wiz, fade: f })}>{t(`raidBoard.anim.wiz.fade.${f}`)}</button>
                            ))}
                        </div>
                    )}
                    {wiz.what === "turn" && (
                        <Row label={t("raidBoard.anim.rotation")}>
                            <Stepper value={wiz.deg} min={0} max={359} step={15} unit="°" label={t("raidBoard.anim.rotation")} onChange={(deg) => set({ ...wiz, deg })} />
                        </Row>
                    )}
                    {wiz.what === "pulse" && (
                        <div className="rp-anim-eases" role="radiogroup" aria-label={t("raidBoard.anim.wiz.what.pulse")}>
                            {[true, false].map((on) => (
                                <button key={String(on)} type="button" role="radio" aria-checked={wiz.pulseOn === on} className={`rp-anim-chip${wiz.pulseOn === on ? " is-on" : ""}`} onClick={() => set({ ...wiz, pulseOn: on })}>{t(on ? "raidBoard.anim.wiz.pulseStart" : "raidBoard.anim.wiz.pulseStop")}</button>
                            ))}
                        </div>
                    )}
                </>
            )}

            {wiz.step === "where" && (
                <div className="rp-wiz-where" role="status">
                    <MousePointerClick size={18} aria-hidden="true" />
                    <span>{wiz.what === "loop" ? t("raidBoard.anim.wiz.whereLoop", { n: wiz.points.length }) : t("raidBoard.anim.wiz.whereMove", { who })}</span>
                </div>
            )}
            {wiz.step === "where" && wiz.what === "loop" && (
                <Switch checked={wiz.closed} onChange={(v) => set({ ...wiz, closed: v })} label={t("raidBoard.anim.closed")} tip={t("raidBoard.anim.closedTip")} />
            )}

            <div className="rp-wiz-foot">
                <button type="button" className={buttonClass("ghost", "sm")} onClick={onCancel}>{t("raidBoard.anim.cancel")}</button>
                {wiz.step === "where" && <button type="button" className={buttonClass("ghost", "sm")} onClick={() => set({ ...wiz, step: "what", points: [] })}>{t("raidBoard.anim.wiz.back")}</button>}
                {wiz.step === "who" && <button type="button" className={buttonClass("primary", "sm")} disabled={count === 0} onClick={() => set({ ...wiz, step: "what" })}>{t("raidBoard.anim.wiz.nextWhat")}</button>}
                {wiz.step === "what" && needsWhere(wiz.what) && <button type="button" className={buttonClass("primary", "sm")} onClick={() => set({ ...wiz, step: "where", points: [] })}>{t("raidBoard.anim.wiz.nextWhere")}</button>}
                {wiz.step === "what" && wiz.what && !needsWhere(wiz.what) && <button type="button" className={buttonClass("primary", "sm")} onClick={onAdd}>{t("raidBoard.anim.wiz.add")}</button>}
                {wiz.step === "where" && wiz.what === "loop" && <button type="button" className={buttonClass("primary", "sm")} disabled={wiz.points.length === 0} onClick={onLoopDone}>{t("raidBoard.anim.wiz.loopDone")}</button>}
            </div>
        </section>
    );
}
