const path = require('node:path');
const { spawnSync } = require('node:child_process');

const command = process.argv[2];

if (!command) {
    console.error('Missing docs-cli command.');
    process.exit(1);
}

const repoRoot = path.resolve(__dirname, '..');
const srcPath = path.join(repoRoot, 'src');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const result = spawnSync(pnpmBin, ['--filter', '@shapediver/docs-cli', 'run', command, srcPath], {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
