import type { CSSProperties } from "react";
import { Pause, Play, Repeat, SkipBack, SkipForward, UserRound, X } from "lucide-react";
import type { RaidplanScene } from "../../api";
import { SPEEDS, type ScenePlayer } from "../../hooks/useScenePlayer";
import { clock, frameAt } from "../../lib/raidplan/scene";
import { useT } from "../../i18n";

/**
 * The controls of an animation (docs/raidplan/animation.md), the same in the sheet and in the editor's preview: the scenes of the
 * section as chips (when there are several), back / play-pause / forward by frame, the time line with a mark per frame (a click
 * jumps there), the time, the speed and the loop; "Schließen" goes back to the plan.
 */
export default function ScenePlayerBar({ scenes, scene, player, onPick, onClose, className = "", focusMine = null }: {
    scenes: RaidplanScene[];
    scene: RaidplanScene;
    player: ScenePlayer;
    onPick: (id: string) => void;
    onClose?: () => void;
    className?: string;
    /** "Meine Gruppe hervorheben": the viewer's group stays bright, the others dim (only for a visitor who stands in the plan) */
    focusMine?: { on: boolean; toggle: () => void } | null;
}) {
    const t = useT();
    const k = frameAt(scene, player.t);
    const n = scene.frames.length;
    const nextSpeed = SPEEDS[(SPEEDS.indexOf(player.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    return (
        <div className={`rp-anim-bar ${className}`} role="group" aria-label={t("raidBoard.anim.player")}>
            {scenes.length > 1 && (
                <div className="rp-anim-scenes" role="tablist" aria-label={t("raidBoard.anim.scenes")}>
                    {scenes.map((s) => (
                        <button key={s.id} type="button" role="tab" aria-selected={s.id === scene.id} className={`rp-anim-scene${s.id === scene.id ? " is-on" : ""}`} onClick={() => onPick(s.id)}>{s.title}</button>
                    ))}
                </div>
            )}
            <div className="rp-anim-row">
                <button type="button" className="rp-anim-btn" aria-label={t("raidBoard.anim.prev")} data-tip={t("raidBoard.anim.prev")} disabled={n === 0} onClick={() => player.toFrame(player.t > scene.frames[k].at + 0.3 ? k : k - 1)}>
                    <SkipBack size={16} aria-hidden="true" />
                </button>
                <button type="button" className="rp-anim-btn rp-anim-play" aria-label={player.playing ? t("raidBoard.anim.pause") : t("raidBoard.anim.play")} onClick={player.toggle}>
                    {player.playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                </button>
                <button type="button" className="rp-anim-btn" aria-label={t("raidBoard.anim.next")} data-tip={t("raidBoard.anim.next")} disabled={k >= n - 1} onClick={() => player.toFrame(k + 1)}>
                    <SkipForward size={16} aria-hidden="true" />
                </button>
                <div className="rp-anim-track">
                    <input
                        type="range" min={0} max={scene.length} step={0.05} value={player.t} aria-label={t("raidBoard.anim.time")}
                        aria-valuetext={`${clock(player.t)} / ${clock(scene.length)}`}
                        onChange={(e) => { player.pause(); player.seek(Number(e.target.value)); }}
                    />
                    {scene.frames.map((f, i) => (
                        <button
                            key={f.id} type="button" className={`rp-anim-tick${i === k ? " is-on" : ""}`} style={{ "--rp-at": `${(f.at / scene.length) * 100}%` } as CSSProperties}
                            aria-label={t("raidBoard.anim.frameN", { n: i + 1, caption: f.caption })} data-tip={f.caption || t("raidBoard.anim.frameShort", { n: i + 1 })}
                            onClick={() => { player.pause(); player.toFrame(i); }}
                        />
                    ))}
                </div>
                <span className="rp-anim-time">{clock(player.t)} / {clock(scene.length)}</span>
                <button type="button" className="rp-anim-btn rp-anim-speed" aria-label={t("raidBoard.anim.speed", { v: player.speed })} data-tip={t("raidBoard.anim.speedTip")} onClick={() => player.setSpeed(nextSpeed)}>
                    {String(player.speed).replace(".", ",")}×
                </button>
                {focusMine && (
                    <button type="button" className={`rp-anim-btn${focusMine.on ? " is-on" : ""}`} aria-pressed={focusMine.on} aria-label={t("raidBoard.anim.focusMine")} data-tip={t("raidBoard.anim.focusMineTip")} onClick={focusMine.toggle}>
                        <UserRound size={16} aria-hidden="true" />
                    </button>
                )}
                <button type="button" className={`rp-anim-btn${player.loop ? " is-on" : ""}`} aria-pressed={player.loop} aria-label={t("raidBoard.anim.loop")} data-tip={t("raidBoard.anim.loop")} onClick={() => player.setLoop(!player.loop)}>
                    <Repeat size={16} aria-hidden="true" />
                </button>
                {onClose && (
                    <button type="button" className="rp-anim-btn" aria-label={t("raidBoard.anim.close")} data-tip={t("raidBoard.anim.close")} onClick={onClose}>
                        <X size={16} aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
}

/** The caption of the frame that is on, big over the map: "Takt 2 von 4" and the orga's sentence. */
export function SceneCaption({ scene, t: time }: { scene: RaidplanScene; t: number }) {
    const t = useT();
    const k = frameAt(scene, time);
    const f = scene.frames[k];
    if (!f) return null;
    return (
        <div className="rp-anim-caption" aria-live="polite">
            <span className="rp-anim-caption-n">{t("raidBoard.anim.frameOf", { n: k + 1, of: scene.frames.length })}</span>
            {f.caption && <strong className="rp-anim-caption-text">{f.caption}</strong>}
        </div>
    );
}
