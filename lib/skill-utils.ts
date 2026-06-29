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
