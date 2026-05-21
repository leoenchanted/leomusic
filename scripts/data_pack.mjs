import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const paths = {
  privateJson: path.join(ROOT, 'data', 'library', 'leo_music_knowledge.json'),
  publicJson: path.join(ROOT, 'public', 'data', 'library', 'leo_music_knowledge.json'),
  privateMd: path.join(ROOT, 'data', 'library', 'leo_music_knowledge.md'),
  exportsDir: path.join(ROOT, 'data', 'exports'),
};

const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/data_pack.mjs export [--out data/exports/my-pack.json]
  node scripts/data_pack.mjs import --in data/exports/my-pack.json
  node scripts/data_pack.mjs import data/exports/my-pack.json
`);
}

function option(names) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    for (const name of names) {
      const prefix = `--${name}=`;
      if (value === `--${name}`) {
        return args[index + 1];
      }
      if (value.startsWith(prefix)) {
        return value.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function firstPositional() {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith('--')) {
      const hasInlineValue = value.includes('=');
      if (!hasInlineValue) {
        index += 1;
      }
      continue;
    }
    return value;
  }
  return undefined;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${source}: ${error.message}`);
  }
}

function validateKnowledgeBase(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object.`);
  }
  if (!Array.isArray(value.playlists)) {
    throw new Error(`${source} must contain a playlists array.`);
  }
}

function summarizeKnowledgeBase(knowledge) {
  const summary = knowledge.summary || {};
  return {
    collections: summary.collections ?? null,
    activePlaylists: summary.activePlaylists ?? knowledge.playlists.length,
    playlistsWithTracks: summary.playlistsWithTracks ?? null,
    trackPlacements: summary.trackPlacements ?? null,
    uniqueTrackKeys: summary.uniqueTrackKeys ?? null,
  };
}

async function readKnowledgeBase() {
  const candidates = [paths.privateJson, paths.publicJson];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }
    const text = await readFile(filePath, 'utf8');
    const data = parseJson(text, relative(filePath));
    validateKnowledgeBase(data, relative(filePath));
    return { data, filePath };
  }

  throw new Error(
    'No knowledge base found. Expected data/library/leo_music_knowledge.json or public/data/library/leo_music_knowledge.json.',
  );
}

async function exportPack() {
  const { data, filePath } = await readKnowledgeBase();
  const markdown = existsSync(paths.privateMd) ? await readFile(paths.privateMd, 'utf8') : undefined;
  const outPath = path.resolve(
    ROOT,
    option(['out', 'output']) ||
      path.join('data', 'exports', `leo-dj-data-pack-${timestampForFile()}.json`),
  );

  const pack = {
    kind: 'leo-dj-knowledge-pack',
    packVersion: 1,
    exportedAt: new Date().toISOString(),
    sourcePath: relative(filePath),
    summary: summarizeKnowledgeBase(data),
    files: {
      'leo_music_knowledge.json': data,
      ...(typeof markdown === 'string' ? { 'leo_music_knowledge.md': markdown } : {}),
    },
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

  console.log(`Exported knowledge pack: ${relative(outPath)}`);
  console.log(`Playlists: ${pack.summary.activePlaylists}`);
  if (pack.summary.trackPlacements !== null) {
    console.log(`Track placements: ${pack.summary.trackPlacements}`);
  }
}

async function importPack() {
  const input = option(['in', 'input']) || firstPositional();
  if (!input) {
    usage();
    throw new Error('Import requires a pack path.');
  }

  const inputPath = path.resolve(ROOT, input);
  const pack = parseJson(await readFile(inputPath, 'utf8'), input);

  if (pack?.kind !== 'leo-dj-knowledge-pack' || pack?.packVersion !== 1) {
    throw new Error('This file is not a supported LEO DJ knowledge pack.');
  }

  const knowledge = pack.files?.['leo_music_knowledge.json'];
  validateKnowledgeBase(knowledge, 'pack files.leo_music_knowledge.json');

  await mkdir(path.dirname(paths.privateJson), { recursive: true });
  await mkdir(path.dirname(paths.publicJson), { recursive: true });

  const knowledgeText = `${JSON.stringify(knowledge, null, 2)}\n`;
  await writeFile(paths.privateJson, knowledgeText, 'utf8');
  await writeFile(paths.publicJson, knowledgeText, 'utf8');

  if (typeof pack.files?.['leo_music_knowledge.md'] === 'string') {
    await writeFile(paths.privateMd, pack.files['leo_music_knowledge.md'], 'utf8');
  }

  const summary = summarizeKnowledgeBase(knowledge);
  console.log(`Imported knowledge pack: ${relative(inputPath)}`);
  console.log(`Wrote ${relative(paths.privateJson)}`);
  console.log(`Wrote ${relative(paths.publicJson)}`);
  console.log(`Playlists: ${summary.activePlaylists}`);
  if (summary.trackPlacements !== null) {
    console.log(`Track placements: ${summary.trackPlacements}`);
  }
}

try {
  if (command === 'export') {
    await exportPack();
  } else if (command === 'import') {
    await importPack();
  } else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
