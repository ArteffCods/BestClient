/**
 * Single source of truth for the BestClient identity.
 * The same two colours are mirrored in `src/app/globals.css` as CSS custom properties.
 */
export const BRAND = {
  name: 'BestClient',
  /** #ff75c3 - strong accent: primary buttons, active states, progress fill. */
  primary: '#ff75c3',
  /** #ffb8e0 - soft accent: headings, secondary text, borders. */
  secondary: '#ffb8e0',
} as const;

/** The pinned server. The launcher rewrites this entry into servers.dat before every launch. */
export const LOCKED_SERVER = {
  name: 'BestPvP.eu',
  address: 'bestpvp.eu',
} as const;

/** Seeded once on the first launch, but the player is free to delete this one. */
export const SUGGESTED_SERVER = {
  name: 'BestPvP.hu',
  address: 'bestpvp.hu',
} as const;

export const TARGET = {
  minecraft: '1.21.11',
  fabricLoader: '0.19.3',
  /** Minecraft 1.21.11 is the last release that runs on Java 21. */
  javaMajor: 21,
} as const;
