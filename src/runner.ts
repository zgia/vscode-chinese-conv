import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ConversionCancelled, type Cancellation, type Job, type JobResult, type Progress, type WorkerJob, type WorkerMessage } from './protocol';

export type RunOptions = {
  cancellation?: Cancellation;
  onProgress?: (progress: Progress) => void;
  workerPath?: string;
};

// Each job owns a worker, so cancellation stops even synchronous conversion.
// The caller receives a result only after the worker has exited.
export async function runJob(job: Job, options: RunOptions = {}): Promise<JobResult> {
  if (options.cancellation?.isCancellationRequested) throw new ConversionCancelled();
  let temporaryDirectory: string | undefined;
  let workerJob: WorkerJob;
  try {
    if (job.kind === 'file') {
      try {
        await fs.lstat(job.outputPath);
        throw new Error('输出文件已存在，请选择一个新的文件名。');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      temporaryDirectory = await fs.mkdtemp(path.join(path.dirname(job.outputPath), '.chinese-conv-'));
      workerJob = { kind: 'file', mode: job.mode, sourcePath: job.sourcePath, targetPath: path.join(temporaryDirectory, 'output') };
    } else {
      workerJob = job;
    }

    if (options.cancellation?.isCancellationRequested) throw new ConversionCancelled();
    const result = await startWorker(workerJob, options);
    if (options.cancellation?.isCancellationRequested) throw new ConversionCancelled();
    if (job.kind === 'file' && workerJob.kind === 'file') {
      // A same-volume hard link publishes a complete file atomically and refuses
      // to replace an existing path, including a file created during conversion.
      try {
        await fs.link(workerJob.targetPath, job.outputPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('输出文件已存在，请选择一个新的文件名。');
        }
        throw error;
      }
    }
    return result;
  } finally {
    if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function startWorker(job: WorkerJob, options: RunOptions): Promise<JobResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(options.workerPath ?? path.join(__dirname, 'worker.js'), { workerData: job });
    let result: JobResult | undefined;
    let failure: Error | undefined;
    let cancelled = false;
    const subscription = options.cancellation?.onCancellationRequested(() => {
      cancelled = true;
      void worker.terminate();
    });
    // Cover cancellation between the initial check and subscribing.
    if (options.cancellation?.isCancellationRequested) {
      cancelled = true;
      void worker.terminate();
    }
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') options.onProgress?.(message.progress);
      if (message.type === 'result') result = message.result;
      if (message.type === 'error') failure = new Error(message.message);
    });
    worker.on('error', error => { failure = error; });
    worker.once('exit', code => {
      subscription?.dispose();
      if (cancelled) reject(new ConversionCancelled());
      else if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error(`转换进程意外退出（${code}）。`));
      else resolve(result);
    });
  });
}
