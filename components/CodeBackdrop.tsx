"use client";

import { useEffect, useRef } from "react";

/**
 * Dynamic full-page backdrop: a slowly drifting network of nodes connected by
 * lines when they're near. Auto-animated (no mouse), monochrome, fixed behind
 * all content. Honors prefers-reduced-motion (renders a single static frame).
 */
export function CodeBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cv = canvas; // non-null capture for closures

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const LINK = 150; // px distance to draw a connecting line
    let w = 0;
    let h = 0;
    let raf = 0;
    type P = { x: number; y: number; vx: number; vy: number };
    let pts: P[] = [];

    function rand(min: number, max: number) {
      return min + Math.random() * (max - min);
    }

    function seed() {
      const count = Math.min(110, Math.max(28, Math.floor((w * h) / 17000)));
      pts = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: rand(-0.22, 0.22),
        vy: rand(-0.22, 0.22),
      }));
    }

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = w * dpr;
      cv.height = h * dpr;
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      // edges
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const o = (1 - Math.sqrt(d2) / LINK) * 0.16;
            ctx!.strokeStyle = `rgba(255,255,255,${o})`;
            ctx!.beginPath();
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }
      // nodes
      ctx!.fillStyle = "rgba(255,255,255,0.45)";
      for (const p of pts) {
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function step() {
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      draw();
      raf = requestAnimationFrame(step);
    }

    resize();
    if (reduce) draw();
    else raf = requestAnimationFrame(step);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
