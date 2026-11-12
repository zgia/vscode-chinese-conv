import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { runJob } from '../src/runner';
import { createTextConverter } from '../src/converter';

async function main(): Promise<void> {
  const targetMiB = Number(process.argv[2] ?? 100);
  if (!Number.isFinite(targetMiB) || targetMiB <= 0) throw new Error('请输入正数，单位 MiB。');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chinese-conv-benchmark-'));
  const sourcePath = path.join(directory, 'source.txt');
  const outputPath = path.join(directory, 'output.txt');
  const line = '系统里面的软件、鼠标和网络。电脑内存不足。海内存知己，天涯若比邻。😀\r\n';
  const batch = line.repeat(3000);
  const expectedBatch = createTextConverter('s2twp')(batch);
  const expectedHash = createHash('sha256');
  let batches = 0;
  try {
    const source = await open(sourcePath, 'wx');
    try {
      while (batches * Buffer.byteLength(batch) < targetMiB * 1024 * 1024) {
        await source.writeFile(batch);
        expectedHash.update(expectedBatch);
        batches++;
      }
    } finally { await source.close(); }
  
    const start = performance.now();
    const result = await runJob({ kind: 'file', mode: 's2twp', sourcePath, outputPath }, {
      workerPath: path.resolve('dist/worker.js'),
    });
    const seconds = (performance.now() - start) / 1000;
    const actualHash = createHash('sha256');
    for await (const chunk of createReadStream(outputPath)) actualHash.update(chunk);
    if (actualHash.digest('hex') !== expectedHash.digest('hex')) throw new Error('转换内容校验失败');
    const sourceSize = (await stat(sourcePath)).size / 1024 / 1024;
    console.log(JSON.stringify({ inputMiB: +sourceSize.toFixed(1), seconds: +seconds.toFixed(2), MiBPerSecond: +(sourceSize / seconds).toFixed(1), verified: true, result }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
