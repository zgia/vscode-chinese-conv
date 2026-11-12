import { parentPort, workerData } from 'node:worker_threads';
import * as fs from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createStreamingConverter, createTextConverter } from './converter';
import { type WorkerJob, type WorkerMessage } from './protocol';

function send(message: WorkerMessage) { parentPort!.postMessage(message); }

async function main(job: WorkerJob) {
  send({ type: 'progress', progress: { message: '正在加载地区词库…' } });
  if (job.kind === 'text') {
    const texts: string[] = [];
    for (let i = 0; i < job.texts.length; i++) {
      send({ type: 'progress', progress: { message: `正在转换文本 ${i + 1}/${job.texts.length}…` } });
      texts.push(createTextConverter(job.mode)(job.texts[i]));
    }
    send({ type: 'result', result: { kind: 'text', texts } });
    return;
  }

  const sourceStat = await stat(job.sourcePath);
  if (!sourceStat.isFile()) throw new Error('请选择普通文本文件。');
  const converter = createStreamingConverter(job.mode);
  // Fatal decoding refuses GBK/Big5/binary input instead of silently corrupting it.
  // ignoreBOM preserves an existing UTF-8 BOM as U+FEFF in the output.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const source = fs.createReadStream(job.sourcePath, { highWaterMark: 256 * 1024 });
  const output = await open(job.targetPath, 'wx');
  let bytesRead = 0;
  let bytesWritten = 0;
  let lastReport = 0;
  async function write(text: string) {
    if (!text) return;
    // writeFile on an open handle writes at the current file position.
    await output.writeFile(text, 'utf8');
    bytesWritten += Buffer.byteLength(text, 'utf8');
  }
  try {
    for await (const chunk of source) {
      const bytes = chunk as Buffer;
      bytesRead += bytes.length;
      let text: string;
      try { text = decoder.decode(bytes, { stream: true }); }
      catch { throw new Error('文件不是有效的 UTF-8 文本。请先用正确编码打开，再另存为 UTF-8。'); }
      if (text.includes('\0')) throw new Error('文件包含二进制内容（NUL 字符），已停止转换。');
      await write(converter.write(text));
      if (Date.now() - lastReport > 150) {
        send({ type: 'progress', progress: {
          message: `已读取 ${(bytesRead / 1024 / 1024).toFixed(1)} MB`,
          percent: sourceStat.size ? Math.min(99, bytesRead / sourceStat.size * 100) : 99,
        } });
        lastReport = Date.now();
      }
    }
    let tail: string;
    try { tail = decoder.decode(); }
    catch { throw new Error('UTF-8 文件末尾存在不完整字符，已停止转换。'); }
    await write(converter.write(tail) + converter.end());
    await output.sync();
    const after = await stat(job.sourcePath);
    if (after.size !== sourceStat.size || after.mtimeMs !== sourceStat.mtimeMs || after.ino !== sourceStat.ino) {
      throw new Error('源文件在转换期间已发生变化，请重试。');
    }
  } finally {
    source.destroy();
    await output.close();
  }
  send({ type: 'result', result: { kind: 'file', bytesRead, bytesWritten } });
}

void main(workerData as WorkerJob).catch(error => {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
});
