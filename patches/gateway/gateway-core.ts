import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";

export const prefix = "offlinekit-gw-";
export const idPattern = /^offlinekit-gw-[a-f0-9]{32}$/;
const maxModels = 500;
const maxCatalogBytes = 2 * 1024 * 1024;
const control = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export type GatewayApi = "openai-completions" | "openai-responses";
export type ModelInput = "text" | "image";
export interface GatewayModel {
  id: string;
  input: ModelInput[];
  contextWindow: number;
  maxTokens: number;
}
export interface Gateway {
  id: string;
  label: string;
  baseUrl: string;
  api: GatewayApi;
  models: GatewayModel[];
}

export class GatewayError extends Error {}
export function newId() { return prefix + randomUUID().replaceAll("-", ""); }

export function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    const trimmed = value.trim();
    if (control.test(trimmed) || /\s|\\/.test(trimmed) || !/^https?:\/\//i.test(trimmed)) throw new Error();
    url = new URL(trimmed);
  }
  catch { throw new GatewayError("请输入有效的 HTTPS 或本机 HTTP 网关地址。"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new GatewayError("非本机网关必须使用 HTTPS，防止密钥以明文传输。");
  }
  if (url.username || url.password || url.href.includes("?") || url.href.includes("#")) {
    throw new GatewayError("地址不能包含账号密码、查询参数或片段。");
  }
  // A bare origin gets /v1; explicit paths may be organization-specific.
  const pathname = url.pathname.replace(/\/+$/, "") || "/v1";
  if (/\/(?:models|responses|chat\/completions)$/i.test(pathname)) {
    throw new GatewayError("只填写 API 基础地址（例如 https://gateway.example/v1），不要带操作路径。");
  }
  return url.origin + pathname;
}

export function gatewayLabel(value: string) {
  const label = value.trim();
  if (!label || label.length > 80 || control.test(label)) throw new GatewayError("名称必须为 1–80 个可见字符。");
  return label;
}

export function gatewayKey(value: string) {
  const key = value.trim();
  // The native key resolver interprets !command and environment references. Only store literal bearer tokens.
  if (!/^[A-Za-z0-9._~+\/=:-]{1,4096}$/.test(key) || key.startsWith("env:") || key.startsWith("literal:")) {
    throw new GatewayError("请输入有效的 Bearer 密钥；不支持命令、环境引用或空格。");
  }
  return key;
}

function validModel(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && value.length > 0 && !/[\s\\]/u.test(value) && !control.test(value);
}

export function modelIds(values: unknown[]) {
  return [...new Set(values.filter(validModel))].slice(0, maxModels);
}

function positiveInteger(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

export function parseModel(value: unknown): GatewayModel {
  // Migrate v1.4.0/v1.4.1 metadata, which stored model IDs only.
  if (typeof value === "string") {
    if (!validModel(value)) throw new GatewayError("模型配置无效；请重新填写模型 ID。");
    return { id: value, input: ["text"], contextWindow: 32768, maxTokens: 4096 };
  }
  const row = value as Partial<GatewayModel> | null;
  if (!row || typeof row.id !== "string" || !validModel(row.id) || !Array.isArray(row.input) ||
      !row.input.length || !row.input.includes("text") || row.input.some(kind => kind !== "text" && kind !== "image") ||
      new Set(row.input).size !== row.input.length ||
      !positiveInteger(row.contextWindow, 4_000_000) || !positiveInteger(row.maxTokens, 1_000_000) ||
      row.maxTokens > row.contextWindow) {
    throw new GatewayError("模型配置无效；请选择文本/多模态并填写有效的上下文和最大输出长度。");
  }
  return {
    id: row.id,
    input: [...row.input] as ModelInput[],
    contextWindow: row.contextWindow,
    maxTokens: row.maxTokens,
  };
}

export function parseModels(values: unknown[]) {
  if (!values.length || values.length > maxModels) throw new GatewayError("至少需要一个模型，最多 500 个模型。");
  const models = values.map(parseModel);
  if (new Set(models.map(model => model.id)).size !== models.length) throw new GatewayError("模型 ID 不能重复。");
  return models;
}

export function parseGateway(value: unknown): Gateway {
  const row = value as Partial<Gateway> | null;
  if (!row || typeof row.id !== "string" || !idPattern.test(row.id) ||
      typeof row.label !== "string" || typeof row.baseUrl !== "string" ||
      (row.api !== "openai-completions" && row.api !== "openai-responses") || !Array.isArray(row.models)) {
    throw new GatewayError("网关配置无法读取；未修改已有数据。");
  }
  return { id: row.id, label: gatewayLabel(row.label), baseUrl: normalizeBaseUrl(row.baseUrl), api: row.api, models: parseModels(row.models) };
}

export async function discoverModels(baseUrl: string, key: string, request = fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await request(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${gatewayKey(key)}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GatewayError("网关连接失败、超时或要求重定向；没有保存模型更改。");
  }
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxCatalogBytes) {
    void response.body?.cancel().catch(() => {});
    throw new GatewayError(response.ok ? "网关模型响应为空或过大。" : `网关 /models 返回 HTTP ${response.status}。`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let data: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxCatalogBytes) throw new Error();
      chunks.push(value);
    }
    data = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
  } catch {
    void reader.cancel().catch(() => {});
    throw new GatewayError("无法读取网关模型列表；响应超时、超限或不符合 JSON 格式。");
  } finally {
    reader.releaseLock();
  }
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows)) throw new GatewayError("网关模型响应缺少 OpenAI 格式的 data 数组。");
  const models = modelIds(rows.map(row => row?.id)).filter(id => !id.includes(key));
  if (!models.length) throw new GatewayError("网关没有返回可用模型，原有模型不变。");
  return models;
}
