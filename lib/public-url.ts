/**
 * The app's public base URL, used in developer docs / OpenAPI examples so they
 * point at wherever the app actually runs. Prefers an explicit override, then
 * Railway's injected public domain, then the production domain as a fallback.
 */
export function publicBaseUrl(): string {
  const explicit = process.env.AEMULUS_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway}`;
  return "https://aemulusai.com";
}
