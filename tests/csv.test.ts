import { describe, it, expect } from "vitest";
import { parseCsv, csvToRows, toCsv } from "../lib/csv";

describe("parseCsv", () => {
  it("parses quoted commas, escaped quotes, and CRLF", () => {
    const text = 'a,b\r\n"x,y","he said ""hi"""\nplain,z';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
      ["plain", "z"],
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("csvToRows", () => {
  it("maps headers to field keys (case/space-insensitive)", () => {
    const text = "Vendor, Amount\nAcme,1499\nBeta,2200";
    const { rows, missing } = csvToRows(text, ["vendor", "amount"]);
    expect(missing).toEqual([]);
    expect(rows).toEqual([
      { vendor: "Acme", amount: "1499" },
      { vendor: "Beta", amount: "2200" },
    ]);
  });

  it("reports missing columns", () => {
    const { rows, missing } = csvToRows("vendor\nAcme", ["vendor", "amount"]);
    expect(missing).toEqual(["amount"]);
    expect(rows).toEqual([{ vendor: "Acme" }]);
  });
});

describe("toCsv", () => {
  it("round-trips and escapes", () => {
    const csv = toCsv(["a", "b"], [{ a: "x,y", b: 'q"z' }]);
    expect(csv).toBe('a,b\n"x,y","q""z"');
    expect(parseCsv(csv)).toEqual([
      ["a", "b"],
      ["x,y", 'q"z'],
    ]);
  });
});
