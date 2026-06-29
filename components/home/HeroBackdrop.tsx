"use client";

import { useEffect, useRef } from "react";

/**
 * Ambient hero backdrop: two slow-drifting blurred orbs plus a soft spotlight
 * that follows the cursor. Monochrome, pointer-events-none, and driven by CSS
 * custom props (no React re-renders). Honors prefers-reduced-motion via the
 * global media query.
 */
export function HeroBackdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="aem-orb aem-orb-1" />
      <div className="aem-orb aem-orb-2" />
      <div className="aem-orb aem-orb-3" />
      <div className="aem-spotlight" />
    </div>
  );
}
