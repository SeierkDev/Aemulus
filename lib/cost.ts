/**
 * Run cost transparency. The only per-run Claude cost is the operator model
 * (used when a recorded selector no longer matches); pricing is USD per 1M
 * tokens for that model (Sonnet 4.6 defaults: $3 in / $15 out), overridable via
 * env if the operator model/pricing changes.
 */
const IN_PER_M = Number(process.env.AEMULUS_OPERATOR_IN_PER_M) || 3;
const OUT_PER_M = Number(process.env.AEMULUS_OPERATOR_OUT_PER_M) || 15;

export function estimateRunCostUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1_000_000) * IN_PER_M + (tokensOut / 1_000_000) * OUT_PER_M;
}

export function formatUsd(n: number): string {
  if (!(n > 0)) return "$0.00"; // also catches NaN
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
