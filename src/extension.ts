import { commands, ExtensionContext, StatusBarAlignment, window, workspace } from "vscode";
import { initGlobalState, netTranslate } from "./transmart";
const status = window.createStatusBarItem(StatusBarAlignment.Left);
status.command = "extension.translate";
/* 防抖函数 */
function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}
/* 单词分割拼接 */
async function worldSplit(str: string) {
  const words = str.toLowerCase().split(" ");
  if (words.length <= 1) return words[0];
  const formatters: Record<string, () => string> = {
    小驼峰: () => words.map((v, i) => (i ? v[0].toUpperCase() + v.slice(1) : v)).join(""),
    大驼峰: () => words.map((v) => v[0].toUpperCase() + v.slice(1)).join(""),
    下划线: () => words.join("_"),
    中划线: () => words.join("-"),
    常量: () => words.map((v) => v.toUpperCase()).join("_"),
  };
  const format = workspace.getConfiguration().get<string>("format") || "小驼峰";
  if (formatters[format]) return formatters[format]();
  const options = Object.values(formatters).map((fn) => fn());
  if (options.length === 1) return options[0];
  return await window.showQuickPick(options, { placeHolder: "请选择要替换的变量名" });
}

/* 获取选中文本 */
function getSelectedText() {
  const editor = window.activeTextEditor;
  if (editor) {
    const selectedText = editor.document.getText(editor.selection).trim();
    if (selectedText.length > 0) return selectedText;
  }
  return status.hide();
}

/* 左侧底部bar的内容完美展示 */
async function updateStatus() {
  const selectedText = getSelectedText();
  if (!selectedText) return;
  const showText = await netTranslate(selectedText);
  status.text = "$(triangle-right) " + showText;
  status.show();
}

/* 替换选中文本 */
async function updateSelectedText() {
  const editor = window.activeTextEditor;
  if (!editor) return;
  const selectedText = getSelectedText();
  if (!selectedText) return;
  const translated = await netTranslate(selectedText);
  status.text = translated;
  const namedText = await worldSplit(translated);
  if (!namedText) return;
  // 检查当前选区是否仍然有效
  if (!editor.selection || editor.selection.isEmpty) return;
  await editor.edit((editBuilder) => editBuilder.replace(editor.selection, namedText));
}

export function activate(context: ExtensionContext) {
  initGlobalState(context.globalState);
  context.subscriptions.push(window.onDidChangeTextEditorSelection(debounce(updateStatus, 300)));
  context.subscriptions.push(commands.registerCommand("extension.translate", debounce(updateSelectedText, 300)));
}
export function deactivate() {}
