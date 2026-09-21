import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A throwaway AONIA_HOME. Every test gets its own; cleanup removes it. */
export async function tempHome(): Promise<{ home: string; cleanup: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "aonia-test-"));
  return { home, cleanup: () => rm(home, { recursive: true, force: true }) };
}

/**
 * Writes a Muse auth.json into a config root. The token here is fake and must never surface in any
 * aonia return value; tests grep for it.
 */
export async function writeAuthJson(
  configRoot: string,
  fields: { email?: string; name?: string; token?: string; mechanism?: string } = {},
): Promise<string> {
  const dir = join(configRoot, "muse");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "auth.json");
  const body = {
    schema_version: 1,
    providers: {
      meta: {
        mechanism: fields.mechanism ?? "oauth",
        obtained_via: "device_code",
        api_base_url: "https://api.meta.ai/v1",
        access_token: fields.token ?? "SECRET-TOKEN-DO-NOT-LEAK",
        api_key: "SECRET-KEY-DO-NOT-LEAK",
        user_email: fields.email ?? "person@example.com",
        user_full_name: fields.name ?? "Test Person",
      },
    },
  };
  await writeFile(file, JSON.stringify(body, null, 2), { mode: 0o600 });
  return file;
}

/** Absolute path of a file under test/fixtures, valid from both src and dist. */
export function fixture(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled tests live in dist/test; fixtures stay in test/fixtures.
  const root = here.endsWith(join("dist", "test")) ? join(here, "..", "..") : join(here, "..");
  return join(root, "test", "fixtures", name);
}
