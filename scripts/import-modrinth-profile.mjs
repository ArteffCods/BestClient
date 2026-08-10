/**
 * Builds a BestClient pack file out of a Modrinth App profile.
 *
 * Every jar, resource pack and shader in the profile is hashed and looked up on Modrinth,
 * which turns a folder of files into something the launcher can install and verify on its
 * own: mods by slug, packs and shaders pinned to the exact version the profile is using.
 *
 * Anything Modrinth does not know is reported and left out - the launcher blocks jars it
 * cannot trace to Modrinth, so a pack that listed them would simply refuse to launch.
 *
 *   node scripts/import-modrinth-profile.mjs "<profile folder>" <output.json> <minecraft>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [, , profileDir, outFile, minecraft] = process.argv;

if (!profileDir || !outFile || !minecraft) {
  console.error('usage: import-modrinth-profile.mjs "<profile folder>" <output.json> <minecraft>');
  process.exit(1);
}

const UA = { 'User-Agent': 'BestClient pack importer (bestpvp.eu)' };
const JSON_UA = { ...UA, 'Content-Type': 'application/json' };

async function hashFolder(folder, extension) {
  const out = [];

  let names;
  try {
    names = await fs.promises.readdir(folder);
  } catch {
    return out;
  }

  for (const name of names) {
    if (!name.toLowerCase().endsWith(extension)) continue;

    const file = path.join(folder, name);
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) continue;

    const hash = crypto.createHash('sha1');
    hash.update(await fs.promises.readFile(file));
    out.push({ name, sha1: hash.digest('hex') });
  }

  return out;
}

/** Modrinth takes up to a hundred hashes per call. */
async function lookupVersions(entries) {
  const found = new Map();

  for (let i = 0; i < entries.length; i += 100) {
    const slice = entries.slice(i, i + 100);
    const response = await fetch('https://api.modrinth.com/v2/version_files', {
      method: 'POST',
      headers: JSON_UA,
      body: JSON.stringify({ hashes: slice.map((entry) => entry.sha1), algorithm: 'sha1' }),
    });

    if (!response.ok) throw new Error(`version_files: HTTP ${response.status}`);

    for (const [sha1, version] of Object.entries(await response.json())) {
      found.set(sha1, version);
    }
  }

  return found;
}

async function lookupProjects(ids) {
  const projects = new Map();

  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const url = `https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(slice))}`;
    const response = await fetch(url, { headers: UA });

    if (!response.ok) throw new Error(`projects: HTTP ${response.status}`);

    for (const project of await response.json()) projects.set(project.id, project);
  }

  return projects;
}

/** Modrinth's own categories, mapped onto the four the launcher's Mods list shows. */
function category(project) {
  const tags = new Set(project.categories ?? []);

  if (tags.has('library')) return 'library';
  if (tags.has('optimization')) return 'performance';
  return 'pvp';
}

function note(project) {
  const text = (project.description ?? '').trim();
  if (text.length <= 70) return text;

  const cut = text.slice(0, 70);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
}

const mods = await hashFolder(path.join(profileDir, 'mods'), '.jar');
const resourcePacks = await hashFolder(path.join(profileDir, 'resourcepacks'), '.zip');
const shaders = await hashFolder(path.join(profileDir, 'shaderpacks'), '.zip');

const modVersions = await lookupVersions(mods);
const packVersions = await lookupVersions(resourcePacks);
const shaderVersions = await lookupVersions(shaders);

const projects = await lookupProjects([
  ...new Set([...modVersions.values()].map((version) => version.project_id)),
]);

const skipped = [];

const packMods = mods
  .map((entry) => {
    const version = modVersions.get(entry.sha1);

    if (!version) {
      skipped.push(`mod ${entry.name}`);
      return null;
    }

    const project = projects.get(version.project_id);

    if (!project) {
      skipped.push(`mod ${entry.name} (project missing)`);
      return null;
    }

    return {
      slug: project.slug,
      name: project.title,
      category: category(project),
      locked: false,
      defaultEnabled: true,
      note: note(project),
      iconUrl: project.icon_url ?? undefined,
    };
  })
  .filter(Boolean);

/**
 * Only the packs the profile actually has switched on, in the order options.txt lists
 * them - the folder holds every pack ever downloaded, and load order is what makes a
 * stack of resource packs look right.
 */
async function activeResourcePacks() {
  let options;

  try {
    options = await fs.promises.readFile(path.join(profileDir, 'options.txt'), 'utf8');
  } catch {
    return resourcePacks.map((entry) => entry.name);
  }

  const line = options.split(/\r?\n/).find((row) => row.startsWith('resourcePacks:'));
  if (!line) return resourcePacks.map((entry) => entry.name);

  let listed;
  try {
    listed = JSON.parse(line.slice('resourcePacks:'.length));
  } catch {
    return resourcePacks.map((entry) => entry.name);
  }

  return listed
    .filter((value) => typeof value === 'string' && value.startsWith('file/'))
    .map((value) => value.slice('file/'.length));
}

const activeNames = await activeResourcePacks();

function content(entries, versions, order) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const names = order ?? entries.map((entry) => entry.name);
  const out = [];

  for (const name of names) {
    const entry = byName.get(name);

    if (!entry) {
      skipped.push(`pack ${name} (not in the folder)`);
      continue;
    }

    const version = versions.get(entry.sha1);

    if (!version) {
      skipped.push(`pack ${name} (not on Modrinth)`);
      continue;
    }

    const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];

    out.push({
      slug: version.project_id,
      name: name.replace(/\.zip$/i, ''),
      versionId: version.id,
      fileName: file.filename,
      sha1: file.hashes.sha1,
    });
  }

  return out;
}

const pack = {
  minecraft,
  loader: 'fabric',
  loaderVersion: '0.19.3',
  mods: packMods,
  resourcePacks: content(resourcePacks, packVersions, activeNames),
  shaders: content(shaders, shaderVersions),
};

pack.selectedShader = pack.shaders[0]?.fileName;

await fs.promises.writeFile(outFile, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

console.log(`mods:           ${packMods.length}/${mods.length}`);
console.log(`resource packs: ${pack.resourcePacks.length}/${activeNames.length} active`);
console.log(`shaders:        ${pack.shaders.length}/${shaders.length}`);

if (skipped.length) {
  console.log(`\nleft out (${skipped.length}):`);
  for (const item of skipped) console.log(`  - ${item}`);
}

console.log(`\nwritten to ${outFile}`);
