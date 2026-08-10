/**
 * The Minecraft versions the client can run.
 *
 * There is one mod pack - the PvP set - and it is installed on whichever version is
 * selected. A profile is therefore a version and nothing else: same mods, same packs,
 * same settings, a different game.
 *
 * They are separate installations, not one with a switch. Two Minecraft versions cannot
 * share a mods folder, and worlds saved on one have no business in another, so each owns
 * its own game directory - saves, config, options and all.
 *
 * Newest first, which is the order the picker shows.
 */

export type ProfileId = '26.2' | '26.1.2' | '1.21.11';

export interface Profile {
  /** The Minecraft version, which is also the profile's whole identity. */
  id: ProfileId;
  /**
   * The Java the launcher would rather run this on.
   *
   * A floor, not a ceiling: the version manifest says the minimum the game needs, and the
   * higher of the two wins. Newer JVMs are faster and the game's own classes are built for
   * an older release anyway, so running above the minimum is normal.
   */
  javaMajor: number;
  /** Game directory name under `<root>/instances`. */
  folder: string;
  /** Card artwork in the renderer's public folder. */
  image: string;
}

/**
 * The Java the client runs on.
 *
 * The newest long-term release, not the newest release full stop. A feature release is
 * supported for six months and the mod toolchain - Mixin, ASM, the access wideners - is
 * always behind it; an LTS is what mod authors actually build against. 26 exists and is
 * deliberately not used.
 */
const JAVA = 25;

export const PROFILE_ORDER: ProfileId[] = ['26.2', '26.1.2', '1.21.11'];

export const PROFILES: Record<ProfileId, Profile> = {
  '26.2': {
    id: '26.2',
    javaMajor: 25,
    folder: '26.2',
    image: '/profiles/mc-26.2.jpg',
  },
  '26.1.2': {
    id: '26.1.2',
    javaMajor: 25,
    folder: '26.1.2',
    image: '/profiles/mc-26.1.2.webp',
  },
  '1.21.11': {
    id: '1.21.11',
    // Its manifest asks for 21; it runs on the current LTS, which is what every version
    // here uses so there is one runtime on disk instead of two.
    javaMajor: JAVA,
    folder: '1.21.11',
    image: '/profiles/mc-1.21.11.jpg',
  },
};

/**
 * The version the client starts on.
 *
 * 1.21.11 rather than the newest: it is what bestpvp.eu runs, and it is where every
 * existing installation already is.
 */
export const DEFAULT_PROFILE: ProfileId = '1.21.11';

/** The one pack, installed on every version. */
export const PACK_FILE = 'bestclient-pack.json';

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, value);
}

export function profile(id: ProfileId): Profile {
  return PROFILES[id] ?? PROFILES[DEFAULT_PROFILE];
}
