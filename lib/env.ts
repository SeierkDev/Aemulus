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
    // The dev default is allowed ONLY in an explicit dev/test runtime. Any other
    // runtime — production, or a misconfigured deploy that never set NODE_ENV —
    // must supply a strong secret, so we fail closed instead of silently signing
    // JWTs + deriving the AES key from a public constant.
    const nodeEnv = process.env.NODE_ENV;
    const isDevOrTest = nodeEnv === "development" || nodeEnv === "test";
    if (!isDevOrTest) {
      if (!v || v === DEV_DEFAULT) {
        throw new Error(
          "AUTH_SECRET must be set to a strong, unique value (the dev default is not allowed outside development).",
        );
      }
      if (v.length < 32) {
        throw new Error("AUTH_SECRET must be at least 32 characters.");
      }
    }
    return v ?? DEV_DEFAULT;
  },

  /**
   * Touch every required secret so a missing/weak prod config fails at BOOT
   * (in instrumentation.register) rather than mid-request on the first use.
   */
  validateAtBoot(): void {
    // Always touch authSecret — it throws for a weak/default secret in any
    // non-dev/test runtime, so even a deploy that forgot NODE_ENV fails at boot.
    void this.authSecret;
  },

  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
