import type { Profile } from "./profiles.js";

/**
 * The whole mechanism. Two variables select the account on every platform; on macOS a third keeps
 * the profile's token in its own auth.json instead of the one shared Keychain item. Callers spread
 * this over process.env; it is not a complete environment.
 */
export function envFor(profile: Profile, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const env: Record<string, string> = {
    XDG_CONFIG_HOME: profile.roots.config,
    XDG_DATA_HOME: profile.roots.data,
  };
  if (platform === "darwin") {
    env["TBH_CREDENTIAL_BACKEND"] = "file";
  }
  return env;
}
