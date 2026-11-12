import * as vscode from 'vscode';
import * as path from 'node:path';
import { MODES, getMode, type ModeId } from './modes';
import { ConversionCancelled, type Job, type JobResult } from './protocol';
import { runJob } from './runner';
import { conversionRanges } from './selections';

export function activate(context: vscode.ExtensionContext): void {
  let busy = false;
  const workerPath = context.asAbsolutePath('dist/worker.js');

  function notifyBusy(): boolean {
    if (!busy) return false;
    void vscode.window.showInformationMessage('已有转换任务正在进行，请等待完成或取消后重试。');
    return true;
  }

  async function chooseMode(): Promise<ModeId | undefined> {
    const item = await vscode.window.showQuickPick(MODES.map(mode => ({
      label: mode.label,
      description: mode.description,
      mode: mode.id,
    })), { title: '简繁转换', placeHolder: '选择转换方向（香港繁体优先）', matchOnDescription: true });
    return item?.mode;
  }

  async function convert(job: Job): Promise<JobResult | undefined> {
    if (notifyBusy()) return undefined;
    busy = true;
    try {
      return await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `简繁转换：${getMode(job.mode).label}`,
        cancellable: true,
      }, async (progress, cancellation) => {
        let lastPercent = 0;
        return runJob(job, {
          workerPath,
          cancellation,
          onProgress(update) {
            const percent = update.percent === undefined
              ? lastPercent : Math.min(100, Math.max(lastPercent, update.percent));
            progress.report({ message: update.message, increment: percent - lastPercent });
            lastPercent = percent;
          },
        });
      });
    } finally {
      busy = false;
    }
  }

  async function convertEditor(requestedMode?: ModeId, scope: 'auto' | 'selection' | 'document' = 'auto'): Promise<void> {
    if (notifyBusy()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('请先打开需要转换的文本文件。');
      return;
    }
    const document = editor.document;
    const version = document.version;
    const length = document.offsetAt(new vscode.Position(document.lineCount, 0));
    if (scope === 'selection' && editor.selections.every(selection => selection.isEmpty)) {
      void vscode.window.showInformationMessage('请先选中需要转换的文字。');
      return;
    }
    const offsets = conversionRanges(length, scope === 'document' ? [] : editor.selections.map(selection => ({
      start: document.offsetAt(selection.start),
      end: document.offsetAt(selection.end),
    })));
    if (offsets.length === 0) {
      void vscode.window.showInformationMessage('当前文档为空。');
      return;
    }
    const mode = requestedMode ?? await chooseMode();
    if (!mode) return;
    if (document.isClosed || document.version !== version) {
      void vscode.window.showWarningMessage('文档内容已发生变化，请重新执行转换。');
      return;
    }

    const ranges = offsets.map(range => new vscode.Range(
      document.positionAt(range.start), document.positionAt(range.end),
    ));
    const originals = ranges.map(range => document.getText(range));
    const result = await convert({ kind: 'text', mode, texts: originals });
    if (!result) return;
    if (result.kind !== 'text' || result.texts.length !== ranges.length) throw new Error('转换结果不完整，请重试。');
    if (document.isClosed || document.version !== version) {
      void vscode.window.showWarningMessage('转换期间文档内容已发生变化，转换结果未应用。请重新执行转换。');
      return;
    }
    if (result.texts.every((text, index) => text === originals[index])) {
      void vscode.window.showInformationMessage('转换完成，文本无需更改。');
      return;
    }

    let stale = false;
    const applied = await editor.edit(builder => {
      if (document.isClosed || document.version !== version) {
        stale = true;
        return;
      }
      ranges.forEach((range, index) => {
        if (result.texts[index] !== originals[index]) builder.replace(range, result.texts[index]);
      });
    }, { undoStopBefore: true, undoStopAfter: true });
    if (stale || !applied) {
      void vscode.window.showWarningMessage('无法应用转换结果，文档可能已变化或为只读。请重新执行转换。');
      return;
    }
    void vscode.window.showInformationMessage('转换完成，可撤销此次转换。');
  }

  async function convertFile(resource?: vscode.Uri): Promise<void> {
    if (notifyBusy()) return;
    const source = resource instanceof vscode.Uri ? resource : (await vscode.window.showOpenDialog({
      title: '选择需要转换的 UTF-8 文本文件',
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: '选择文件',
    }))?.[0];
    if (!source) return;
    if (source.scheme !== 'file') {
      void vscode.window.showErrorMessage('磁盘文件转换仅支持文件系统中的文件。其他文档请使用“转换选区或全文”。');
      return;
    }
    function sourceIsDirty(): boolean {
      return vscode.workspace.textDocuments.some(document => document.uri.toString() === source!.toString() && document.isDirty);
    }
    if (sourceIsDirty()) {
      void vscode.window.showWarningMessage('该文件有未保存的修改，请保存后重新执行磁盘文件转换。');
      return;
    }
    const mode = await chooseMode();
    if (!mode) return;
    const parsed = path.parse(source.fsPath);
    const output = await vscode.window.showSaveDialog({
      title: '转换结果另存为（请选择新文件名）',
      saveLabel: '转换并另存为',
      defaultUri: vscode.Uri.file(path.join(parsed.dir, `${parsed.name}.${mode}${parsed.ext}`)),
    });
    if (!output) return;
    if (output.scheme !== 'file') {
      void vscode.window.showErrorMessage('请选择文件系统中的输出路径。');
      return;
    }
    if (sourceIsDirty()) {
      void vscode.window.showWarningMessage('该文件有未保存的修改，请保存后重新执行磁盘文件转换。');
      return;
    }
    const result = await convert({ kind: 'file', mode, sourcePath: source.fsPath, outputPath: output.fsPath });
    if (!result) return;
    if (result.kind !== 'file') throw new Error('转换结果不完整，请重试。');
    const choice = await vscode.window.showInformationMessage(`转换完成：${path.basename(output.fsPath)}`, '打开结果');
    if (choice === '打开结果') await vscode.commands.executeCommand('vscode.open', output);
  }

  function register(command: string, action: (...args: any[]) => Promise<void>): void {
    context.subscriptions.push(vscode.commands.registerCommand(command, async (...args: any[]) => {
      try {
        await action(...args);
      } catch (error) {
        if (error instanceof ConversionCancelled) {
          void vscode.window.showInformationMessage('转换已取消。');
        } else {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`简繁转换失败：${message}`);
        }
      }
    }));
  }

  register('chineseConv.convert', () => convertEditor());
  register('chineseConv.convertSelection', () => convertEditor(undefined, 'selection'));
  register('chineseConv.convertDocument', () => convertEditor(undefined, 'document'));
  for (const mode of MODES) {
    register(`chineseConv.${mode.id}`, () => convertEditor(mode.id));
    register(`chineseConv.selection.${mode.id}`, () => convertEditor(mode.id, 'selection'));
  }
  register('chineseConv.convertFile', convertFile);
}

export function deactivate(): void { /* Worker jobs clean themselves up on completion or cancellation. */ }
