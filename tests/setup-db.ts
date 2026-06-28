// Point the data layer at an isolated in-memory libsql DB for tests. Each test
// file gets its own module graph (vitest isolation) → its own :memory: database.
process.env.TURSO_DATABASE_URL = ":memory:";
process.env.AUTH_SECRET ||= "test-secret";
