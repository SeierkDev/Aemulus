import type { Cadence } from "./types";

/**
 * The curated alert list.
 *
 * The engine has always been able to watch any page; what stopped anyone using
 * it was that the only way in was "record a task by demonstrating it", which is
 * a sentence a trader has no interest in. These are the same watches with the
 * recording already done, so the first tap produces something useful.
 *
 * Every entry points at a PUBLIC page on purpose. Anything behind a login needs
 * the browser extension, and requiring that before a person has seen the product
 * work is the same wall in a different place.
 *
 * The boundary worth keeping in mind: this is not a sniping tool. Launches, dev
 * sells and bundled buys are on-chain and read in milliseconds by bots we are
 * not going to beat with a scheduled page check. These are the surfaces no bot
 * indexes, where minutes matter rather than milliseconds.
 */

export interface AlertPreset {
  id: string;
  /** What the person gets, in their words, not ours. */
  title: string;
  /** The page it watches, said plainly. */
  detail: string;
  /** Prefilled when the preset is turned on; still editable afterwards. */
  suggested: Cadence;
  /**
   * The skill this preset runs. Null until one has been recorded and published,
   * which is deliberate: a preset with no skill renders as "coming", never as a
   * toggle that quietly does nothing.
   */
  skillId: string | null;
  /** An input the person has to supply, if the skill takes one. */
  ask?: { key: string; label: string; placeholder: string };
}

export const ALERT_PRESETS: AlertPreset[] = [
  {
    id: "cex-listing",
    title: "A CEX posts the ticker",
    detail: "Exchange announcement pages",
    suggested: "every15m",
    skillId: null,
  },
  {
    id: "site-docs",
    title: "The site or docs change",
    detail: "Team, roadmap, tokenomics",
    suggested: "hourly",
    skillId: null,
    ask: { key: "url", label: "Page to watch", placeholder: "https://…" },
  },
  {
    id: "socials-gone",
    title: "Socials vanish from the page",
    detail: "The earliest rug tell there is",
    suggested: "every30m",
    skillId: null,
    ask: { key: "url", label: "Coin or project page", placeholder: "https://…" },
  },
  {
    id: "unlock",
    title: "An unlock is coming",
    detail: "Public unlock schedules",
    suggested: "daily",
    skillId: null,
  },
  {
    id: "governance",
    title: "A governance proposal goes up",
    detail: "Any DAO forum you follow",
    suggested: "hourly",
    skillId: null,
    ask: { key: "url", label: "Forum page", placeholder: "https://…" },
  },
  {
    id: "listing-status",
    title: "CoinGecko or CMC lists it",
    detail: "Public listing pages",
    suggested: "hourly",
    skillId: null,
    ask: { key: "url", label: "Token page", placeholder: "https://…" },
  },
  {
    id: "any-page",
    title: "Any page you choose",
    detail: "Give it a link, tell it what to watch",
    suggested: "hourly",
    skillId: null,
    ask: { key: "url", label: "Page to watch", placeholder: "https://…" },
  },
];

/** Presets that can actually run today. The rest render as "coming soon". */
export function livePresets(): AlertPreset[] {
  return ALERT_PRESETS.filter((p) => p.skillId);
}

export function presetById(id: string): AlertPreset | null {
  return ALERT_PRESETS.find((p) => p.id === id) ?? null;
}
