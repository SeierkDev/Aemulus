import type { SkillStep } from "./types";

/** The distinct sites a skill's plan will navigate to (for trust warnings). */
export function skillTargets(plan: SkillStep[]): string[] {
  const hosts = new Set<string>();
  for (const s of plan) {
    if (s.action === "navigate" && s.target) {
      try {
        const u = new URL(s.target);
        hosts.add(u.protocol === "data:" ? "inline page" : u.hostname);
      } catch {
        /* not a URL — skip */
      }
    }
  }
  return [...hosts];
}
