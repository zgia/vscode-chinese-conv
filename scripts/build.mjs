import { context, build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/licenses', { recursive: true });
for (const [source, target] of [
  ['node_modules/opencc-js/LICENSE', 'dist/licenses/OpenCC-JS-LICENSE'],
  ['node_modules/opencc-js/THIRD_PARTY_LICENSES.md', 'dist/licenses/OpenCC-JS-THIRD-PARTY.md'],
  ['node_modules/opencc-js/LICENSES/Apache-2.0.txt', 'dist/licenses/Apache-2.0.txt'],
]) await copyFile(source, target);

const development = process.argv.includes('--watch') || process.argv.includes('--development');
const options = {
  entryPoints: ['src/extension.ts', 'src/worker.ts'],
  outdir: 'dist', bundle: true, platform: 'node', format: 'cjs',
  target: 'node18', external: ['vscode'], sourcemap: development,
  minify: !development, legalComments: 'eof', logLevel: 'info',
};
if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
