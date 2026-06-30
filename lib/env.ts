/**
 * Centralized environment access. Everything that reads process.env goes
 * through here so missing config fails loudly and in one place.
 */

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return v;
}

export const env = {
  /** Anthropic API key - required for any Claude call. */
  get anthropicApiKey(): string {
    return required("ANTHROPIC_API_KEY");
  },

  /**
   * Turso/libsql connection. If TURSO_DATABASE_URL is unset we fall back to a
   * local SQLite file so the project runs with zero cloud setup in dev.
   */
  get dbUrl(): string {
    return optional("TURSO_DATABASE_URL") ?? "file:./.data/aemulus.db";
  },
  get dbAuthToken(): string | undefined {
    return optional("TURSO_AUTH_TOKEN");
  },

  /**
   * Secret for signing session JWTs. A dev-only fallback is allowed locally,
   * but in production an unset/default secret is fatal - otherwise anyone could
   * forge a session JWT for any wallet.
   */
  get authSecret(): string {
    const v = optional("AUTH_SECRET");
    const DEV_DEFAULT = "aemulus-dev-secret-change-me";
    if (this.isProd) {
      // This secret signs session JWTs AND derives the AES-256 at-rest key, so a
      // weak value is forgeable + weakens encryption. Require a real one in prod.
      if (!v || v === DEV_DEFAULT) {
        throw new Error(
          "AUTH_SECRET must be set to a strong, unique value in production.",
        );
      }
      if (v.length < 32) {
        throw new Error(
          "AUTH_SECRET must be at least 32 characters in production.",
        );
      }
    }
    return v ?? DEV_DEFAULT;
  },

  /**
   * Touch every required secret so a missing/weak prod config fails at BOOT
   * (in instrumentation.register) rather than mid-request on the first use.
   */
  validateAtBoot(): void {
    if (!this.isProd) return;
    void this.authSecret; // throws if unset/weak
  },

  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
