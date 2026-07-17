import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, imageBlock, MODELS } from "../claude";

// Read a real invoice (PDF or image) with Claude vision and pull out the fields
// the AP pipeline needs. This is the "OCR" step — no new vendor, it uses the
// same Anthropic client the operator already uses. Structured output forces a
// schema-valid JSON object back, so there is nothing to parse loosely.

export interface ExtractedInvoice {
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string; // ISO YYYY-MM-DD, or "" if not found
  amount: number; // total due, in the invoice's currency
  currency: string; // ISO 4217, e.g. USD
  confidence: number; // 0..1, how sure the model is about the read
}

export type ExtractInput =
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; mediaType: "image/png" | "image/jpeg" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: "string" },
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string" },
    amount: { type: "number" },
    currency: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["vendor", "invoiceNumber", "invoiceDate", "amount", "currency", "confidence"],
} as const;

const PROMPT =
  "You are reading a single supplier invoice. Extract these fields:\n" +
  "- vendor: the biller/supplier name (who is owed money), not the recipient.\n" +
  "- invoiceNumber: the invoice/document number.\n" +
  "- invoiceDate: the invoice date as ISO YYYY-MM-DD.\n" +
  "- amount: the TOTAL amount due, as a plain number (no currency symbol or commas).\n" +
  "- currency: ISO 4217 code (e.g. USD, EUR, GBP).\n" +
  "- confidence: 0..1, how confident you are in this read overall.\n" +
  "If a field is genuinely not present, use an empty string (or 0 for amount) and lower your confidence. Do not invent values.";

/** Clamp/normalize a raw model read into a safe ExtractedInvoice. */
export function normalizeExtracted(raw: Partial<ExtractedInvoice>): ExtractedInvoice {
  const amount = Number(raw.amount);
  const conf = Number(raw.confidence);
  const date = String(raw.invoiceDate ?? "").trim();
  return {
    vendor: String(raw.vendor ?? "").trim(),
    invoiceNumber: String(raw.invoiceNumber ?? "").trim(),
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    currency: (String(raw.currency ?? "USD").trim() || "USD").toUpperCase().slice(0, 3),
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
  };
}

export async function extractInvoice(input: ExtractInput): Promise<ExtractedInvoice> {
  const doc: Anthropic.ContentBlockParam =
    input.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } }
      : imageBlock(input.base64, input.mediaType);

  const res = await getClaude().messages.create({
    model: MODELS.generalizer, // vision-capable; extraction is a read, not deep reasoning
    max_tokens: 1024,
    thinking: { type: "disabled" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [doc, { type: "text", text: PROMPT }] }],
  });

  const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  let raw: Partial<ExtractedInvoice>;
  try {
    raw = JSON.parse(text) as Partial<ExtractedInvoice>;
  } catch {
    throw new Error("could not read the invoice");
  }
  return normalizeExtracted(raw);
}
