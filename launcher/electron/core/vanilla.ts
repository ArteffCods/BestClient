import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

import { log } from './logger';
import { downloadAll, downloadFile, fetchJson, type DownloadTask, type ProgressFn } from './net';
import { dirs, exists } from './paths';

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ASSET_CDN = 'https://resources.download.minecraft.net';

export interface MojangArtifact {
  path?: string;
  sha1: string;
  size: number;
  url: string;
}

export interface Rule {
  action: 'allow' | 'disallow';
  os?: { name?: string; version?: string; arch?: string };
  features?: Record<string, boolean>;
}

export interface MojangLibrary {
  name: string;
  downloads?: {
    artifact?: MojangArtifact;
    classifiers?: Record<string, MojangArtifact>;
  };
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: { exclude?: string[] };
  /** Fabric-style entry: only a Maven base URL, the path is derived from `name`. */
  url?: string;
  sha1?: string;
  size?: number;
}

export type LaunchArgument = string | { rules?: Rule[]; value: string | string[] };

export interface VersionJson {
  id: string;
  mainClass: string;
  assets?: string;
  inheritsFrom?: string;
  minecraftArguments?: string;
  assetIndex?: { id: string; sha1: string; size: number; totalSize: number; url: string };
  downloads?: { client?: MojangArtifact };
  libraries: MojangLibrary[];
  arguments?: { game?: LaunchArgument[]; jvm?: LaunchArgument[] };
  javaVersion?: { component: string; majorVersion: number };
}

interface ManifestEntry {
  id: string;
  type: string;
  url: string;
  sha1: string;
}

interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}

/** Downloads (and caches) the version JSON for a vanilla Minecraft release. */
export async function resolveVanilla(versionId: string): Promise<VersionJson> {
  const target = path.join(dirs().versions, versionId, `${versionId}.json`);

  if (await exists(target)) {
    return JSON.parse(await fs.promises.readFile(target, 'utf8')) as VersionJson;
  }

  const manifest = await fetchJson<{ versions: ManifestEntry[] }>(VERSION_MANIFEST);
  const entry = manifest.versions.find((candidate) => candidate.id === versionId);

  if (!entry) {
    throw new Error(`Minecraft ${versionId} is not in Mojang's version manifest.`);
  }

  const json = await fetchJson<VersionJson>(entry.url);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, JSON.stringify(json, null, 2), 'utf8');

  return json;
}

export function isAllowed(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true;

  let allowed = false;

  for (const rule of rules) {
    if (!ruleMatches(rule, features)) continue;
    allowed = rule.action === 'allow';
  }

  return allowed;
}

function ruleMatches(rule: Rule, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== currentOsName()) return false;
    if (rule.os.arch && rule.os.arch !== process.arch) return false;
  }

  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== expected) return false;
    }
  }

  return true;
}

