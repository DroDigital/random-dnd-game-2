import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 1024 * 1024;
const KEEP = 5;

/** Tiny rotating file logger: main.log, main.1.log ... main.4.log. */
export class Logger {
  readonly file: string;
  constructor(readonly dir: string, name = "main") {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${name}.log`);
  }

  private rotate(): void {
    try {
      if (!existsSync(this.file) || statSync(this.file).size < MAX_BYTES) return;
      const oldest = this.file.replace(/\.log$/, `.${KEEP - 1}.log`);
      if (existsSync(oldest)) unlinkSync(oldest);
      for (let i = KEEP - 2; i >= 1; i--) {
        const from = this.file.replace(/\.log$/, `.${i}.log`);
        if (existsSync(from)) renameSync(from, this.file.replace(/\.log$/, `.${i + 1}.log`));
      }
      renameSync(this.file, this.file.replace(/\.log$/, ".1.log"));
    } catch {
      /* never let logging crash the app */
    }
  }

  write(level: string, msg: string): void {
    this.rotate();
    const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
    try {
      appendFileSync(this.file, line);
    } catch {
      /* ignore */
    }
    if (level === "error") process.stderr.write(line);
  }
  info(m: string): void { this.write("info", m); }
  warn(m: string): void { this.write("warn", m); }
  error(m: string): void { this.write("error", m); }
}

/** Write a crash report next to the logs and return its path. */
export function writeCrashReport(dir: string, kind: string, detail: unknown, extra: Record<string, unknown> = {}): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `crash-${stamp}.json`);
  const err = detail instanceof Error ? { name: detail.name, message: detail.message, stack: detail.stack } : detail;
  const report = {
    kind,
    time: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    detail: err,
    ...extra,
  };
  try {
    writeFileSync(file, JSON.stringify(report, null, 2));
  } catch {
    /* ignore */
  }
  return file;
}
