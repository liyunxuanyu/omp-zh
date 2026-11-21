import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GatewayError, idPattern, parseGateway, type Gateway } from "./gateway-core.ts";

const metadataPattern = /^offlinekit-gw-[a-f0-9]{32}\.json$/;
function code(error: unknown) { return (error as NodeJS.ErrnoException)?.code; }

export class GatewayStore {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }

  async load(): Promise<{ rows: Gateway[]; invalid: number }> {
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) { if (code(error) === "ENOENT") return { rows: [], invalid: 0 }; throw error; }
    const rows: Gateway[] = [];
    let invalid = 0;
    for (const name of names.sort()) {
      if (!metadataPattern.test(name)) continue;
      try {
        const row = await this.read(name.slice(0, -5));
        if (row) rows.push(row);
      } catch { invalid++; }
    }
    return { rows, invalid };
  }

  async read(id: string): Promise<Gateway | undefined> {
    const file = this.file(id);
    try {
      const text = await readFile(file, "utf8");
      const row = parseGateway(JSON.parse(text));
      if (row.id !== id) throw new GatewayError("网关配置 ID 不匹配，未修改。");
      return row;
    } catch (error) { if (code(error) === "ENOENT") return undefined; throw error; }
  }

  // Never hold a lock while waiting for a dialog or network. An abandoned lock is never stolen.
  async write<T>(id: string, expected: Gateway | undefined, action: () => Promise<T>): Promise<T> {
    const lock = `${this.file(id)}.lock`;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let handle;
    try { handle = await open(lock, "wx", 0o600); }
    catch (error) {
      if (code(error) === "EEXIST") throw new GatewayError("该网关正在被其他进程修改，或上次操作异常退出；请稍后重试。");
      throw error;
    }
    try {
      if (JSON.stringify(await this.read(id)) !== JSON.stringify(expected)) {
        throw new GatewayError("另一 OMP 窗口已修改此网关。请重新打开面板后再试。");
      }
      return await action();
    } finally {
      try { await handle.close(); } finally { await rm(lock, { force: true }); }
    }
  }

  async save(gateway: Gateway) {
    const file = this.file(gateway.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    // Explicit whitelist: even an accidentally augmented object cannot serialize credentials.
    const row = parseGateway(gateway);
    try {
      await writeFile(temporary, JSON.stringify(row) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  }

  async remove(id: string) { await rm(this.file(id)); }

  async firstRun() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(join(this.directory, "hint-seen.v1"), "", { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if (code(error) === "EEXIST") return false;
      throw error;
    }
  }

  private file(id: string) {
    if (!idPattern.test(id)) throw new GatewayError("网关 ID 无效。");
    return join(this.directory, `${id}.json`);
  }
}
