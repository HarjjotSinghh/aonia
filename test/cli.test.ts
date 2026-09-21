import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fixture, tempHome, writeAuthJson } from "./helpers.js";

const CLI = join(fixture(""), "..", "..", "dist", "src", "cli.js");
const FAKE_MUSE = fixture("fake-muse");
const posixOnly = { skip: process.platform === "win32" };

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: NodeJS.ProcessEnv, stdin = ""): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe("aonia CLI", () => {
  let home = "";
  let cleanup = async () => {};
  let env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    ({ home, cleanup } = await tempHome());
    env = { AONIA_HOME: home, AONIA_MUSE: FAKE_MUSE, META_API_KEY: "" };
  });
  afterEach(() => cleanup());

  it("prints help and version", async () => {
    const help = await run(["--help"], env);
    assert.equal(help.code, 0);
    assert.ok(help.stdout.includes("aonia add <id>"));
    const version = await run(["--version"], env);
    assert.equal(version.code, 0);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);
    const bad = await run(["frobnicate"], env);
    assert.equal(bad.code, 2);
    assert.ok(bad.stderr.includes("Unknown command"));
  });

  it("add, list, rename, rm", async () => {
    assert.equal((await run(["add", "work", "--name", "Work"], env)).code, 0);
    const dup = await run(["add", "work"], env);
    assert.equal(dup.code, 1);
    assert.ok(dup.stderr.includes("already exists"));
    const bad = await run(["add", "Not Valid"], env);
    assert.equal(bad.code, 1);
    await writeAuthJson(join(home, "profiles", "work", "config"), { email: "w@example.com" });
    const list = await run(["list"], env);
    assert.equal(list.code, 0);
    assert.ok(list.stdout.includes("work"));
    assert.ok(list.stdout.includes("Work"));
    assert.ok(list.stdout.includes("w@example.com"));
    assert.equal(list.stdout.includes("SECRET"), false);
    const json = await run(["list", "--json"], env);
    const parsed = JSON.parse(json.stdout) as { id: string; name: string; identity: { email: string | null; hasLogin: boolean } }[];
    assert.equal(parsed[0]?.id, "work");
    assert.equal(parsed[0]?.identity.email, "w@example.com");
    assert.equal(json.stdout.includes("SECRET"), false);
    assert.equal((await run(["rename", "work", "Client A"], env)).code, 0);
    assert.ok((await run(["list"], env)).stdout.includes("Client A"));
    const refused = await run(["rm", "work"], env, "n\n");
    assert.equal(refused.code, 1);
    assert.ok(await stat(join(home, "profiles", "work")));
    const removed = await run(["rm", "work", "--yes"], env);
    assert.equal(removed.code, 0);
    await assert.rejects(stat(join(home, "profiles", "work")));
  });

  it("rm clears a stale index entry whose directory is already gone", async () => {
    const indexFile = join(home, "profiles.json");
    await writeFile(
      indexFile,
      JSON.stringify({
        version: 1,
        profiles: [{ id: "ghost", name: "Ghost", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null }],
        bindings: { "/some/path": "ghost" },
      }) + "\n",
    );
    const removed = await run(["rm", "ghost"], env);
    assert.equal(removed.code, 0);
    assert.ok(removed.stdout.includes("stale entry"));
    const index = JSON.parse(await readFile(indexFile, "utf8")) as { profiles: { id: string }[]; bindings: Record<string, string> };
    assert.equal(index.profiles.some((entry) => entry.id === "ghost"), false);
    assert.equal(Object.keys(index.bindings).length, 0);
    const missing = await run(["rm", "nope"], env);
    assert.equal(missing.code, 1);
    assert.ok(missing.stderr.includes("No profile named"));
  });

  it("env prints shell exports, or JSON", async () => {
    await run(["add", "work"], env);
    const shell = await run(["env", "work"], env);
    assert.equal(shell.code, 0);
    assert.ok(shell.stdout.includes(`XDG_CONFIG_HOME=`));
    assert.ok(shell.stdout.includes(join(home, "profiles", "work", "config")));
    const json = await run(["env", "work", "--json"], env);
    const parsed = JSON.parse(json.stdout) as Record<string, string>;
    assert.equal(parsed["XDG_DATA_HOME"], join(home, "profiles", "work", "data"));
    assert.equal("MUSE_AUTH_PATH" in parsed, false);
  });

  it("bind and unbind", async () => {
    await run(["add", "work"], env);
    assert.equal((await run(["bind", join(home, "code"), "work"], env)).code, 0);
    const missing = await run(["bind", join(home, "code"), "nope"], env);
    assert.equal(missing.code, 1);
    const index = JSON.parse(await readFile(join(home, "profiles.json"), "utf8")) as { bindings: Record<string, string> };
    assert.equal(Object.values(index.bindings)[0], "work");
    assert.equal((await run(["unbind", join(home, "code")], env)).code, 0);
    const again = await run(["unbind", join(home, "code")], env);
    assert.equal(again.code, 1);
  });

  it("doctor lists findings and exits 1 only on errors", async () => {
    await run(["add", "work"], env);
    const result = await run(["doctor"], { ...env, PATH: "" , AONIA_MUSE: join(home, "no-muse") });
    assert.equal(result.code, 1);
    assert.ok(result.stdout.includes("muse was not found"));
    assert.ok(result.stdout.includes("no login"));
    const ok = await run(["doctor", "--json"], env);
    assert.equal(ok.code, 0);
    const findings = JSON.parse(ok.stdout) as { code: string }[];
    assert.ok(findings.some((finding) => finding.code === "no_login"));
  });

  it("run refuses a profile without a login and points at aonia login", posixOnly, async () => {
    await run(["add", "work"], env);
    const result = await run(["run", "work"], env);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("aonia login work"));
  });

  it("run spawns muse under the profile with the profile's environment and passes through the exit code", posixOnly, async () => {
    await run(["add", "work"], env);
    await writeAuthJson(join(home, "profiles", "work", "config"));
    const result = await run(["run", "work", "--", "serve", "--disable-sandbox"], { ...env, FAKE_MUSE_MARKER: "here" });
    assert.equal(result.code, 0);
    const seen = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}") as { argv: string[]; env: Record<string, string> };
    assert.deepEqual(seen.argv, ["serve", "--disable-sandbox"]);
    assert.equal(seen.env["XDG_CONFIG_HOME"], join(home, "profiles", "work", "config"));
    assert.equal(seen.env["XDG_DATA_HOME"], join(home, "profiles", "work", "data"));
    assert.equal(seen.env["FAKE_MUSE_MARKER"], "here");
    assert.equal("MUSE_AUTH_PATH" in seen.env, false);
    if (process.platform === "darwin") {
      assert.equal(seen.env["TBH_CREDENTIAL_BACKEND"], "file");
    } else {
      assert.equal("TBH_CREDENTIAL_BACKEND" in seen.env, false);
    }
    const failing = await run(["run", "work"], { ...env, FAKE_MUSE_EXIT: "7" });
    assert.equal(failing.code, 7);
    const index = JSON.parse(await readFile(join(home, "profiles.json"), "utf8")) as { profiles: { lastUsedAt: string | null }[] };
    assert.ok(index.profiles[0]?.lastUsedAt);
  });

  it("login runs muse login under the profile even without a login yet", posixOnly, async () => {
    await run(["add", "work"], env);
    const result = await run(["login", "work"], env);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("auth.meta.com"));
    const seen = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}") as { argv: string[] };
    assert.deepEqual(seen.argv, ["login"]);
  });

  it("warns on stderr when META_API_KEY is inherited, on run and login", posixOnly, async () => {
    await run(["add", "work"], env);
    await writeAuthJson(join(home, "profiles", "work", "config"));
    const result = await run(["run", "work"], { ...env, META_API_KEY: "sk-live" });
    assert.equal(result.code, 0);
    assert.ok(result.stderr.includes("META_API_KEY"));
    assert.equal(result.stderr.includes("sk-live"), false);
  });

  it("add --seed-from-default copies settings.json and trust.json, never auth.json", async () => {
    const defaultRoot = join(home, "default-xdg");
    await writeAuthJson(defaultRoot);
    const museDir = join(defaultRoot, "muse");
    await writeFile(join(museDir, "settings.json"), '{"theme":"dark"}\n');
    await writeFile(join(museDir, "trust.json"), '{"trusted":true}\n');
    const result = await run(["add", "work", "--seed-from-default"], { ...env, XDG_CONFIG_HOME: defaultRoot });
    assert.equal(result.code, 0);
    const targetDir = join(home, "profiles", "work", "config", "muse");
    assert.equal(await readFile(join(targetDir, "settings.json"), "utf8"), '{"theme":"dark"}\n');
    assert.equal(await readFile(join(targetDir, "trust.json"), "utf8"), '{"trusted":true}\n');
    await assert.rejects(stat(join(targetDir, "auth.json")));
  });

  it("usage errors exit 2 and print the usage line", async () => {
    const cases = [["add"], ["rename", "work"], ["rm"], ["env"], ["bind", "/x"], ["unbind"], ["login"], ["run"]];
    for (const args of cases) {
      const result = await run(args, env);
      assert.equal(result.code, 2, args.join(" "));
      assert.ok(result.stderr.includes("usage:"), args.join(" "));
    }
  });

  it("--home and --muse flags override the environment", async () => {
    const altHome = join(home, "alt-home");
    const added = await run(["add", "work", "--home", altHome], env);
    assert.equal(added.code, 0);
    assert.ok(await stat(join(altHome, "profiles", "work")));
    await assert.rejects(stat(join(home, "profiles", "work")));
    const missingMuse = join(home, "no-such-muse");
    const doc = await run(["doctor", "--muse", missingMuse], env);
    assert.equal(doc.code, 1);
    assert.ok(doc.stdout.includes("muse was not found at"));
  });

  it("flags accept the --flag=value form", async () => {
    assert.equal((await run(["add", "work", "--name=Client"], env)).code, 0);
    const json = await run(["list", "--json"], env);
    const parsed = JSON.parse(json.stdout) as { name: string }[];
    assert.equal(parsed[0]?.name, "Client");
  });
});
