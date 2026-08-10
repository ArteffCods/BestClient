/**
 * The two things the client can be.
 *
 * Fight is the PvP build the launcher has always shipped: Minecraft 1.21.11, a short mod
 * list chosen for frame time, and the packs that strip visual noise out of a fight.
 * Survival is a different game on a different Minecraft - 26.1.2, a hundred mods, and the
 * resource packs that make the world look like something you want to live in.
 *
 * They are separate installations, not two settings of one. Different Minecraft versions
 * cannot share a mods folder, and a survival world has no business in a PvP instance, so
 * each profile owns its own game directory - saves, config, options and all.
 */

export type ProfileId = 'fight' | 'survival';

export interface Profile {
  id: ProfileId;
  name: string;
  /** One line, shown under the name in the picker. */
  tagline: string;
  minecraft: string;
  /** Java major the game needs. The version manifest wins over this when it says. */
  javaMajor: number;
  /** Pack definition in `resources/`. */
  packFile: string;
  /** Game directory name under `<root>/instances`. */
  folder: string;
}

export const PROFILES: Record<ProfileId, Profile> = {
  fight: {
    id: 'fight',
    name: 'Fight',
    tagline: 'PvP build - tuned for frame time',
    minecraft: '1.21.11',
    javaMajor: 21,
    packFile: 'bestclient-pack.json',
    folder: 'fight',
  },
  survival: {
    id: 'survival',
    name: 'Survival',
    tagline: 'The full world - shaders and a hundred mods',
    minecraft: '26.1.2',
    // 26.1.2 asks for Java 25. The version manifest is checked at install time and wins
    // over this, so the number here only matters if Mojang ever stops declaring one.
    javaMajor: 25,
    packFile: 'survival-pack.json',
    folder: 'survival',
  },
};

export const DEFAULT_PROFILE: ProfileId = 'fight';

export function isProfileId(value: unknown): value is ProfileId {
  return value === 'fight' || value === 'survival';
}

export function profile(id: ProfileId): Profile {
  return PROFILES[id] ?? PROFILES[DEFAULT_PROFILE];
}
