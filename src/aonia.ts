import { Bindings } from "./bindings.js";
import { doctor as runDoctor, type Finding } from "./doctor.js";
import { envFor as env } from "./env.js";
import { identityOf as identity, type Identity } from "./identity.js";
import { museCommand, type Command } from "./muse.js";
import { AoniaPaths } from "./paths.js";
import { ProfileStore, type CreateOptions, type Profile } from "./profiles.js";

export interface AoniaOptions {
  /** Where profiles live. Defaults to AONIA_HOME, then ~/.aonia. */
  home?: string;
  /** The muse executable: a bare name searched on PATH, or a path. Defaults to "muse". */
  musePath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** Bindings that refuse ids which do not exist. */
export interface AoniaBindings {
  get(path: string): Promise<string | null>;
  set(path: string, id: string): Promise<void>;
  remove(path: string): Promise<boolean>;
  list(): Promise<Record<string, string>>;
}

export interface Aonia {
  readonly paths: AoniaPaths;
  readonly musePath: string;
  readonly platform: NodeJS.Platform;
  listProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile>;
  createProfile(id: string, options?: CreateOptions): Promise<Profile>;
  removeProfile(id: string): Promise<void>;
  renameProfile(id: string, name: string): Promise<void>;
  touch(id: string): Promise<void>;
  envFor(profile: Profile): Record<string, string>;
  identityOf(profile: Profile): Promise<Identity>;
  loginCommand(profile: Profile): Command;
  runCommand(profile: Profile, args: string[]): Command;
  readonly bindings: AoniaBindings;
  doctor(): Promise<Finding[]>;
}

export function createAonia(options: AoniaOptions = {}): Aonia {
  const processEnv = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const musePath = options.musePath ?? "muse";
  const paths = AoniaPaths.resolve(options.home, processEnv);
  const store = new ProfileStore(paths, processEnv, options.now);
  const raw = new Bindings(paths, platform);
  const bindings: AoniaBindings = {
    get: (path) => raw.get(path),
    set: async (path, id) => {
      await store.get(id);
      await raw.set(path, id);
    },
    remove: (path) => raw.remove(path),
    list: () => raw.list(),
  };
  return {
    paths,
    musePath,
    platform,
    listProfiles: () => store.list(),
    getProfile: (id) => store.get(id),
    createProfile: (id, createOptions) => store.create(id, createOptions),
    removeProfile: (id) => store.remove(id),
    renameProfile: (id, name) => store.rename(id, name),
    touch: (id) => store.touch(id),
    envFor: (profile) => env(profile, platform),
    identityOf: (profile) => identity(profile),
    loginCommand: (profile) => museCommand(musePath, profile, ["login"], platform),
    runCommand: (profile, args) => museCommand(musePath, profile, args, platform),
    bindings,
    doctor: () => runDoctor({ paths, store, env: processEnv, platform, musePath }),
  };
}
