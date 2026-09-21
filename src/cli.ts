#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import { createAonia, type Aonia } from "./aonia.js";
import { AoniaError } from "./errors.js";
import { findMuse } from "./muse.js";

const HELP = `aonia: named profiles for the Muse Code CLI

usage:
  aonia add <id> [--name <label>] [--seed-from-default]
  aonia login <id>
  aonia list [--json]
  aonia run <id> [-- <muse arguments>]
  aonia bind <path> <id>
  aonia unbind <path>
  aonia env <id> [--json]
  aonia doctor [--json]
  aonia rename <id> <label>
  aonia rm <id> [--yes]

global options:
  --muse <path>   the muse executable (default: muse on PATH, or $AONIA_MUSE)
  --home <dir>    where profiles live (default: $AONIA_HOME, or ~/.aonia)
  --version, --help

A profile id is a lowercase slug (letters, digits, dashes, up to 32 characters) and is also the
name of its directory under the aonia home.
`;

interface Parsed {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
  passthrough: string[];
}

/** Hand rolled: flags anywhere before "--", positionals in order, everything after "--" untouched. */
export function parseArgv(argv: string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  let passthrough: string[] = [];
  const valued = new Set(["--muse", "--home", "--name"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--") {
      passthrough = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        flags.set(arg.slice(0, eq), arg.slice(eq + 1));
      } else if (valued.has(arg)) {
        i += 1;
        flags.set(arg, argv[i] ?? "");
      } else {
        flags.set(arg, true);
      }
      continue;
    }
    positional.push(arg);
  }
  return { command: positional[0], positional: positional.slice(1), flags, passthrough };
}

/** Thrown instead of calling process.exit, so piped stdout and stderr always flush before we leave. */
class CliExit extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "CliExit";
  }
}

