"use client";

import { Button } from "./ui";
import { toCsv } from "@/lib/csv";

/** Download the bulk results as a CSV (built client-side, no round-trip). */
export function ExportCsv({
  headers,
  rows,
  filename,
}: {
  headers: string[];
  rows: Record<string, string>[];
  filename: string;
}) {
  function download() {
    const blob = new Blob([toCsv(headers, rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="default" onClick={download}>
      Export CSV
    </Button>
  );
}
