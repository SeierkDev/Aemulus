"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/**
 * Fades + slides its children up the first time they scroll into view.
 * IntersectionObserver, fires once. Respects prefers-reduced-motion via CSS.
 */
export function Reveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cx("aem-reveal", shown && "aem-reveal-in", className)}>
      {children}
    </div>
  );
}
