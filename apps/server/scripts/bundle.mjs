// Bundles the server for the desktop app: one ESM file plus the native/WASM packages it loads at runtime.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// The Claude (MCP) bridge; Claude Code runs it with the bundled Node.
copyFileSync(join(serverDir, 'bin', 'postguy-mcp.mjs'), join(out, 'postguy-mcp.mjs'));

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

// The platform being packaged: Tauri sets TAURI_ENV_TARGET_TRIPLE for --target builds.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || execSync('rustc -vV').toString().match(/host: (\S+)/)[1];
const target = {
  os: triple.includes('apple-darwin') ? 'darwin' : triple.includes('windows') ? 'win' : triple.includes('linux') ? 'linux' : null,
  arch: triple.startsWith('aarch64') ? 'arm64' : triple.startsWith('x86_64') ? 'x64' : null,
};
if (!target.os || !target.arch) throw new Error(`Unsupported target ${triple}`);
const nodeOs = { darwin: 'darwin', win: 'win32', linux: 'linux' }[target.os];

// Keep only the SQLite binding for the target; the others are dead weight (and unsigned Mach-O on macOS).
const prebuilds = join(out, 'node_modules/better-sqlite3/prebuilds');
for (const f of readdirSync(prebuilds)) if (f !== `${nodeOs}-${target.arch}.node`) rmSync(join(prebuilds, f));
if (!existsSync(join(prebuilds, `${nodeOs}-${target.arch}.node`))) throw new Error(`better-sqlite3 has no prebuilt binding for ${nodeOs}-${target.arch}`);

// Ship Node as the Tauri sidecar. The running Node is reused when it targets the same platform
// and is self-contained; otherwise (e.g. Homebrew's shared-library build, or a cross-arch build)
// the official build of the same version is downloaded and checked against nodejs.org's checksums.
function selfContained(binary) {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !/libnode/.test(execSync(`ldd "${binary}" || true`).toString());
  return !/libnode|\/opt\/homebrew\/|\/usr\/local\/opt\//.test(execSync(`otool -L "${binary}"`).toString());
}

async function officialNode() {
  const version = process.version;
  const name = `node-${version}-${target.os}-${target.arch}`;
  const file = target.os === 'win' ? `${name}.zip` : `${name}.tar.gz`;
  const inner = target.os === 'win' ? `${name}/node.exe` : `${name}/bin/node`;
  const cache = join(tauriDir, '.node-cache');
  const binary = join(cache, inner);
  if (existsSync(binary)) return binary;
  mkdirSync(cache, { recursive: true });
  const base = `https://nodejs.org/dist/${version}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`No checksum published for ${file}`);
  console.log(`downloading ${base}/${file}`);
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Checksum mismatch for ${file}`);
  const archive = join(cache, file);
  writeFileSync(archive, data);
  execSync(`tar -xf "${archive}" -C "${cache}" "${inner}"`);
  rmSync(archive);
  return binary;
}

const binDir = join(tauriDir, 'binaries');
rmSync(binDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
const ext = target.os === 'win' ? '.exe' : '';
const bin = join(binDir, `node-${triple}${ext}`);
const sameTarget = process.platform === nodeOs && process.arch === target.arch;
const source = sameTarget && selfContained(process.execPath) ? process.execPath : await officialNode();
copyFileSync(source, bin);
chmodSync(bin, 0o755);

// macOS: sign every Mach-O we ship with the hardened runtime so notarization accepts the app.
// Node needs JIT; native modules need library validation relaxed (see Entitlements.plist).
const identity = process.env.APPLE_SIGNING_IDENTITY;
if (target.os === 'darwin' && identity && process.platform === 'darwin') {
  const entitlements = join(tauriDir, 'Entitlements.plist');
  const timestamp = identity === '-' ? '' : '--timestamp';
  const sign = (file, withEntitlements) =>
    execSync(`codesign --force --options runtime ${timestamp} ${withEntitlements ? `--entitlements "${entitlements}"` : ''} --sign "${identity}" "${file}"`, { stdio: 'inherit' });
  for (const f of readdirSync(prebuilds)) sign(join(prebuilds, f), false);
  sign(bin, true);
  console.log(`signed node sidecar and native modules with ${identity === '-' ? 'an ad-hoc signature' : 'the configured identity'}`);
}

console.log(`server bundle → ${out}\nnode sidecar → ${bin} (Node ${process.version} for ${triple} from ${source})`);
