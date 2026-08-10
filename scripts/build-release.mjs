#!/usr/bin/env node

import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(projectRoot, 'app');
const distRoot = path.join(projectRoot, 'dist');
const packageJson = JSON.parse(await readFile(path.join(appRoot, 'package.json'), 'utf8'));
const artifactName = `alv-digitaal-app-v${packageJson.version}.tgz`;
const artifactPath = path.join(distRoot, artifactName);

if (!existsSync(path.join(appRoot, 'package-lock.json'))) {
  throw new Error('app/package-lock.json ontbreekt; een reproduceerbare productie-installatie is verplicht.');
}

await mkdir(distRoot, { recursive: true });
for (const entry of await readdir(distRoot)) {
  if (/^alv-digitaal-app-v.+\.tgz$/.test(entry)) await unlink(path.join(distRoot, entry));
}

const packed = spawnSync(
  'tar',
  ['-czf', artifactPath, '-C', appRoot, 'package.json', 'package-lock.json', 'src'],
  { encoding: 'utf8', windowsHide: true }
);
if (packed.status !== 0) throw new Error(`Release-archief bouwen mislukt: ${packed.stderr}`);

const listed = spawnSync('tar', ['-tzf', artifactPath], { encoding: 'utf8', windowsHide: true });
if (listed.status !== 0) throw new Error(`Release-archief verifiëren mislukt: ${listed.stderr}`);
const entries = listed.stdout.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^\.\//, ''));
const unexpected = entries.filter((entry) =>
  entry !== 'package.json'
  && entry !== 'package-lock.json'
  && entry !== 'src/'
  && !entry.startsWith('src/')
);
if (unexpected.length > 0) throw new Error(`Onverwachte release-inhoud: ${unexpected.join(', ')}`);

console.log(`Release-artefact gebouwd: ${artifactPath}`);
console.log(`Release-inhoud: ${entries.length} code-/manifestpaden, geen runtime-data.`);
