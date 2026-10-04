// Publish a test build to the web (BACKLOG 13.28): `npm run deploy`.
//
// Builds, adds the server's .htaccess files and a build label, then streams
// dist/ over SSH as one tar archive (one passphrase prompt). On the server it
// unpacks into a staging folder first, and only then replaces the document
// root's contents, so a dropped connection never leaves a half-empty site.
// The certificate renewal's .well-known folder is kept.
//
// Settings come from deploy/deploy.env.local (ignored by git); see
// deploy/deploy.env.example.

import { spawn, spawnSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENV_FILE = 'deploy/deploy.env.local';

function fail(message) {
  console.error(`deploy: ${message}`);
  process.exit(1);
}

function readEnv(path) {
  if (!existsSync(path)) fail(`no ${path}. Copy deploy/deploy.env.example to it and fill it in.`);
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = readEnv(ENV_FILE);
const host = env.DEPLOY_HOST;
const user = env.DEPLOY_USER;
const port = env.DEPLOY_PORT || '22';
const target = env.DEPLOY_PATH;
const key = env.DEPLOY_KEY ? env.DEPLOY_KEY.replace(/^~(?=[\\/])/, homedir()) : null;

if (!host || !user || !target) fail(`${ENV_FILE} needs DEPLOY_HOST, DEPLOY_USER and DEPLOY_PATH.`);
if (!/^[\w.-]+$/.test(host) || !/^[\w.-]+$/.test(user) || !/^\d+$/.test(port)) fail('host, user or port has unexpected characters.');
// Everything in the target is replaced, so insist on a plain folder inside the
// home folder: never the home folder itself, and never the main site.
if (!/^\/home\/[\w.-]+\/[\w.-]+$/.test(target)) fail(`DEPLOY_PATH must look like /home/<user>/<folder>; got "${target}".`);
if (/\/(public_html|\.ssh|\.acme\.sh|\.+)$/.test(target)) fail(`refusing to replace ${target}.`);
if (key && !existsSync(key)) fail(`no key at ${key}.`);

// 1. Build.
const dirty = execSync('git status --porcelain --untracked-files=no').toString().trim() !== '';
if (dirty) console.warn('deploy: uncommitted changes; the build label will show a +.');
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
if (build.status !== 0) fail('the build failed.');

// 2. Server files and the build label.
copyFileSync('deploy/.htaccess', join('dist', '.htaccess'));
copyFileSync('deploy/assets.htaccess', join('dist', 'assets', '.htaccess'));
const html = readFileSync(join('dist', 'index.html'), 'utf8');
const label = execSync('git log -1 --format="%h %cd" --date=short').toString().trim() + (dirty ? ' +uncommitted' : '');
writeFileSync(join('dist', 'build.txt'), `${label}\n`);
if (!html.includes('<script')) fail('dist/index.html looks wrong.');

// 3. Ship it. Remote steps, one shell line (no quotes in the validated path).
const staging = `${target}.incoming`;
const remote = [
  'set -e',
  `test -d '${target}' || { echo 'no such folder: ${target}' >&2; exit 1; }`,
  `rm -rf '${staging}'`,
  `mkdir '${staging}'`,
  `tar -xzf - -C '${staging}' --no-same-owner`,
  `test -f '${staging}/index.html'`,
  `find '${target}' -mindepth 1 -maxdepth 1 ! -name .well-known -exec rm -rf {} +`,
  `cp -a '${staging}'/. '${target}'/`,
  `rm -rf '${staging}'`,
  `echo "deployed: $(cat '${target}/build.txt')"`,
].join('; ');

const sshArgs = ['-p', port, ...(key ? ['-i', key] : []), `${user}@${host}`, remote];
console.log(`deploy: sending dist/ to ${user}@${host}:${target}`);
const tar = spawn('tar', ['-czf', '-', '-C', 'dist', '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
const ssh = spawn('ssh', sshArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
tar.stdout.pipe(ssh.stdin);
tar.on('close', code => { if (code !== 0) { ssh.kill(); fail(`tar exited with ${code}.`); } });
ssh.on('close', code => {
  if (code !== 0) fail(`ssh exited with ${code}; the site was not changed unless it says "deployed".`);
  console.log(`deploy: done. https://${target.split('/').pop()}/`);
});
