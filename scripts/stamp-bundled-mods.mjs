/**
 * Copies the built BestClient mod into the launcher's resources and stamps its SHA-1
 * into `bundled-mods.json`.
 *
 * That hash is the launcher's only authority for its own mods: they are not on Modrinth,
 * so the pre-launch integrity check trusts them because this file says to. Run this after
 * every `mod/gradlew build`, before packaging the launcher.
 *
 *   node scripts/stamp-bundled-mods.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtDir = path.join(root, 'mod', 'build', 'libs');
const targetDir = path.join(root, 'launcher', 'resources', 'mods');
const manifestFile = path.join(root, 'launcher', 'resources', 'bundled-mods.json');

const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

if (!fs.existsSync(builtDir)) {
  console.error(`No build output at ${builtDir}. Run "gradlew build" in mod/ first.`);
  process.exit(1);
}

// Loom writes several jars; the production one has no classifier.
const jars = fs
  .readdirSync(builtDir)
  .filter((name) => name.endsWith('.jar'))
  .filter((name) => !/-(sources|dev|sources-dev)\.jar$/.test(name));

if (jars.length === 0) {
  console.error(`No production jar in ${builtDir}.`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

// Old builds must not linger: two versions of the same mod would both load.
for (const stale of fs.readdirSync(targetDir).filter((name) => name.endsWith('.jar'))) {
  fs.rmSync(path.join(targetDir, stale));
}

const entries = jars.map((name) => {
  const dest = path.join(targetDir, name);
  fs.copyFileSync(path.join(builtDir, name), dest);

  return {
    id: 'bestclient',
    name: 'BestClient',
    note: 'Ships with the client · Right Shift opens the menu',
    fileName: name,
    sha1: sha1(dest),
  };
});

fs.writeFileSync(manifestFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');

for (const entry of entries) {
  console.log(`stamped ${entry.fileName}  sha1=${entry.sha1}`);
}
