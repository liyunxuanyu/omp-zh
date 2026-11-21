import { describe, expect, test } from "bun:test";
import { GatewayError, normalizeBaseUrl, parseModel, parseModels, parseGateway } from "./gateway-core";

describe("omp-zh gateway metadata", () => {
  test("requires HTTPS except loopback HTTP and strips trailing slash", () => {
    expect(normalizeBaseUrl("https://gateway.example/v1/")).toBe("https://gateway.example/v1");
    expect(normalizeBaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/v1");
    expect(() => normalizeBaseUrl("http://gateway.example/v1")).toThrow(GatewayError);
  });

  test("validates native model capabilities and migrates legacy IDs", () => {
    expect(parseModel("legacy-model")).toEqual({ id: "legacy-model", input: ["text"], contextWindow: 32768, maxTokens: 4096 });
    expect(parseModel({ id: "vision", input: ["text", "image"], contextWindow: 200000, maxTokens: 64000 })).toMatchObject({ input: ["text", "image"] });
    expect(() => parseModel({ id: "bad", input: ["image"], contextWindow: 4096, maxTokens: 1024 })).toThrow(GatewayError);
    expect(() => parseModel({ id: "bad", input: ["text"], contextWindow: 4096, maxTokens: 8192 })).toThrow(GatewayError);
    expect(() => parseModels([{ id: "same", input: ["text"], contextWindow: 4096, maxTokens: 1024 }, { id: "same", input: ["text"], contextWindow: 4096, maxTokens: 1024 }])).toThrow(GatewayError);
  });

  test("persists only secret-free gateway metadata", () => {
    const row = parseGateway({ id: "offlinekit-gw-0123456789abcdef0123456789abcdef", label: "内网", baseUrl: "https://gateway.example/v1", api: "openai-completions", models: [{ id: "model", input: ["text"], contextWindow: 32768, maxTokens: 4096 }] });
    expect(JSON.stringify(row)).not.toContain("apiKey");
    expect(JSON.stringify(row)).not.toContain("secret");
  });
});
