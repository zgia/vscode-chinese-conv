import type { ModeId } from './modes';

export type TextJob = { kind: 'text'; mode: ModeId; texts: string[] };
export type FileJob = { kind: 'file'; mode: ModeId; sourcePath: string; outputPath: string };
export type Job = TextJob | FileJob;
export type WorkerJob = TextJob | (Omit<FileJob, 'outputPath'> & { targetPath: string });
export type TextResult = { kind: 'text'; texts: string[] };
export type FileResult = { kind: 'file'; bytesRead: number; bytesWritten: number };
export type JobResult = TextResult | FileResult;
export type Progress = { message: string; percent?: number };
export type WorkerMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'result'; result: JobResult }
  | { type: 'error'; message: string };

export type Cancellation = {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
};

export class ConversionCancelled extends Error {
  constructor() { super('转换已取消'); this.name = 'ConversionCancelled'; }
}
