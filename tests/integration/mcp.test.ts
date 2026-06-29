import { beforeAll, describe, expect, it } from "vitest";
import { ready } from "../../lib/db";
import { createSkill, setPublished } from "../../lib/skills";
import { handleMcp } from "../../lib/mcp";
import type { GeneralizedSkill } from "../../lib/types";

const OWNER = "WALLET_MCP";

interface RpcResponse {
  result?: {
    content?: { text: string }[];
    tools?: { name: string }[];
    serverInfo?: { name: string };
    protocolVersion?: string;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

const gen = (name: string): GeneralizedSkill => ({
  name,
  description: "d",
  inputFields: [],
  steps: [
    {
      intent: "o",
      action: "navigate",
      selectors: [],
      target: "data:text/html,<p>x</p>",
      valueSource: "none",
      value: "",
      inputKey: "",
      key: "",
    },
  ],
});

const rpc = (method: string, params?: Record<string, unknown>) =>
  handleMcp(OWNER, { jsonrpc: "2.0", id: 1, method, params }) as Promise<RpcResponse | null>;
const firstText = (r: RpcResponse | null) => r!.result!.content![0].text;

beforeAll(async () => {
  await ready();
});

describe("MCP server", () => {
  it("initialize advertises the server + tools/list returns the toolset", async () => {
    const init = (await rpc("initialize"))!.result!;
    expect(init.serverInfo!.name).toBe("aemulus");
    expect(init.protocolVersion).toBeTruthy();

    const tools = (await rpc("tools/list"))!.result!.tools!.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(["list_skills", "run_skill", "get_run", "verify_receipt"]),
    );
  });

  it("notifications get no response; unknown methods error", async () => {
    expect(await rpc("notifications/initialized")).toBeNull();
    const e = await rpc("totally_unknown");
    expect(e!.error!.code).toBe(-32601);
  });

  it("list_skills returns the published catalog", async () => {
    const s = await createSkill({ owner: OWNER, generalized: gen("MCP skill"), sourceDemoId: null });
    await setPublished(s.id, OWNER, true);
    const data = JSON.parse(
      firstText(await rpc("tools/call", { name: "list_skills", arguments: {} })),
    );
    expect(data.skills.find((x: { id: string }) => x.id === s.id)).toBeTruthy();
  });

  it("tool errors are returned as isError, not thrown", async () => {
    const bad = (await rpc("tools/call", { name: "run_skill", arguments: { skillId: "nope" } }))!
      .result!;
    expect(bad.isError).toBe(true);
    const ver = JSON.parse(
      firstText(await rpc("tools/call", { name: "verify_receipt", arguments: { runId: "nope" } })),
    );
    expect(ver.found).toBe(false);
  });
});