function fail(message: string, code = 1): never {
  throw new CliExit(code, message);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function spawnMuse(command: { command: string; args: string[]; env: Record<string, string> }): Promise<number> {
  return new Promise((resolve, reject) => {
    const useShell = /\.(cmd|bat)$/i.test(command.command);
    const child = spawn(command.command, command.args, {
      stdio: "inherit",
      env: { ...process.env, ...command.env },
      shell: useShell,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function warnIfApiKey(): void {
  const key = process.env["META_API_KEY"];
  if (typeof key === "string" && key.length > 0) {
    process.stderr.write("aonia: META_API_KEY is set in this environment; Muse will use it instead of this profile's login.\n");
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) {
    return "never";
  }
  return iso.replace("T", " ").slice(0, 16);
}

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n") + "\n";
}

async function resolveMuse(aonia: Aonia): Promise<string> {
  const found = await findMuse(aonia.musePath, process.env, aonia.platform);
  if (!found) {
    fail(aonia.musePath === "muse" ? "muse was not found on PATH. Install Muse Code or pass --muse <path>." : `muse was not found at ${aonia.musePath}.`);
  }
  return found;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  if (parsed.flags.has("--version")) {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version: string };
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (parsed.flags.has("--help") || parsed.command === undefined || parsed.command === "help") {
    process.stdout.write(HELP);
    return parsed.command === undefined && !parsed.flags.has("--help") ? 2 : 0;
  }
  const home = parsed.flags.get("--home");
  const museFlag = parsed.flags.get("--muse");
  const aonia = createAonia({
    ...(typeof home === "string" && home.length > 0 ? { home } : {}),
    musePath: typeof museFlag === "string" && museFlag.length > 0 ? museFlag : process.env["AONIA_MUSE"] || "muse",
  });
  const json = parsed.flags.get("--json") === true;
  const [first, second] = parsed.positional;

  switch (parsed.command) {
    case "add": {
      if (!first) {
        fail("usage: aonia add <id> [--name <label>] [--seed-from-default]", 2);
      }
      const name = parsed.flags.get("--name");
      const profile = await aonia.createProfile(first, {
        ...(typeof name === "string" && name.length > 0 ? { name } : {}),
        seedFromDefault: parsed.flags.get("--seed-from-default") === true,
      });
      process.stdout.write(`Created profile "${profile.id}" at ${aonia.paths.profileDir(profile.id)}\nNext: aonia login ${profile.id}\n`);
      return 0;
    }
    case "list": {
      const profiles = await aonia.listProfiles();
      const rows = await Promise.all(profiles.map(async (profile) => ({ ...profile, identity: await aonia.identityOf(profile) })));
      if (json) {
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
        return 0;
      }
      if (rows.length === 0) {
        process.stdout.write("No profiles yet. Create one with: aonia add <id>\n");
        return 0;
      }
      process.stdout.write(
        table([
          ["ID", "NAME", "LOGIN", "LAST USED"],
          ...rows.map((row) => [row.id, row.name, row.identity.hasLogin ? (row.identity.email ?? "logged in") : "(not logged in)", formatWhen(row.lastUsedAt)]),
        ]),
      );
      return 0;
    }
    case "rename": {
      if (!first || !second) {
        fail("usage: aonia rename <id> <label>", 2);
      }
      await aonia.renameProfile(first, second);
      return 0;
    }
    case "rm": {
      if (!first) {
        fail("usage: aonia rm <id> [--yes]", 2);
      }
      const profile = await aonia.getProfile(first);
      if (parsed.flags.get("--yes") !== true) {
        const ok = await confirm(`Remove profile "${profile.id}" and everything under ${aonia.paths.profileDir(profile.id)}? The login inside it is lost.`);
        if (!ok) {
          fail("not removed");
        }
      }
      await aonia.removeProfile(profile.id);
      process.stdout.write(`Removed profile "${profile.id}". Muse's own login under ~/.config/muse was not touched.\n`);
      return 0;
    }
    case "env": {
      if (!first) {
        fail("usage: aonia env <id> [--json]", 2);
      }
      const env = aonia.envFor(await aonia.getProfile(first));
      if (json) {
        process.stdout.write(JSON.stringify(env, null, 2) + "\n");
        return 0;
      }
      for (const [key, value] of Object.entries(env)) {
        process.stdout.write(aonia.platform === "win32" ? `$env:${key}='${value}'\n` : `export ${key}='${value.replace(/'/g, "'\\''")}'\n`);
      }
      return 0;
    }
    case "bind": {
      if (!first || !second) {
        fail("usage: aonia bind <path> <id>", 2);
      }
      await aonia.bindings.set(first, second);
      process.stdout.write(`${first} now uses profile "${second}"\n`);
      return 0;
    }
    case "unbind": {
      if (!first) {
        fail("usage: aonia unbind <path>", 2);
      }
      if (!(await aonia.bindings.remove(first))) {
        fail(`${first} was not bound to any profile`);
      }
      return 0;
    }
    case "doctor": {
      const findings = await aonia.doctor();
      if (json) {
        process.stdout.write(JSON.stringify(findings, null, 2) + "\n");
      } else if (findings.length === 0) {
        process.stdout.write("All clear.\n");
      } else {
        for (const finding of findings) {
          process.stdout.write(`${finding.level.padEnd(5)} ${finding.message}\n`);
        }
      }
      return findings.some((finding) => finding.level === "error") ? 1 : 0;
    }
    case "login": {
      if (!first) {
        fail("usage: aonia login <id>", 2);
      }
      const profile = await aonia.getProfile(first);
      const muse = await resolveMuse(aonia);
      warnIfApiKey();
      const code = await spawnMuse({ ...aonia.loginCommand(profile), command: muse });
      if (code === 0) {
        await aonia.touch(profile.id);
      }
      return code;
    }
    case "run": {
      if (!first) {
        fail("usage: aonia run <id> [-- <muse arguments>]", 2);
      }
      const profile = await aonia.getProfile(first);
      const args = parsed.passthrough.length > 0 ? parsed.passthrough : parsed.positional.slice(1);
      const identity = await aonia.identityOf(profile);
      if (!identity.hasLogin && args[0] !== "login") {
        fail(`profile "${profile.id}" has no login. Run: aonia login ${profile.id}`);
      }
      const muse = await resolveMuse(aonia);
      warnIfApiKey();
      await aonia.touch(profile.id);
      return spawnMuse({ ...aonia.runCommand(profile, args), command: muse });
    }
    default:
      fail(`Unknown command "${parsed.command}". Run: aonia --help`, 2);
  }
}

// No process.exit anywhere: on macOS a piped stderr is asynchronous, and exiting early would drop
// the very message a failing command is trying to show. Setting exitCode lets Node drain and leave.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`aonia: ${message}\n`);
    process.exitCode = error instanceof CliExit ? error.code : error instanceof AoniaError ? 1 : 1;
  },
);
