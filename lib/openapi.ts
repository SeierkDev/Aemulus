/**
 * OpenAPI 3.0 description of the public Aemulus protocol. Served at
 * /api/openapi.json so it can be imported into Postman, drive codegen, or feed
 * an API explorer. Kept hand-written + tested for shape (see openapi.test.ts).
 */

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  security: Record<string, string[]>[];
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  paths: Record<string, Record<string, unknown>>;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({
  content: { "application/json": { schema } },
});
const ERR = { 401: { description: "Missing/invalid API key", ...json(ref("Error")) } };

// Shared cursor-pagination query params (?limit=&cursor=).
const PAGE_PARAMS = [
  {
    name: "limit",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    description: "Page size (max 100).",
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    schema: { type: "string" },
    description: "Opaque cursor from a prior response's nextCursor.",
  },
];

export const OPENAPI: OpenApiDoc = {
  openapi: "3.0.3",
  info: {
    title: "Aemulus Protocol API",
    version: "1.0.0",
    description:
      "Run browser-automation skills, read their extracted output, and verify their on-chain receipts. Authenticate with an API key (Bearer); receipt verification is public.",
  },
  servers: [{ url: "https://aemulusai.com" }],
  security: [{ ApiKey: [] }],
  components: {
    securitySchemes: {
      ApiKey: {
        type: "http",
        scheme: "bearer",
        description: "An Aemulus API key, e.g. `aem_live_…`.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      RunRequest: {
        type: "object",
        properties: {
          skillId: { type: "string", example: "skl_8c…" },
          input: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Field key → value for the skill's inputs.",
          },
        },
        required: ["skillId"],
      },
      Run: {
        type: "object",
        properties: {
          id: { type: "string" },
          skillId: { type: "string" },
          status: {
            type: "string",
            enum: ["running", "awaiting_input", "completed", "needs_review", "failed"],
          },
          result: { type: "string", nullable: true },
          output: {
            type: "object",
            nullable: true,
            additionalProperties: { type: "string" },
          },
          receiptHash: { type: "string", nullable: true },
          steps: { type: "integer" },
          createdAt: { type: "integer" },
        },
      },
      RunListItem: {
        type: "object",
        description: "List items omit `result` and `steps` (fetch a single run for those).",
        properties: {
          id: { type: "string" },
          skillId: { type: "string" },
          status: {
            type: "string",
            enum: ["running", "awaiting_input", "completed", "needs_review", "failed"],
          },
          output: {
            type: "object",
            nullable: true,
            additionalProperties: { type: "string" },
          },
          receiptHash: { type: "string", nullable: true },
          createdAt: { type: "integer" },
        },
      },
      RunStarted: {
        type: "object",
        description: "POST /runs returns only these two fields (the run starts async).",
        properties: {
          id: { type: "string" },
          status: {
            type: "string",
            enum: ["running", "awaiting_input", "completed", "needs_review", "failed"],
          },
        },
      },
      SkillSummary: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          version: { type: "integer" },
          runCount: { type: "integer" },
          inputs: {
            type: "array",
            items: {
              type: "object",
              properties: { key: { type: "string" }, label: { type: "string" } },
            },
          },
        },
      },
      Verification: {
        type: "object",
        properties: {
          found: { type: "boolean" },
          runId: { type: "string" },
          status: { type: "string" },
          steps: { type: "integer" },
          hash: { type: "string", nullable: true },
          matches: { type: "boolean" },
          batch: {
            type: "object",
            properties: {
              id: { type: "string" },
              root: { type: "string" },
              index: { type: "integer" },
              leafCount: { type: "integer" },
              proofValid: { type: "boolean" },
              anchor: {
                type: "object",
                nullable: true,
                properties: {
                  sig: { type: "string" },
                  cluster: { type: "string" },
                  url: { type: "string" },
                  memoMatches: { type: "boolean", nullable: true },
                },
              },
            },
          },
        },
      },
      VerificationNotFound: {
        type: "object",
        properties: {
          found: { type: "boolean", enum: [false] },
          runId: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/api/v1/runs": {
      post: {
        summary: "Run a skill",
        description:
          "Starts a run; returns immediately with status \"running\". Send an " +
          "`Idempotency-Key` header to make retries safe - the same key returns " +
          "the original run instead of starting a new one.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string", maxLength: 255 },
            description: "Replay-safe key; identical retries return the first response.",
          },
        ],
        requestBody: { required: true, ...json(ref("RunRequest")) },
        responses: {
          200: { description: "Run started", ...json(ref("RunStarted")) },
          400: { description: "Invalid body", ...json(ref("Error")) },
          403: { description: "Insufficient $AEMU balance for access", ...json(ref("Error")) },
          404: { description: "Skill not found", ...json(ref("Error")) },
          409: { description: "An identical Idempotency-Key request is in progress", ...json(ref("Error")) },
          429: { description: "Daily quota reached", ...json(ref("Error")) },
          ...ERR,
        },
      },
      get: {
        summary: "List your runs",
        description: "Your runs, newest first. Cursor-paginated.",
        parameters: PAGE_PARAMS,
        responses: {
          200: {
            description: "A page of runs",
            ...json({
              type: "object",
              properties: {
                runs: { type: "array", items: ref("RunListItem") },
                nextCursor: { type: "string", nullable: true },
              },
            }),
          },
          ...ERR,
        },
      },
    },
    "/api/v1/runs/{id}": {
      get: {
        summary: "Get a run",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "The run", ...json(ref("Run")) },
          404: { description: "Run not found", ...json(ref("Error")) },
          ...ERR,
        },
      },
    },
    "/api/v1/skills": {
      get: {
        summary: "List published skills",
        description: "The published catalog, newest first. Cursor-paginated.",
        parameters: PAGE_PARAMS,
        responses: {
          200: {
            description: "A page of the catalog",
            ...json({
              type: "object",
              properties: {
                skills: { type: "array", items: ref("SkillSummary") },
                nextCursor: { type: "string", nullable: true },
              },
            }),
          },
          ...ERR,
        },
      },
    },
    "/api/verify/{runId}": {
      get: {
        summary: "Verify a receipt (public)",
        security: [],
        parameters: [
          { name: "runId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Verification result", ...json(ref("Verification")) },
          404: { description: "No receipt", ...json(ref("VerificationNotFound")) },
        },
      },
    },
    "/api/batch/{id}/bundle": {
      get: {
        summary: "Download a proof bundle (public)",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Self-contained, content-addressed proof bundle" },
          404: { description: "Batch not found", ...json(ref("Error")) },
        },
      },
    },
  },
};
