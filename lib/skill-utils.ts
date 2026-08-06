import type { SkillStep } from "./types";

// A recording needs enough real interaction to represent a finished task.
// Abandoned/blocked captures (e.g. one that dead-ended on a captcha) shouldn't
// be turned into skills. Tune with AEMULUS_MIN_RECORDING_STEPS.
export const MIN_MEANINGFUL_STEPS = Math.max(
  1,
  Number(process.env.AEMULUS_MIN_RECORDING_STEPS) || 3,
);

/** Why a recording is too incomplete to become a skill, or null if it's fine.
 * Counts real interactions (clicks, inputs, selects, key presses, submits) —
 * bare navigations don't count, so "opened a page and gave up" is rejected. */
export function incompleteRecordingReason(
  trace: { type: string }[],
): string | null {
  /**
   * A capture is a finished recording on its own.
   *
   * Open a page, click the number you want watched, stop. That is exactly the
   * shape a watch needs, and it has one interaction — so the three-interaction
   * rule rejected it as "unfinished" and there was no way to make a watchable
   * skill without padding the recording with clicks that do nothing.
   *
   * The rule still does its job for what it was written for: a task abandoned
   * on a captcha has no capture either.
   */
  if (trace.some((a) => a.type === "extract")) return null;

  const meaningful = trace.filter((a) => a.type !== "navigate").length;
  if (meaningful < MIN_MEANINGFUL_STEPS) {
    return `This recording only captured ${meaningful} action${meaningful === 1 ? "" : "s"} — it looks unfinished (a task that got blocked or was stopped early). Record the full task through to completion, then turn it into a skill.`;
  }
  return null;
}

/**
 * The distinct hostnames the user ACTUALLY navigated to in a recording. Used to
 * derive a skill's allowedHosts from real (trusted) navigation, NOT from the
 * generalizer's model output - the trace text is attacker-influenced, so a
 * model-emitted navigate target must not be able to widen the allowlist.
 */
export function recordedNavHosts(
  trace: { type: string; url?: string | null }[],
): string[] {
  const hosts = new Set<string>();
  for (const a of trace) {
    if (a.type === "navigate" && a.url) {
      try {
        hosts.add(new URL(a.url).hostname.toLowerCase());
      } catch {
        /* not a URL - skip */
      }
    }
  }
  return [...hosts];
}

/** The distinct sites a skill's plan will navigate to (for trust warnings). */
export function skillTargets(plan: SkillStep[]): string[] {
  const hosts = new Set<string>();
  for (const s of plan) {
    if (s.action === "navigate" && s.target) {
      try {
        const u = new URL(s.target);
        hosts.add(u.protocol === "data:" ? "inline page" : u.hostname);
      } catch {
        /* not a URL - skip */
      }
    }
  }
  return [...hosts];
}

const CATEGORY_RULES: [string, RegExp][] = [
  ["Finance", /invoice|expense|quickbooks|expensify|billing|payment|accounting|payroll/i],
  ["CRM", /lead|hubspot|salesforce|contact|crm|pipeline|deal/i],
  ["Support", /ticket|zendesk|support|helpdesk|intercom|freshdesk/i],
  ["Hiring", /job|linkedin|candidate|applicant|recruit|hiring|greenhouse|lever/i],
  ["Commerce", /shopify|product|order|inventory|store|woocommerce|listing/i],
  ["Marketing", /campaign|email|post|social|publish|newsletter|seo/i],
  ["Data entry", /form|spreadsheet|airtable|notion|record|database|csv/i],
];

/** Heuristic marketplace category from a skill's name + description. */
export function categorize(name: string, description: string): string {
  const text = `${name} ${description}`;
  for (const [label, re] of CATEGORY_RULES) {
    if (re.test(text)) return label;
  }
  return "Other";
}
