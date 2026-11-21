import { join } from "node:path";
import type { ProviderConfigInput, ModelRegistry } from "../config/model-registry";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../extensibility/extensions/types";
import { GatewayError, gatewayKey, gatewayLabel, modelIds, newId, normalizeBaseUrl, parseModels, type Gateway, type GatewayApi, type GatewayModel } from "./gateway-core.ts";
import { GatewayStore } from "./gateway-store.ts";

function config(row: Gateway): ProviderConfigInput {
  return {
    baseUrl: row.baseUrl,
    api: row.api,
    // v18.22.2 requires either apiKey or oauth for static models. Supplying
    // apiKey here would shadow native saved credentials, so the dashboard owns login.
    oauth: {
      name: `网关 · ${row.label}`,
      async login() { throw new GatewayError("请从 /gateway（/网关）设置或更新此网关的密钥。"); },
    },
    models: row.models.map(model => ({
      id: model.id, name: `${row.label} · ${model.id}`,
      input: model.input,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(row.api === "openai-completions" ? { compat: { supportsDeveloperRole: false, supportsStore: false } } : {}),
    })),
  };
}

const title = "OMP 网关 · API 与模型管理";
function parsePositive(raw: string, label: string, maximum: number) {
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new GatewayError(`${label}必须是 1–${maximum.toLocaleString()} 之间的整数。`);
  }
  return value;
}

const contextPresets = [
  [2048, "2K"], [4096, "4K"], [8192, "8K"], [16384, "16K"],
  [32768, "32K"], [65536, "64K"], [131072, "128K"], [200000, "200K"],
  [262144, "256K"], [524288, "512K"], [1048576, "1M"], [2097152, "2M"], [4194304, "4M"],
] as const;
function tokenLabel(value: number) {
  const preset = contextPresets.find(([tokens]) => tokens === value);
  return preset ? `${preset[1]}（${value.toLocaleString()}）` : `${value.toLocaleString()} tokens`;
}
async function promptContext(ctx: ExtensionCommandContext, existing?: number) {
  const choices = contextPresets.map(([, label]) => label);
  if (existing && !contextPresets.some(([tokens]) => tokens === existing)) choices.unshift(`当前值（${tokenLabel(existing)}）`);
  choices.push("自定义输入");
  const selected = await ctx.ui.select("上下文长度（手动选择，不会自动探测）", choices);
  if (!selected) return undefined;
  if (selected === "自定义输入") {
    const custom = await ctx.ui.input("自定义上下文长度（token）", String(existing ?? 32768));
    if (custom === undefined) return undefined;
    return parsePositive(custom, "上下文长度", 4_000_000);
  }
  if (selected.startsWith("当前值（")) return existing;
  const preset = contextPresets.find(([, label]) => label === selected);
  if (!preset) throw new GatewayError("上下文长度选项无效。");
  return preset[0];
}

async function promptModel(ctx: ExtensionCommandContext, existing?: GatewayModel, key?: string): Promise<GatewayModel | undefined> {
  const id = await ctx.ui.input("模型 ID（手动填写）", existing?.id ?? "例如：qwen2.5-vl");
  if (id === undefined) return;
  const cleanId = id.trim();
  if (!modelIds([cleanId]).length || (key && cleanId.includes(key))) {
    throw new GatewayError("模型 ID 无效，不能包含空格、控制字符或密钥。");
  }
  const kind = await ctx.ui.select("模型输入能力（不会自动探测，请手动选择）", ["纯文本", "多模态（文本 + 图片）"]);
  if (!kind) return;
  const contextWindow = await promptContext(ctx, existing?.contextWindow);
  if (contextWindow === undefined) return;
  const output = await ctx.ui.input("最大输出长度（token，手动输入）", String(existing?.maxTokens ?? 4096));
  if (output === undefined) return;
  return {
    id: cleanId,
    input: kind === "多模态（文本 + 图片）" ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens: parsePositive(output, "最大输出长度", Math.min(1_000_000, contextWindow)),
  };
}

async function promptModels(ctx: ExtensionCommandContext, existing: GatewayModel[] | undefined, key?: string) {
  const models: GatewayModel[] = [];
  if (existing?.length) {
    for (const model of existing) {
      const next = await promptModel(ctx, model, key);
      if (!next) return undefined;
      models.push(next);
    }
    return parseModels(models);
  }
  for (;;) {
    const next = await promptModel(ctx, undefined, key);
    if (!next) return undefined;
    models.push(next);
    if (models.length >= 500 || !(await ctx.ui.confirm("继续添加模型？", "选择取消完成当前网关的模型配置。"))) break;
  }
  return parseModels(models);
}
const activeModel = (ctx: ExtensionContext) => ctx.models.current();
function auth(ctx: ExtensionContext) { return ctx.modelRegistry.authStorage.credentials; }

