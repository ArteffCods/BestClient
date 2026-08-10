/**
 * Copies the Fight profile's content into the Survival profile.
 *
 * Survival always wins: a mod slug or a pack file name it already has is left exactly as
 * it is. Only what Fight adds on top is copied in, which is what makes this safe to run
 * again after either pack changes.
 *
 * Fight is built for Minecraft 1.21.11 and Survival for 26.1.2, so a fair number of
 * Fight's mods have no build for Survival's version. Those are still listed - they belong
 * to the profile - but switched off, so the install does not spend a launch reporting a
 * wall of mods it could not resolve. The moment an author publishes a 26.1.2 build, the
 * mod is one switch away in the Mods list.
 *
 *   node scripts/merge-fight-into-survival.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fightFile = path.join(root, 'launcher', 'resources', 'bestclient-pack.json');
const survivalFile = path.join(root, 'launcher', 'resources', 'survival-pack.json');

const UA = { 'User-Agent': 'BestClient pack importer (bestpvp.eu)' };

const fight = JSON.parse(await fs.promises.readFile(fightFile, 'utf8'));
const survival = JSON.parse(await fs.promises.readFile(survivalFile, 'utf8'));

/** Does this project publish anything for Survival's Minecraft version on Fabric? */
async function supportsTarget(slug) {
  const url =
    `https://api.modrinth.com/v2/project/${encodeURIComponent(slug)}/version` +
    `?loaders=${encodeURIComponent('["fabric"]')}` +
    `&game_versions=${encodeURIComponent(JSON.stringify([survival.minecraft]))}`;

  try {
    const response = await fetch(url, { headers: UA });
    if (!response.ok) return false;

    return (await response.json()).length > 0;
  } catch {
    return false;
  }
}

const ownSlugs = new Set(survival.mods.map((mod) => mod.slug));
const addedMods = [];
const disabled = [];

for (const mod of fight.mods) {
  if (ownSlugs.has(mod.slug)) continue;

  const available = await supportsTarget(mod.slug);

  if (!available) disabled.push(mod.slug);

  addedMods.push({
    ...mod,
    // Nothing from Fight is locked in Survival: the survival build has its own core set.
    locked: false,
    defaultEnabled: available && mod.defaultEnabled,
  });
}

survival.mods = [...survival.mods, ...addedMods];

function mergeContent(key) {
  const own = survival[key] ?? [];
  const names = new Set(own.map((entry) => entry.fileName));
  const added = (fight[key] ?? []).filter((entry) => !names.has(entry.fileName));

  // Fight's packs go under Survival's: options.txt reads the list lowest priority first,
  // and Survival's own look is what should win where the two touch the same texture.
  survival[key] = [...added, ...own];

  return added.length;
}

const addedPacks = mergeContent('resourcePacks');
const addedShaders = mergeContent('shaders');

await fs.promises.writeFile(survivalFile, `${JSON.stringify(survival, null, 2)}\n`, 'utf8');

console.log(`mods added:           ${addedMods.length} (${addedMods.length - disabled.length} enabled, ${disabled.length} off - no ${survival.minecraft} build)`);
console.log(`resource packs added: ${addedPacks}`);
console.log(`shaders added:        ${addedShaders}`);
console.log(`survival totals:      ${survival.mods.length} mods, ${survival.resourcePacks.length} packs, ${survival.shaders.length} shaders`);

if (disabled.length) {
  console.log(`\nswitched off (no ${survival.minecraft} build): ${disabled.join(', ')}`);
}
