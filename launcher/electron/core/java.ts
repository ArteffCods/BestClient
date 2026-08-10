import AdmZip from 'adm-zip';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { TARGET } from './brand';
import { log } from './logger';
import { downloadFile, fetchJson, type ProgressFn } from './net';
import { dirs, exists } from './paths';

const execFileAsync = promisify(execFile);

interface AdoptiumBinary {
  binary: {
    package: {
      link: string;
      name: string;
      checksum: string;
      size: number;
    };
  };
  release_name: string;
}

/**
 * Returns the path of a `javaw.exe` of the given major version.
 *
 * The major is asked for rather than fixed, because the profiles run different Minecraft
 * versions and the version manifest is what says which Java each one needs. Prefers the
 * runtime the launcher manages itself, falls back to a matching system install, and
 * downloads a Temurin JRE as a last resort.
 */
export async function ensureJava(major: number, onProgress?: ProgressFn): Promise<string> {
  const managed = await findManagedJava(major);

  if (managed) {
    log.info(`Using managed Java runtime: ${managed}`);
    return managed;
  }

  const system = await findSystemJava(major);

  if (system) {
    log.info(`Using system Java runtime: ${system}`);
    return system;
  }

  return downloadJava(major, onProgress);
}

async function findManagedJava(major: number): Promise<string | null> {
  const base = dirs().java;

  if (!(await exists(base))) return null;

  const entries = await fs.promises.readdir(base, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const candidate = path.join(base, entry.name, 'bin', 'javaw.exe');

    if ((await exists(candidate)) && (await probeMajorVersion(candidate)) === major) {
      return candidate;
    }
  }

  return null;
}

async function findSystemJava(major: number): Promise<string | null> {
  const candidates: string[] = [];

  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'javaw.exe'));
  }

  // Common Windows install roots for Adoptium / Microsoft / Oracle builds.
  const roots = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Zulu',
  ];

  for (const root of roots) {
    if (!(await exists(root))) continue;

    const entries = await fs.promises.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(path.join(root, entry.name, 'bin', 'javaw.exe'));
      }
    }
  }

  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;

    if ((await probeMajorVersion(candidate)) === major) {
      return candidate;
    }
  }

  return null;
}

/** Runs `java -version` and parses the major version out of it. */
async function probeMajorVersion(javawPath: string): Promise<number | null> {
  const javaExe = path.join(path.dirname(javawPath), 'java.exe');
  const exe = (await exists(javaExe)) ? javaExe : javawPath;

  try {
    // `java -version` writes to stderr on every JDK vendor.
    const { stderr, stdout } = await execFileAsync(exe, ['-version'], { timeout: 10_000 });
    const output = `${stderr}${stdout}`;
    const match = output.match(/version "(\d+)(?:\.(\d+))?/);

    if (!match) return null;

    const first = Number(match[1]);
    // Java 8 reports `1.8.0_xxx`, everything since reports the major directly.
    return first === 1 ? Number(match[2]) : first;
  } catch {
    return null;
  }
}

async function downloadJava(major: number, onProgress?: ProgressFn): Promise<string> {
  const url =
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot` +
    '?architecture=x64&image_type=jre&os=windows&vendor=eclipse';

  const assets = await fetchJson<AdoptiumBinary[]>(url);
  const asset = assets[0];

  if (!asset) {
    throw new Error(`Adoptium has no Java ${major} Windows x64 JRE available.`);
  }

  const pkg = asset.binary.package;
  const archive = path.join(dirs().java, pkg.name);

  onProgress?.({ done: 0, total: 1, bytes: 0, label: `Downloading Java ${major}` });

  let bytes = 0;
  await downloadFile({ url: pkg.link, dest: archive, size: pkg.size }, (delta) => {
    bytes += delta;
    onProgress?.({ done: 0, total: 1, bytes, label: `Downloading Java ${major}` });
  });

  onProgress?.({ done: 0, total: 1, bytes, label: `Extracting Java ${major}` });

  const zip = new AdmZip(archive);
  zip.extractAllTo(dirs().java, true);
  await fs.promises.rm(archive, { force: true });

  const installed = await findManagedJava(major);

  if (!installed) {
    throw new Error(`Java ${major} was extracted but no javaw.exe was found inside it.`);
  }

  onProgress?.({ done: 1, total: 1, bytes, label: `Java ${major} ready` });
  log.info(`Installed managed Java runtime: ${asset.release_name}`);

  return installed;
}

