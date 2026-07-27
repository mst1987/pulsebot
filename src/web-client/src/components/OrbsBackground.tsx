import { useEffect, useRef } from "react";

// Soft drifting colour-orb background behind the dashboard tiles ("Spektrum"
// design), ported from renderAdmin.js's DASH_ORBS_SCRIPT. Reads the --area-*
// tokens so the colours always match the current theme; a single static
// frame is drawn under prefers-reduced-motion.
const AREA_VARS = ["--area-cla", "--area-recruitment", "--area-channels", "--area-settings"];

function toRgba(hex: string, a: number): string {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${a})`;
}

export default function OrbsBackground() {
    const ref = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        const cs = getComputedStyle(document.documentElement);
        const colors = AREA_VARS.map((v) => cs.getPropertyValue(v).trim() || "#7ab7ff");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        let raf = 0;
        function resize() {
            if (!canvas) return;
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
        }
        resize();
        const orbs = colors.map((c) => ({
            x: Math.random() * canvas.width, y: Math.random() * canvas.height,
            r: 70 + Math.random() * 50, c, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
        }));
        function draw() {
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            orbs.forEach((o) => {
                const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
                g.addColorStop(0, toRgba(o.c, 0.28));
                g.addColorStop(1, toRgba(o.c, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(o.x, o.y, o.r, 0, 7);
                ctx.fill();
            });
        }
        if (reduce) {
            draw();
            return undefined;
        }
        function frame() {
            if (!canvas) return;
            orbs.forEach((o) => {
                o.x += o.vx; o.y += o.vy;
                if (o.x < -o.r || o.x > canvas.width + o.r) o.vx *= -1;
                if (o.y < -o.r || o.y > canvas.height + o.r) o.vy *= -1;
            });
            draw();
            raf = requestAnimationFrame(frame);
        }
        frame();
        window.addEventListener("resize", resize, { passive: true });
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", resize);
        };
    }, []);

    return <canvas className="fx-orbs" ref={ref} aria-hidden="true" />;
}
