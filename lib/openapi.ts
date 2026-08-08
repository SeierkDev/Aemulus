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
    "/api/v1/runs/{id}/disclose": {
      get: {
        summary: "Prove one field of a run",
        description:
          "A selective-disclosure bundle for a single field, provable against the run's committed root (which is anchored on chain) without revealing any other field. Owner-only. Verify one with POST /api/disclosures/verify, which needs no key.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "field",
            in: "query",
            required: true,
            description: "Which committed field to prove.",
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "The disclosure bundle",
            ...json({
              type: "object",
              properties: {
                disclosure: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    field: { type: "string" },
                    value: { type: "string" },
                    salt: { type: "string" },
                    root: { type: "string" },
                    proof: { type: "object" },
                  },
                },
              },
            }),
          },
          400: { description: "No field given", ...json(ref("Error")) },
          404: {
            description: "Run not found, no commitment, or unknown field",
            ...json(ref("Error")),
          },
          ...ERR,
        },
      },
    },
    "/api/v1/watches": {
      get: {
        summary: "List your watches",
        responses: {
          200: {
            description:
              "Your watches, with each one's current value and whether it runs a skill when it fires",
          },
          ...ERR,
        },
      },
      post: {
        summary: "Create a watch",
        description:
          "A schedule plus the rule that reads its output, created together — a schedule with no rule burns the watch allowance every cadence and reports nothing. The cadence is checked against your tier first: an unaffordable one is refused, with the list you can sustain, rather than accepted and silently skipped. Optionally pass action:{kind:\"run_skill\",skillId} to run one of your skills when the rule fires, handed the value that fired it; it is metered against your daily run quota like any other run.",
        responses: {
          201: { description: "The watch" },
          403: {
            description: "Cadence your tier cannot sustain, or missing scope",
            ...json(ref("Error")),
          },
          404: { description: "Skill not found", ...json(ref("Error")) },
          409: { description: "Schedule limit reached", ...json(ref("Error")) },
          ...ERR,
        },
      },
    },
    "/api/v1/watches/{id}": {
      get: {
        summary: "Get one watch",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "The watch, with its failure streak and mute state" },
          404: { description: "Watch not found", ...json(ref("Error")) },
          ...ERR,
        },
      },
      patch: {
        summary: "Pause, resume, or disarm a watch",
        description:
          'Send active to pause or resume. Send action:"alert" to stop it running a skill while leaving the watch and its baseline intact — deleting and recreating would lose the baseline, so the replacement stays quiet through the first real change. Either field alone is enough.',
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "The new state" },
          404: { description: "Watch not found", ...json(ref("Error")) },
          ...ERR,
        },
      },
      delete: {
        summary: "Delete a watch",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Deleted" },
          404: { description: "Watch not found", ...json(ref("Error")) },
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
