import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

async function undo(document: vscode.TextDocument): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  const changed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { subscription.dispose(); reject(new Error('等待撤销超时')); }, 5000);
    const subscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document === document && event.contentChanges.length) {
        clearTimeout(timeout);
        subscription.dispose();
        resolve();
      }
    });
  });
  await vscode.commands.executeCommand('undo');
  await changed;
}

export async function run(): Promise<void> {
  const original = '系统里面的软件。海内存知己，天涯若比邻。';
  const document = await vscode.workspace.openTextDocument({ content: original, language: 'plaintext' });
  const editor = await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('chineseConv.s2hk');
  assert.equal(document.getText(), '系統裏面的軟件。海內存知己，天涯若比鄰。');
  await undo(document);
  assert.equal(document.getText(), original, '一次撤销应恢复全文');
  console.log('PASS: 全文转换和一次撤销');

  const selectionsDocument = await vscode.workspace.openTextDocument({ content: '软件｜鼠标｜系统', language: 'plaintext' });
  const selectionsEditor = await vscode.window.showTextDocument(selectionsDocument);
  selectionsEditor.selections = [new vscode.Selection(0, 0, 0, 2), new vscode.Selection(0, 3, 0, 5)];
  await vscode.commands.executeCommand('chineseConv.selection.s2twp');
  assert.equal(selectionsDocument.getText(), '軟體｜滑鼠｜系统', '只应转换两个选区');
  await undo(selectionsDocument);
  assert.equal(selectionsDocument.getText(), '软件｜鼠标｜系统');
  console.log('PASS: 多选区转换和一次撤销');

  selectionsEditor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand('chineseConv.selection.s2hk');
  assert.equal(selectionsDocument.getText(), '软件｜鼠标｜系统', '选区菜单命令无选区时不能转为全文转换');
  console.log('PASS: 选区菜单直接转换，无选区时不改动全文');

  await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  const conversion = vscode.commands.executeCommand('chineseConv.s2hk');
  await new Promise(resolve => setTimeout(resolve, 10));
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(0, 0), '新输入：');
  assert.ok(await vscode.workspace.applyEdit(edit));
  await conversion;
  assert.equal(document.getText(), '新输入：' + original, '后台结果不应覆盖新输入');
  console.log('PASS: 转换期间修改文档不会被覆盖');

}
