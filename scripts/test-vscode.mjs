import { build } from 'esbuild';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

await build({ entryPoints: ['test/vscode/suite.ts'], outfile: 'out/vscode-tests.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], target: 'node18' });
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'chinese-conv-vscode-'));
await mkdir(path.join(temporaryDirectory, 'profile', 'User'), { recursive: true });
await writeFile(path.join(temporaryDirectory, 'profile', 'User', 'settings.json'), JSON.stringify({
  'chat.disableAIFeatures': true,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoUpdate': false,
}));
const macBinaryDirectory = '/Applications/Visual Studio Code.app/Contents/MacOS';
const executable = process.env.VSCODE_EXECUTABLE ?? (process.platform === 'darwin'
  ? path.join(macBinaryDirectory, existsSync(path.join(macBinaryDirectory, 'Code')) ? 'Code' : 'Electron') : 'code');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, [
      `--extensionDevelopmentPath=${process.cwd()}`,
      `--extensionTestsPath=${path.resolve('out/vscode-tests.cjs')}`,
      `--user-data-dir=${path.join(temporaryDirectory, 'profile')}`,
      `--extensions-dir=${path.join(temporaryDirectory, 'extensions')}`,
      '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust',
    ], { stdio: 'inherit', env: environment });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`VS Code 测试失败（退出码 ${code}）`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
