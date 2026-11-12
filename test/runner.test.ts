import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Converter } from 'opencc-js';
import { runJob } from '../src/runner';
import { ConversionCancelled } from '../src/protocol';

const workerPath = path.resolve('dist/worker.js');

async function fixture(action: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chinese-conv-test-'));
  try { await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function cancellation() {
  const events = new EventEmitter();
  return {
    isCancellationRequested: false,
    onCancellationRequested(listener: () => void) {
      events.on('cancel', listener);
      return { dispose: () => events.off('cancel', listener) };
    },
    cancel() { this.isCancellationRequested = true; events.emit('cancel'); },
  };
}

test('打包后的后台线程正确转换多个选区和诗句', async () => {
  const result = await runJob({ kind: 'text', mode: 's2twp', texts: ['系统', '海内存知己天涯若比邻', '电脑内存不足'] }, { workerPath });
  assert.deepEqual(result, { kind: 'text', texts: ['系統', '海內存知己天涯若比鄰', '電腦記憶體不足'] });
});

test('磁盘转换跨 UTF-8 读块，保留 BOM、CRLF、emoji 和最后一行', async () => fixture(async directory => {
  const sourcePath = path.join(directory, 'input.txt');
  const outputPath = path.join(directory, 'output.txt');
  const input = '\ufeff' + '系统软件内存，海内存知己天涯若比邻。😀𠮷\r\n'.repeat(12_000) + '头发';
  await writeFile(sourcePath, input);
  const result = await runJob({ kind: 'file', mode: 's2twp', sourcePath, outputPath }, { workerPath });
  const expected = Converter({ from: 'cn', to: 'twp' })(input);
  assert.equal(await readFile(outputPath, 'utf8'), expected);
  assert.equal(await readFile(sourcePath, 'utf8'), input);
  assert.deepEqual(result, { kind: 'file', bytesRead: Buffer.byteLength(input), bytesWritten: Buffer.byteLength(expected) });
  assert.deepEqual((await readdir(directory)).sort(), ['input.txt', 'output.txt']);
}));

test('拒绝覆盖已存在的目标及源文件', async () => fixture(async directory => {
  const sourcePath = path.join(directory, 'input.txt');
  const outputPath = path.join(directory, 'output.txt');
  await writeFile(sourcePath, '系统');
  await writeFile(outputPath, '原有内容');
  for (const target of [outputPath, sourcePath]) {
    await assert.rejects(runJob({ kind: 'file', mode: 's2hk', sourcePath, outputPath: target }, { workerPath }), /已存在/);
  }
  assert.equal(await readFile(outputPath, 'utf8'), '原有内容');
  assert.equal(await readFile(sourcePath, 'utf8'), '系统');
}));

test('取消后终止线程、清理中间文件，并保留源文件', async () => fixture(async directory => {
  const sourcePath = path.join(directory, 'input.txt');
  const outputPath = path.join(directory, 'output.txt');
  await writeFile(sourcePath, '系统'.repeat(100_000));
  const token = cancellation();
  await assert.rejects(runJob({ kind: 'file', mode: 's2hk', sourcePath, outputPath }, {
    workerPath, cancellation: token, onProgress: () => token.cancel(),
  }), ConversionCancelled);
  await assert.rejects(access(outputPath));
  assert.deepEqual(await readdir(directory), ['input.txt']);
}));

test('转换期间出现同名目标文件也不会被覆盖', async () => fixture(async directory => {
  const sourcePath = path.join(directory, 'input.txt');
  const outputPath = path.join(directory, 'output.txt');
  await writeFile(sourcePath, '系统。'.repeat(30_000));
  let created: Promise<void> | undefined;
  await assert.rejects(runJob({ kind: 'file', mode: 's2hk', sourcePath, outputPath }, {
    workerPath,
    onProgress: () => { created ??= writeFile(outputPath, '另一进程创建的文件', { flag: 'wx' }); },
  }), /已存在/);
  await created;
  assert.equal(await readFile(outputPath, 'utf8'), '另一进程创建的文件');
  assert.deepEqual((await readdir(directory)).sort(), ['input.txt', 'output.txt']);
}));

for (const [label, content] of [
  ['非法 UTF-8', Buffer.from([0xff, 0xfe, 0x61])],
  ['不完整 UTF-8', Buffer.from([0xe4, 0xb8])],
  ['二进制 NUL', Buffer.from('系统\0')],
] as const) {
  test(`${label} 不留下转换结果或临时文件`, async () => fixture(async directory => {
    const sourcePath = path.join(directory, 'input.txt');
    const outputPath = path.join(directory, 'output.txt');
    await writeFile(sourcePath, content);
    await assert.rejects(runJob({ kind: 'file', mode: 's2hk', sourcePath, outputPath }, { workerPath }), /UTF-8|二进制/);
    assert.deepEqual(await readdir(directory), ['input.txt']);
  }));
}

test('开始前取消不创建线程或文件', async () => {
  const token = cancellation();
  token.cancel();
  await assert.rejects(runJob({ kind: 'text', mode: 's2hk', texts: ['系统'] }, { workerPath, cancellation: token }), ConversionCancelled);
});
