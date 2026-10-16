import { useCallback, useEffect, useRef, useState } from "react";
import type { RaidplanScene } from "../api";
import { frameAt } from "../lib/raidplan/scene";

/** The speeds the player offers. */
export const SPEEDS = [0.5, 1, 2] as const;

/** Whether the visitor asked the system for less motion: the player then shows frame by frame, without blending. */
export function prefersLessMotion(): boolean {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type ScenePlayer = {
    /** seconds into the scene */
    t: number;
    playing: boolean;
    speed: number;
    loop: boolean;
    /** frame by frame without blending (prefers-reduced-motion) */
    still: boolean;
    play: () => void;
    pause: () => void;
    toggle: () => void;
    seek: (t: number) => void;
    /** to the start of frame k (clamped) */
    toFrame: (k: number) => void;
    setSpeed: (v: number) => void;
    setLoop: (v: boolean) => void;
};

/**
 * Plays a scene (lib/raidplan/scene.ts): the time runs with requestAnimationFrame at the chosen speed, stops at the end or starts
 * again when the scene loops. A new scene starts from 0 (and plays when `autoplay`). Pure state: what is drawn at `t` is boardAt's job.
 */
export function useScenePlayer(scene: RaidplanScene | null, { autoplay = false }: { autoplay?: boolean } = {}): ScenePlayer {
    const [t, setT] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [loop, setLoop] = useState(false);
    const [still] = useState(prefersLessMotion);
    const length = scene ? scene.length : 0;
    const tRef = useRef(0);
    tRef.current = t;

    useEffect(() => {
        setT(0);
        setLoop(!!scene && scene.loop);
        setPlaying(!!scene && autoplay);
    }, [scene ? scene.id : "", autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!playing || !scene || length <= 0) return undefined;
        let last = 0;
        let raf = 0;
        const tick = (now: number) => {
            const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
            last = now;
            let next = tRef.current + dt * speed;
            if (next >= length) {
                if (loop) next %= length;
                else { setT(length); setPlaying(false); return; }
            }
            setT(next);
            raf = window.requestAnimationFrame(tick);
        };
        raf = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(raf);
    }, [playing, scene, length, speed, loop]);

    const play = useCallback(() => {
        // at the end, play starts again from the beginning
        if (tRef.current >= length) setT(0);
        setPlaying(true);
    }, [length]);
    const pause = useCallback(() => setPlaying(false), []);
    const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
    const seek = useCallback((v: number) => setT(Math.max(0, Math.min(length, v))), [length]);
    const toFrame = useCallback((k: number) => {
        if (!scene || scene.frames.length === 0) return;
        const i = Math.max(0, Math.min(scene.frames.length - 1, k));
        setT(scene.frames[i].at);
    }, [scene]);
    return { t, playing, speed, loop, still, play, pause, toggle, seek, toFrame, setSpeed, setLoop };
}

/** The frame on at the player's time (0 without a scene). */
export function currentFrame(scene: RaidplanScene | null, t: number): number {
    return scene ? frameAt(scene, t) : 0;
}
