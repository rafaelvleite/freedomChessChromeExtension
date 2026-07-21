import { spawnSync } from 'node:child_process';
import { readFile, mkdir, copyFile, chmod, rm, rename, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIRECTORY = path.join(ROOT_DIRECTORY, 'dist');
const EXTENSION_DIRECTORY = path.join(DIST_DIRECTORY, 'extension');
const RELEASE_DIRECTORY = path.join(DIST_DIRECTORY, 'release');
const FIXED_TIMESTAMP = new Date('2000-01-01T00:00:00.000Z');

const EXTENSION_FILES = Object.freeze([
  'manifest.json',
  'background.js',
  'builtFunctions/mainWorldBridge.js',
  'builtFunctions/core.js',
  'builtFunctions/freedomChessApp.js',
  'styles/main.css',
  'images/freedomChess16.png',
  'images/freedomChess128.png',
]);

const JAVASCRIPT_FILES = Object.freeze([
  'background.js',
  'builtFunctions/mainWorldBridge.js',
  'builtFunctions/core.js',
  'builtFunctions/freedomChessApp.js',
  'scripts/build-extension.mjs',
]);

function assertNarrowOutput(target) {
  const relative = path.relative(DIST_DIRECTORY, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Recusa em remover um alvo amplo: ${target}`);
  }
}

async function removeOutput(target, options = {}) {
  assertNarrowOutput(target);
  await rm(target, { force: true, ...options });
}

async function readJson(relativePath) {
  const source = await readFile(path.join(ROOT_DIRECTORY, relativePath), 'utf8');
  return JSON.parse(source);
}

async function validateProject() {
  const [manifest, packageJson] = await Promise.all([
    readJson('manifest.json'),
    readJson('package.json'),
  ]);

  if (manifest.manifest_version !== 3) {
    throw new Error('manifest.json precisa usar Manifest V3.');
  }

  if (manifest.version !== packageJson.version) {
    throw new Error('As versões de manifest.json e package.json precisam ser iguais.');
  }

  if (manifest.web_accessible_resources || manifest.content_security_policy) {
    throw new Error('O manifesto não deve expor recursos web nem sobrescrever a CSP.');
  }

  const prohibitedScripts = /(?:jquery|sweetalert|annyang)/i;
  const manifestSource = JSON.stringify(manifest);
  if (prohibitedScripts.test(manifestSource)) {
    throw new Error('O manifesto ainda referencia uma biblioteca removida.');
  }

  const referencedFiles = new Set([
    manifest.background?.service_worker,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ].filter(Boolean));
  for (const contentScript of manifest.content_scripts || []) {
    for (const relativePath of [...(contentScript.js || []), ...(contentScript.css || [])]) {
      referencedFiles.add(relativePath);
    }
  }

  for (const relativePath of referencedFiles) {
    if (!EXTENSION_FILES.includes(relativePath)) {
      throw new Error(`O recurso do manifesto não está no pacote: ${relativePath}`);
    }
  }

  await Promise.all(
    EXTENSION_FILES.map((relativePath) => readFile(path.join(ROOT_DIRECTORY, relativePath))),
  );

  for (const relativePath of JAVASCRIPT_FILES) {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT_DIRECTORY, relativePath)], {
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || '').trim();
      throw new Error(`Falha de sintaxe em ${relativePath}${details ? `:\n${details}` : '.'}`);
    }
  }

  return manifest;
}

async function copyDeterministic(relativePath, destinationRoot) {
  const source = path.join(ROOT_DIRECTORY, relativePath);
  const destination = path.join(destinationRoot, ...relativePath.split('/'));

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o644);
  await utimes(destination, FIXED_TIMESTAMP, FIXED_TIMESTAMP);
}

async function buildExtension() {
  await validateProject();
  await mkdir(DIST_DIRECTORY, { recursive: true });

  const stagingDirectory = path.join(DIST_DIRECTORY, `.extension-${process.pid}.tmp`);
  await removeOutput(stagingDirectory, { recursive: true });
  await mkdir(stagingDirectory, { recursive: true });

  try {
    for (const relativePath of EXTENSION_FILES) {
      await copyDeterministic(relativePath, stagingDirectory);
    }

    await removeOutput(EXTENSION_DIRECTORY, { recursive: true });
    await rename(stagingDirectory, EXTENSION_DIRECTORY);
  } finally {
    await removeOutput(stagingDirectory, { recursive: true });
  }

  process.stdout.write(`Extensão criada em ${path.relative(ROOT_DIRECTORY, EXTENSION_DIRECTORY)}\n`);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buffer) {
  let checksum = 0xffffffff;
  for (const byte of buffer) {
    checksum = CRC_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function localHeader(name, contents, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x2821, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(contents.length, 18);
  header.writeUInt32LE(contents.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(name, contents, checksum, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x2821, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(contents.length, 20);
  header.writeUInt32LE(contents.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(fileCount, 8);
  footer.writeUInt16LE(fileCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

async function createZip() {
  const manifest = await readJson('manifest.json');
  const packageName = `freedom-chess-${manifest.version}.zip`;
  const packagePath = path.join(RELEASE_DIRECTORY, packageName);
  const temporaryPath = path.join(RELEASE_DIRECTORY, `.${packageName}.${process.pid}.tmp`);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const relativePath of [...EXTENSION_FILES].sort()) {
    const name = Buffer.from(relativePath, 'utf8');
    const contents = await readFile(path.join(EXTENSION_DIRECTORY, ...relativePath.split('/')));
    const checksum = crc32(contents);
    const header = localHeader(name, contents, checksum);

    localParts.push(header, name, contents);
    centralParts.push(centralHeader(name, contents, checksum, offset), name);
    offset += header.length + name.length + contents.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const archive = Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory(EXTENSION_FILES.length, centralDirectory.length, offset),
  ]);

  await mkdir(RELEASE_DIRECTORY, { recursive: true });
  await removeOutput(temporaryPath);

  try {
    await writeFile(temporaryPath, archive, { mode: 0o644 });
    await removeOutput(packagePath);
    await rename(temporaryPath, packagePath);
  } finally {
    await removeOutput(temporaryPath);
  }

  process.stdout.write(`Pacote criado em ${path.relative(ROOT_DIRECTORY, packagePath)}\n`);
}

async function main() {
  const command = process.argv[2] || 'build';

  switch (command) {
    case 'check':
      await validateProject();
      process.stdout.write('Manifesto, arquivos e sintaxe validados.\n');
      break;
    case 'build':
      await buildExtension();
      break;
    case 'package':
      await buildExtension();
      await createZip();
      break;
    default:
      throw new Error(`Comando desconhecido: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${errorMessageForCli(error)}\n`);
  process.exitCode = 1;
});

function errorMessageForCli(error) {
  return error instanceof Error ? error.message : String(error);
}
