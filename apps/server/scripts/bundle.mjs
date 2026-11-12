// Bundles the server for the desktop app: one ESM file plus the native/WASM packages it loads at runtime.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const repo = resolve(serverDir, '../..');
const tauriDir = join(repo, 'apps/desktop/src-tauri');
const out = join(tauriDir, 'resources/server');
const EXTERNAL = ['better-sqlite3', 'quickjs-emscripten'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(serverDir, 'src/main.ts')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...EXTERNAL, '@jitl/*', 'quickjs-emscripten-core'],
  banner: { js: "import { createRequire as __pgRequire } from 'node:module'; const require = __pgRequire(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});
cpSync(join(serverDir, 'drizzle'), join(out, 'drizzle'), { recursive: true });

/** Copies a package and its runtime dependencies, following pnpm's symlinked layout. */
const copied = new Set();
function copyPackage(name, fromDir) {
  if (copied.has(name)) return;
  let link = join(fromDir, 'node_modules', name);
  for (let dir = fromDir; !existsSync(link) && dir !== dirname(dir); dir = dirname(dir)) link = join(dirname(dir), 'node_modules', name);
  if (!existsSync(link)) throw new Error(`Cannot find ${name} from ${fromDir}`);
  const real = realpathSync(link);
  copied.add(name);
  const dest = join(out, 'node_modules', name);
  cpSync(real, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => !/[\\/](deps|src|docs|test|\.github)$/.test(src.slice(real.length)) && !/\.(md|map|d\.ts|d\.mts)$/.test(src),
  });
  const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
  const siblings = name.startsWith('@') ? dirname(dirname(real)) : dirname(real);
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep, siblings.replace(/[\\/]node_modules$/, ''));
}
copyPackage('better-sqlite3', serverDir);
copyPackage('quickjs-emscripten', join(repo, 'packages/core'));
writeFileSync(join(out, 'package.json'), JSON.stringify({ name: 'postguy-server', private: true, type: 'module' }, null, 2));

// Ship Node as the Tauri sidecar. A Node linked against shared libraries (e.g. Homebrew's)
// is not portable, so the official build of the same version is downloaded and verified.
function selfContained(binary) {
  if (process.platform !== 'darwin') return process.platform === 'win32' || !/libnode/.test(execSync(`ldd "${binary}" || true`).toString());
  return !/libnode|\/opt\/homebrew\/|\/usr\/local\/opt\//.test(execSync(`otool -L "${binary}"`).toString());
}

async function officialNode() {
  const version = process.version;
  const os = { darwin: 'darwin', linux: 'linux' }[process.platform];
  if (!os) throw new Error(`Unsupported platform ${process.platform}; install the official Node.js build`);
  const name = `node-${version}-${os}-${process.arch}`;
  const cache = join(tauriDir, '.node-cache');
  const binary = join(cache, name, 'bin', 'node');
  if (existsSync(binary)) return binary;
  mkdirSync(cache, { recursive: true });
  const base = `https://nodejs.org/dist/${version}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${name}.tar.gz`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`No checksum published for ${name}.tar.gz`);
  console.log(`downloading ${base}/${name}.tar.gz`);
  const res = await fetch(`${base}/${name}.tar.gz`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}.tar.gz`);
  const archive = join(cache, `${name}.tar.gz`);
  writeFileSync(archive, data);
  execSync(`tar -xzf "${archive}" -C "${cache}" "${name}/bin/node"`);
  rmSync(archive);
  return binary;
}

const triple = execSync('rustc -vV').toString().match(/host: (\S+)/)[1];
const binDir = join(tauriDir, 'binaries');
mkdirSync(binDir, { recursive: true });
const ext = process.platform === 'win32' ? '.exe' : '';
const bin = join(binDir, `node-${triple}${ext}`);
const source = selfContained(process.execPath) ? process.execPath : await officialNode();
copyFileSync(source, bin);
chmodSync(bin, 0o755);

console.log(`server bundle → ${out}\nnode sidecar → ${bin} (Node ${process.version} from ${source})`);