function currentOsName(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

/** Converts a Maven coordinate (`group:artifact:version[:classifier][@ext]`) to a repo-relative path. */
export function mavenToPath(coordinate: string): string {
  const [main, extension = 'jar'] = coordinate.split('@');
  const [group, artifact, version, classifier] = main.split(':');

  if (!group || !artifact || !version) {
    throw new Error(`Malformed Maven coordinate: ${coordinate}`);
  }

  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`;

  return [...group.split('.'), artifact, version, fileName].join('/');
}

/** True for the separate `:natives-windows` style jars that only carry DLLs. */
export function isNativeLibrary(library: MojangLibrary): boolean {
  return /:natives-/.test(library.name) || library.natives !== undefined;
}

function nativeArtifact(library: MojangLibrary): MojangArtifact | undefined {
  if (library.natives) {
    const classifier = library.natives[currentOsName()]?.replace('${arch}', process.arch === 'x64' ? '64' : '32');
    if (classifier) return library.downloads?.classifiers?.[classifier];
  }

  return library.downloads?.artifact;
}

export interface ResolvedLibraries {
  /** Absolute jar paths that belong on the classpath. */
  classpath: string[];
  /** Absolute jar paths whose contents must be unpacked into the natives directory. */
  nativeJars: string[];
  tasks: DownloadTask[];
}

export function resolveLibraries(versions: VersionJson[]): ResolvedLibraries {
  const classpath: string[] = [];
  const nativeJars: string[] = [];
  const tasks: DownloadTask[] = [];
  const seen = new Set<string>();

  for (const version of versions) {
    for (const library of version.libraries) {
      if (!isAllowed(library.rules)) continue;

      const native = isNativeLibrary(library);
      const artifact = native ? nativeArtifact(library) : library.downloads?.artifact;
      const relative = artifact?.path ?? mavenToPath(library.name);

      if (seen.has(relative)) continue;
      seen.add(relative);

      const dest = path.join(dirs().libraries, ...relative.split('/'));

      if (artifact?.url) {
        tasks.push({ url: artifact.url, dest, sha1: artifact.sha1, size: artifact.size });
      } else if (library.url) {
        // Fabric meta entries: only a Maven base URL is given.
        tasks.push({
          url: `${library.url.replace(/\/$/, '')}/${relative}`,
          dest,
          sha1: library.sha1,
          size: library.size,
        });
      } else {
        log.warn(`Library ${library.name} has no download URL, skipping.`);
        continue;
      }

      if (native) {
        nativeJars.push(dest);
      } else {
        classpath.push(dest);
      }
    }
  }

  return { classpath, nativeJars, tasks };
}

export async function installClientJar(version: VersionJson, onProgress?: ProgressFn): Promise<string> {
  const client = version.downloads?.client;

  if (!client) {
    throw new Error(`Version ${version.id} has no client download.`);
  }

  const dest = path.join(dirs().versions, version.id, `${version.id}.jar`);

  onProgress?.({ done: 0, total: 1, bytes: 0, label: 'Minecraft kliens letöltése' });
  await downloadFile({ url: client.url, dest, sha1: client.sha1, size: client.size });
  onProgress?.({ done: 1, total: 1, bytes: client.size, label: 'Minecraft kliens kész' });

  return dest;
}

export async function installAssets(version: VersionJson, onProgress?: ProgressFn): Promise<void> {
  const index = version.assetIndex;

  if (!index) {
    log.warn(`Version ${version.id} has no asset index.`);
    return;
  }

  const indexFile = path.join(dirs().assetIndexes, `${index.id}.json`);
  await downloadFile({ url: index.url, dest: indexFile, sha1: index.sha1, size: index.size });

  const parsed = JSON.parse(await fs.promises.readFile(indexFile, 'utf8')) as AssetIndex;

  const tasks: DownloadTask[] = Object.values(parsed.objects).map((object) => {
    const prefix = object.hash.slice(0, 2);

    return {
      url: `${ASSET_CDN}/${prefix}/${object.hash}`,
      dest: path.join(dirs().assetObjects, prefix, object.hash),
      sha1: object.hash,
      size: object.size,
    };
  });

  await downloadAll(tasks, 'Játék assetek', onProgress, 16);
}

/** Unpacks every native jar into `natives/<versionId>` so the JVM can load the DLLs. */
export async function extractNatives(versionId: string, nativeJars: string[]): Promise<string> {
  const target = path.join(dirs().natives, versionId);
  await fs.promises.mkdir(target, { recursive: true });

  for (const jar of nativeJars) {
    const zip = new AdmZip(jar);

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;

      const name = path.basename(entry.entryName);

      // Only the actual libraries matter; META-INF and checksums are noise.
      if (!/\.(dll|so|dylib)$/i.test(name)) continue;

      const dest = path.join(target, name);

      if (await exists(dest)) continue;

      await fs.promises.writeFile(dest, entry.getData());
    }
  }

  return target;
}
