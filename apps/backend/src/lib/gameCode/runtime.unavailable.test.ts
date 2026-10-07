// What the host does when the sandbox itself is the problem — a worker that
// will not start, or one that dies under a job. The worker thread is replaced
// with a scripted fake, because the real one (after the stack sizing in
// limits.ts) no longer has a known way to fall over on demand.

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SandboxRequest, SandboxResponse } from "./types.js";

type Behaviour = "fails to start" | "dies on its first job" | "healthy";

// Hoisted with the mocks below, so it can't lean on any import.
const fake = vi.hoisted(() => {
  type Listener = (payload: unknown) => void;
  const script: string[] = [];
  const started: FakeWorker[] = [];

  class FakeWorker {
    readonly behaviour: string;
    jobs = 0;
    terminated = false;
    private readonly listeners = new Map<string, Listener[]>();

    constructor() {
      this.behaviour = script.shift() ?? "healthy";
      started.push(this);
      setImmediate(() => {
        if (this.behaviour === "fails to start") this.emit("error", new Error("worker blew up"));
        else this.reply({ type: "ready", warmUpMs: 0 });
      });
    }

    on(event: string, listener: Listener): this {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    emit(event: string, payload: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }

    private reply(message: unknown): void {
      if (!this.terminated) this.emit("message", message);
    }

    postMessage(request: { id: number }): void {
      this.jobs += 1;
      setImmediate(() => {
        if (this.behaviour === "dies on its first job") {
          // What sandboxWorker.ts does when the WASM module traps: answer, then exit.
          this.reply({
            type: "result",
            id: request.id,
            result: { kind: "failed", reason: "sandbox_unavailable", detail: "trap" },
          });
          setTimeout(() => this.emit("exit", 1), 15);
          return;
        }
        this.reply({ type: "result", id: request.id, result: { kind: "score", value: 42 } });
      });
    }

    unref(): void {}

    terminate(): Promise<number> {
      this.terminated = true;
      return Promise.resolve(0);
    }
  }

  return { script, started, FakeWorker };
});

vi.mock("node:worker_threads", () => ({ Worker: fake.FakeWorker }));
vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runParse, shutdownGameCodeSandbox, validateCode } from "./runtime.js";

const { started } = fake;
const script = fake.script as Behaviour[];
// The fake speaks the real protocol; these keep it honest if the types move.
const _protocol: [SandboxRequest["id"], SandboxResponse["type"]] = [1, "ready"];
void _protocol;

const code = "function parse(raw) { return 42; }";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterEach(async () => {
  await shutdownGameCodeSandbox();
  script.length = 0;
  started.length = 0;
});

describe("a worker that fails to start", () => {
  it("makes a run fail soft as sandbox_unavailable, and the next run tries a fresh worker", async () => {
    script.push("fails to start");
    expect(await runParse(code, "x")).toMatchObject({
      kind: "failed",
      reason: "sandbox_unavailable",
    });
    expect(await runParse(code, "x")).toEqual({ kind: "score", value: 42 });
    expect(started).toHaveLength(2);
  });

  it("validateCode says the sandbox was unavailable — not that the code is wrong", async () => {
    script.push("fails to start");
    const report = await validateCode({ parse: code }, [
      { raw: "a", expected: 42 },
      { raw: "b", expected: 42 },
    ]);
    // No mismatch is invented for an example nothing could run.
    expect(report).toEqual({ ok: false, unavailable: true, checked: 0, mismatches: [] });
  });

  it("validateCode reports unavailable for the no-examples load check too", async () => {
    script.push("fails to start");
    expect(await validateCode({ parse: code }, [])).toEqual({
      ok: false,
      unavailable: true,
      checked: 0,
      mismatches: [],
    });
  });

  it("the same code validates once the sandbox is back", async () => {
    script.push("fails to start");
    expect((await validateCode({ parse: code }, [{ raw: "a", expected: 42 }])).unavailable).toBe(
      true,
    );
    expect(await validateCode({ parse: code }, [{ raw: "a", expected: 42 }])).toEqual({
      ok: true,
      unavailable: false,
      checked: 1,
      mismatches: [],
    });
  });
});

describe("a worker that dies under a job", () => {
  it("fails that job only: the next one goes to a new worker, not the dying one", async () => {
    script.push("dies on its first job");
    const first = runParse(code, "x");
    // Queued behind the doomed job, before the old thread's exit is seen.
    const second = runParse(code, "y");
    expect(await first).toMatchObject({ kind: "failed", reason: "sandbox_unavailable" });
    expect(await second).toEqual({ kind: "score", value: 42 });
    expect(started).toHaveLength(2);
    expect(started[0]?.jobs).toBe(1);
    expect(started[0]?.terminated).toBe(true);

    // The old worker's late `exit` must not take the new worker with it.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(await runParse(code, "z")).toEqual({ kind: "score", value: 42 });
    expect(started).toHaveLength(2);
  });

  it("validateCode tells a real mismatch from a run the sandbox could not do", async () => {
    // A genuine mismatch is still reported as one while the sandbox is up…
    script.push("healthy");
    const first = await validateCode({ parse: code }, [{ raw: "a", expected: 7 }]);
    expect(first).toMatchObject({ ok: false, unavailable: false, checked: 1 });
    expect(first.mismatches).toHaveLength(1);

    // …and a run the sandbox could not do is reported as unavailable, with no
    // mismatch made up for it or for the examples after it.
    await shutdownGameCodeSandbox();
    script.push("dies on its first job");
    const second = await validateCode({ parse: code }, [
      { raw: "a", expected: 42 },
      { raw: "b", expected: 42 },
    ]);
    expect(second).toEqual({ ok: false, unavailable: true, checked: 0, mismatches: [] });
  });
});
