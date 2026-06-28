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
  /** Anthropic API key — required for any Claude call. */
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
   * but in production an unset/default secret is fatal — otherwise anyone could
   * forge a session JWT for any wallet.
   */
  get authSecret(): string {
    const v = optional("AUTH_SECRET");
    const DEV_DEFAULT = "aemulus-dev-secret-change-me";
    if (this.isProd && (!v || v === DEV_DEFAULT)) {
      throw new Error(
        "AUTH_SECRET must be set to a strong, unique value in production.",
      );
    }
    return v ?? DEV_DEFAULT;
  },

  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
