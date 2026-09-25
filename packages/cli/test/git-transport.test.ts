// docs/roadmap.md · docs/architecture.md §Directories: the asynchronous git
// transport under load. A few hundred git reads asked for at once go through
// the pool of CHILD_POOL children, each answer read from the file git wrote:
// every answer whole, no descriptor left open, no scratch file left behind,
// never more than CHILD_POOL children at a time, and a child that overruns
// its timeout killed.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHILD_POOL, spawnWithStdoutFile } from "../src/stdoutfile.ts";

const POSIX = process.platform !== "win32";

/** The descriptors this process holds open now. */
function openDescriptors(): number {
  return readdirSync("/dev/fd").length;
}

/** The scratch files this process's transport has left under the temporary directory. */
function leftovers(): string[] {
  return readdirSync(tmpdir()).filter(
    (n) =>
      n.startsWith(`wikiwright-stdout-${process.pid}-`) ||
      n.startsWith(`wikiwright-stdin-${process.pid}-`),
  );
}

let repo = "";
/** Each synthetic page's blob id and its bytes. */
const blobs = new Map<string, string>();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ww-git-transport-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (let i = 0; i < 60; i += 1) {
    const text = `---\ntitle: Bed ${i}\n---\n\n# Bed ${i}\n\n${"Mulch the roses in spring.\n".repeat(i * 40 + 1)}`;
    const path = join(repo, `bed-${i}.md`);
    writeFileSync(path, text);
    const blob = execFileSync("git", ["hash-object", "-w", path], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    blobs.set(blob, text);
  }
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("the git transport under concurrent load", () => {
  it("answers 300 concurrent reads whole, through the pool, leaking no descriptor and no file", async () => {
    if (!POSIX) return;
    const before = openDescriptors();
    const ids = [...blobs.keys()];
    const requests = Array.from({ length: 300 }, (_, i) => ids[i % ids.length] ?? "");
    const answers = await Promise.all(
      requests.map((blob, i) =>
        // Every third read is a batch read, its request handed over as a file.
        i % 3 === 0
          ? spawnWithStdoutFile("git", ["cat-file", "--batch"], { cwd: repo, input: `${blob}\n` })
          : spawnWithStdoutFile("git", ["cat-file", "-p", blob], { cwd: repo }),
      ),
    );
    let whole = 0;
    answers.forEach((answer, i) => {
      const blob = requests[i] ?? "";
      const text = blobs.get(blob) ?? "";
      expect(answer.error).toBeUndefined();
      expect(answer.status).toBe(0);
      const expected = i % 3 === 0 ? `${blob} blob ${Buffer.byteLength(text)}\n${text}\n` : text;
      if (answer.stdout.toString("utf8") === expected) whole += 1;
    });
    expect(whole).toBe(300);
    expect(openDescriptors()).toBe(before);
    expect(leftovers()).toEqual([]);
  }, 60_000);

  it(`never runs more than ${CHILD_POOL} children at once, and does run ${CHILD_POOL}`, async () => {
    if (!POSIX) return;
    const log = join(repo, "pool.log");
    writeFileSync(log, "");
    // Each child appends a line when it starts and one when it ends; the
    // log's running count is how many were alive together.
    const script = `echo start >> "${log}"; sleep 1; echo end >> "${log}"`;
    await Promise.all(
      Array.from({ length: CHILD_POOL * 2 }, () =>
        spawnWithStdoutFile("sh", ["-c", script], { cwd: repo }),
      ),
    );
    let alive = 0;
    let peak = 0;
    for (const line of readFileSync(log, "utf8").split("\n")) {
      if (line === "start") alive += 1;
      if (line === "end") alive -= 1;
      peak = Math.max(peak, alive);
    }
    expect(peak).toBe(CHILD_POOL);
  }, 30_000);

  it("kills a child that overruns its timeout, and the pool goes on", async () => {
    if (!POSIX) return;
    const before = openDescriptors();
    const started = performance.now();
    // The child prints its process id to its file before it sleeps.
    const r = await spawnWithStdoutFile("sh", ["-c", "echo $$; exec sleep 30"], {
      cwd: repo,
      timeout: 300,
    });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe("ETIMEDOUT");
    expect(r.status).toBeNull();
    expect(r.signal).toBe("SIGKILL");
    const pid = Number.parseInt(r.stdout.toString("utf8"), 10);
    expect(Number.isInteger(pid)).toBe(true);
    // The process is gone: signal 0 finds no such process.
    expect(() => process.kill(pid, 0)).toThrow();
    const after = await spawnWithStdoutFile("git", ["--version"], { cwd: repo });
    expect(after.status).toBe(0);
    expect(openDescriptors()).toBe(before);
    expect(leftovers()).toEqual([]);
  }, 30_000);

  it("kills a child whose stderr overruns its bound", async () => {
    if (!POSIX) return;
    const r = await spawnWithStdoutFile("sh", ["-c", "exec yes 'a warning' >&2"], { cwd: repo });
    expect((r.error as NodeJS.ErrnoException | undefined)?.code).toBe("ENOBUFS");
    expect(r.signal).toBe("SIGKILL");
    expect(leftovers()).toEqual([]);
  }, 30_000);
});
