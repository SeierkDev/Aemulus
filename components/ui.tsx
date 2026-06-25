import * as React from "react";

/**
 * Tiny monochrome UI kit. Grayscale only — the single "accent" is pure white.
 * Kept deliberately small; components compose with Tailwind classes.
 */

type Cx = (string | false | null | undefined)[];
export function cx(...c: Cx): string {
  return c.filter(Boolean).join(" ");
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius-base)] border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-base)] px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    primary: "bg-signal text-bg hover:bg-ink",
    default:
      "border border-border-strong bg-surface-2 text-ink hover:bg-elevated",
    ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  };
  return <button className={cx(base, variants[variant], className)} {...props} />;
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-2.5 py-0.5 text-[0.7rem] font-medium text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Section label — small uppercase mono caption used throughout the app. */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono text-[0.68rem] uppercase tracking-[0.18em] text-ink-3">
      {children}
    </div>
  );
}
