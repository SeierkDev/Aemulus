import type { SkillStep } from "./types";

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