/** Register persisted gateway providers before model selection. Secrets remain in native auth storage. */
export async function loadGatewayProviders(modelRegistry: ModelRegistry, agentDir: string): Promise<{ invalid: number }> {
  const store = new GatewayStore(join(agentDir, "offline-kit-gateways"));
  let loaded: { rows: Gateway[]; invalid: number };
  try {
    loaded = await store.load();
  } catch {
    // Gateway metadata is optional; a locked/unreadable profile must not stop
    // ordinary omp startup. The interactive dashboard reports the problem.
    return { invalid: 1 };
  }
  let invalid = loaded.invalid;
  for (const row of loaded.rows) {
    try {
      // A stable opaque ID owns only the metadata file created by this feature.
      // Never override a built-in or user extension provider with the same ID.
      if (modelRegistry.getProviderBaseUrl(row.id)) continue;
      // Undefined provenance makes this a core registration. It must survive
      // the normal extension-source reconciliation later in session startup.
      modelRegistry.registerProvider(row.id, config(row));
    } catch {
      invalid++;
    }
  }
  return { invalid };
}

export default async function providerManager(pi: ExtensionAPI) {
  const store = new GatewayStore(join(pi.pi.getAgentDir(), "offline-kit-gateways"));
  const registered = new Map<string, Gateway>();
  let opened = false;
  let startupError = false;
  const showError = (ctx: ExtensionContext, error: unknown) => {
    // Filesystem/HTTP/native failures may include input; never echo raw exceptions.
    ctx.ui.notify(error instanceof GatewayError ? error.message : "网关操作失败。请检查配置目录权限与 OMP 登录存储后重试。", "error");
  };
  function register(row: Gateway, ctx?: ExtensionContext) {
    const previous = registered.get(row.id);
    if (JSON.stringify(previous) === JSON.stringify(row)) return;
    if (!previous && ctx?.modelRegistry.getProviderBaseUrl(row.id)) {
      if (ctx.modelRegistry.getProviderBaseUrl(row.id) === row.baseUrl) {
        // Core startup may have loaded this row before the inline command
        // factory was bound. Update the same registry directly so edits replace
        // its static model metadata instead of becoming a no-op.
        ctx.modelRegistry.registerProvider(row.id, config(row));
        registered.set(row.id, row);
        return;
      }
      throw new GatewayError("网关 ID 已被 OMP 中的其他配置占用；未覆盖已有配置。");
    }
    if (previous && (previous.baseUrl !== row.baseUrl || previous.api !== row.api)) {
      throw new GatewayError("网关地址和协议不可就地更改；请新增网关。\n已加载的配置未被覆盖。");
    }
    pi.registerProvider(row.id, config(row));
    registered.set(row.id, row);
  }
  function unregister(id: string, ctx: ExtensionContext) {
    const previous = registered.get(id);
    if (!previous) return;
    if (ctx.modelRegistry.getProviderBaseUrl(id) === previous.baseUrl) pi.unregisterProvider(id);
    registered.delete(id);
  }
  try {
    const { rows, invalid } = await store.load();
    startupError = invalid > 0;
    // Core startup loads these rows before model resolution. The inline factory
    // only installs the interactive command; registering here would queue a
    // second provider registration for the same opaque ID.
  } catch { startupError = true; }

  async function reconcile(ctx: ExtensionContext) {
    const { rows, invalid } = await store.load();
    if (!invalid) {
      for (const id of registered.keys()) {
        if (!rows.some(row => row.id === id)) unregister(id, ctx);
      }
    }
    for (const row of rows) register(row, ctx);
    if (invalid) ctx.ui.notify("部分网关配置不可读取；未修改这些配置。", "warning");
    return rows;
  }

  async function add(ctx: ExtensionCommandContext) {
    const labelInput = await ctx.ui.input("网关名称", "例如：公司网关");
    if (labelInput === undefined) return;
    const label = gatewayLabel(labelInput);
    const urlInput = await ctx.ui.input("网关 API 基础地址（仅向此地址发送密钥）", "https://gateway.example/v1");
    if (urlInput === undefined) return;
    const baseUrl = normalizeBaseUrl(urlInput);
    const protocol = await ctx.ui.select("网关协议", ["Chat Completions", "Responses"]);
    if (!protocol) return;
    const api: GatewayApi = protocol === "Responses" ? "openai-responses" : "openai-completions";
    ctx.ui.notify("网关不会返回模型能力；请手动选择每个模型的文本/多模态、上下文和最大输出。", "info");
    const pasted = await ctx.ui.input("网关 API 密钥（输入隐藏；保存至 OMP 登录存储）", undefined, { secret: true });
    if (pasted === undefined) return;
    const key = gatewayKey(pasted);
    if (label.includes(key) || baseUrl.includes(key)) throw new GatewayError("密钥不能出现在网关名称或地址中。");
    const models = await promptModels(ctx, undefined, key);
    if (!models) return;
    let id = newId();
    while (registered.has(id) || ctx.modelRegistry.getProviderBaseUrl(id) || auth(ctx).has(id)) id = newId();
    const row = { id, label, baseUrl, api, models };
    await store.write(id, undefined, async () => {
      // Save the secret only in the native credential store. A metadata failure
      // must not silently leave the key behind.
      requireLocalAuth();
      const storage = auth(ctx);
      await storage.set(id, { type: "api_key", key, source: "login" });
      try {
        await store.save(row);
        try { register(row, ctx); }
        catch (error) { await store.remove(id); throw error; }
      } catch (error) {
        requireLocalAuth();
        await storage.remove(id);
        throw error;
      }
    });
    ctx.ui.notify(`已添加 ${label}（${models.length} 个模型）。可在 /model 中选择。`, "info");
    if (await ctx.ui.confirm("切换当前模型？", "也可以稍后打开 /model。")) await selectModel(ctx, row);
  }

  async function selectModel(ctx: ExtensionCommandContext, row: Gateway) {
    const selected = await ctx.ui.select(`选择 ${row.label} 的模型`, row.models.map(model => model.id));
    if (!selected) return;
    const model = ctx.modelRegistry.find(row.id, selected);
    if (!model || model.baseUrl !== row.baseUrl || !(await pi.setModel(model))) {
      throw new GatewayError("无法切换；请检查密钥是否已保存，或从 /model 重新选择。");
    }
    ctx.ui.notify(`已切换至 ${row.label} · ${selected}。`, "info");
  }

  async function updateKey(ctx: ExtensionCommandContext, row: Gateway) {
    const raw = await ctx.ui.input(`更新 ${row.label} 的密钥（不显示旧密钥）`, undefined, { secret: true });
    if (raw === undefined) return;
    const key = gatewayKey(raw);
    if (row.label.includes(key) || row.baseUrl.includes(key) || row.models.some(model => model.id.includes(key))) {
      throw new GatewayError("密钥不能出现在网关名称、地址或模型 ID 中。");
    }
    if (!(await ctx.ui.confirm("更换密钥（不联网）", `只替换 ${row.label} 的密钥。之后此网关将向 ${row.baseUrl} 使用新密钥。`))) return;
    await store.write(row.id, row, () => {
      requireLocalAuth();
      return auth(ctx).set(row.id, { type: "api_key", key, source: "login" });
    });
    ctx.ui.notify("密钥已更新。并行运行的窗口可能需要重启。", "info");
  }

  async function saveChanges(ctx: ExtensionCommandContext, row: Gateway, updated: Gateway) {
    const current = activeModel(ctx);
    if (current?.provider === row.id && !updated.models.some(model => model.id === current.id)) {
      throw new GatewayError("新列表不含当前模型。请先通过 /model 切换，再更新列表。原有列表未更改。");
    }
    await store.write(row.id, row, async () => {
      await store.save(updated);
      try { register(updated, ctx); }
      catch (error) { await store.save(row); throw error; }
    });
  }

  async function edit(ctx: ExtensionCommandContext, row: Gateway) {
    const name = await ctx.ui.input("修改名称（留空保留；改地址/协议请新增网关）", row.label);
    if (name === undefined) return;
    requireLocalAuth();
    const credential = auth(ctx).get(row.id);
    const key = credential?.type === "api_key" ? gatewayKey(credential.key) : undefined;
    const label = name.trim() ? gatewayLabel(name) : row.label;
    const models = await promptModels(ctx, row.models, key);
    if (!models) return;
    if (key && label.includes(key)) throw new GatewayError("密钥不能出现在网关名称中。");
    await saveChanges(ctx, row, { ...row, label, models });
    ctx.ui.notify(`已保存 ${label}（${models.length} 个模型）。`, "info");
  }

  async function refresh(ctx: ExtensionCommandContext, row: Gateway) {
    if (!(await ctx.ui.confirm("重新配置模型能力", "网关不会返回可靠的能力元数据；下面将手动重填模型、文本/多模态、上下文和最大输出，不会联网。"))) return;
    requireLocalAuth();
    const credential = auth(ctx).get(row.id);
    const key = credential?.type === "api_key" ? gatewayKey(credential.key) : undefined;
    const models = await promptModels(ctx, row.models, key);
    if (!models) return;
    await saveChanges(ctx, row, { ...row, models });
    ctx.ui.notify(`模型能力已保存（${models.length} 个）。`, "info");
  }

  async function remove(ctx: ExtensionCommandContext, row: Gateway) {
    if (activeModel(ctx)?.provider === row.id) throw new GatewayError("请先通过 /model 切换到另一网关，再删除此网关。");
    if (!(await ctx.ui.confirm("删除网关", `删除 ${row.label}、其模型列表和该网关的密钥？`))) return;
    await store.write(row.id, row, async () => {
      // Only ever mutate the opaque id associated with this extension's file.
      requireLocalAuth();
      await auth(ctx).remove(row.id);
      await store.remove(row.id);
      unregister(row.id, ctx);
    });
    ctx.ui.notify("网关已删除。其他 OMP 窗口可能需要重启。", "info");
  }

  function usesAuthBroker() {
    const global = pi.pi.settings.getGlobalSettings() as { auth?: { broker?: { url?: unknown } }; "auth.broker.url"?: unknown };
    return Boolean(process.env.OMP_AUTH_BROKER_URL || global.auth?.broker?.url || global["auth.broker.url"]);
  }

  function requireLocalAuth() {
    if (usesAuthBroker()) throw new GatewayError("此面板要求本地 OMP 登录存储；检测到 Auth Broker，未读取或写入网关密钥。");
  }

  async function dashboard(args: string, ctx: ExtensionCommandContext) {
    if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return;
    if (args.trim()) { ctx.ui.notify("请运行 /gateway 或 /网关，不要在命令行粘贴密钥。", "warning"); return; }

    if (!ctx.isIdle() || ctx.hasPendingMessages() || opened) {
      ctx.ui.notify("请在当前会话空闲时打开网关面板。", "warning");
      return;
    }
    opened = true;
    try {
      requireLocalAuth();
      await auth(ctx).poll();
      for (;;) {
        const rows = await reconcile(ctx);
        const addLabel = "＋ 添加网关";
        const quitLabel = "关闭";
        const labels = rows.map((row, i) => `${i + 1}. ${row.label} · ${row.baseUrl}`);
        const options = rows.map((row, i) => ({ label: labels[i], description: `${row.models.length} 个模型 · ${auth(ctx).has(row.id) ? "已保存密钥" : "未保存密钥"}` }));
        const selected = await ctx.ui.select(title, [addLabel, ...options, quitLabel]);
        if (!selected || selected === quitLabel) return;
        try {
          if (selected === addLabel) { await add(ctx); continue; }
          const row = rows[labels.indexOf(selected)];
          if (!row) continue;
          const action = await ctx.ui.select(`${row.label} · ${row.api === "openai-responses" ? "Responses" : "Chat Completions"}`, [
            "切换当前模型", "重新配置模型能力", "更新密钥", "删除网关", "编辑名称和模型", "返回",
          ]);
          if (action === "编辑名称和模型") await edit(ctx, row);
          if (action === "切换当前模型") { await selectModel(ctx, row); return; }
          if (action === "重新配置模型能力") await refresh(ctx, row);
          if (action === "更新密钥") await updateKey(ctx, row);
          if (action === "删除网关") await remove(ctx, row);
        } catch (error) { showError(ctx, error); }
      }
    } catch (error) { showError(ctx, error); }
    finally { opened = false; }
  }

  for (const name of ["gateway", "网关"]) pi.registerCommand(name, { description: "管理自定义 API 网关、密钥和模型（/model 原生菜单不变）", handler: dashboard });
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return;
    if (startupError) ctx.ui.notify("部分网关配置未加载；可打开 /gateway 检查。", "warning");
    try {
      if (await store.firstRun()) ctx.ui.notify("使用 /gateway（/网关）添加 API 网关；使用 /model 选择模型。", "info");
    } catch { /* Read-only profile: do not block OMP startup. */ }
  });
}
