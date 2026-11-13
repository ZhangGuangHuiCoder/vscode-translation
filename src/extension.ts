import { commands, ConfigurationTarget, env, l10n, ExtensionContext, Hover, languages, MarkdownString, Position, Range, StatusBarAlignment, TextDocument, Uri, window, workspace, WorkspaceEdit } from "vscode";
import { getConfig, getMaxLength, initState, translate } from "./translator";

const COMMAND_TRANSLATE = "translation.translate";
const COMMAND_COPY = "translation.copy";
const COMMAND_REPLACE = "translation.replace";
const COMMAND_PICK_ENGINE = "translation.pickEngine";
const COMMAND_SET_ENGINE = "translation.setEngine";
const COMMAND_CYCLE_ENGINE = "translation.cycleEngine";
/** 命名风格对应的勾选设置 */
const STYLE_SETTINGS: Record<string, string> = {
  lowerCamel: "styleLowerCamel",
  upperCamel: "styleUpperCamel",
  snake: "styleSnake",
  constant: "styleConstant",
  original: "styleOriginal",
};
/** 命名风格的显示名称（随界面语言） */
const getStyleLabel = (style: string) =>
  ({ lowerCamel: l10n.t("lowerCamelCase"), upperCamel: l10n.t("UpperCamelCase"), snake: l10n.t("snake_case"), constant: l10n.t("CONSTANT_CASE"), original: l10n.t("Translation only") })[style] ?? style;
const getVisibleStyles = () => Object.keys(STYLE_SETTINGS).filter((style) => getConfig(STYLE_SETTINGS[style], true));
/** 悬停中各命名风格对应的图标 */
const STYLE_ICONS: Record<string, string> = {
  lowerCamel: "$(symbol-variable)",
  upperCamel: "$(symbol-class)",
  snake: "$(symbol-field)",
  constant: "$(symbol-constant)",
  original: "$(globe)",
};

const statusBar = window.createStatusBarItem(StatusBarAlignment.Left);
statusBar.command = COMMAND_TRANSLATE;
/** 状态栏上的引擎切换按钮，常驻显示在译文左侧 */
const engineButton = window.createStatusBarItem(StatusBarAlignment.Left, 1);
engineButton.command = COMMAND_CYCLE_ENGINE;
const ENGINES = ["race", "bing", "tencent", "bilibili", "custom"];
/** 可用的引擎；未配置自定义接口时不列出 custom */
const getAvailableEngines = () => ENGINES.filter((engine) => engine !== "custom" || !!getConfig<{ url?: string }>("customApi", {}).url);
const getEngineLabel = (engine: string) =>
  ({ race: l10n.t("Race"), bing: l10n.t("Bing"), tencent: l10n.t("Tencent"), bilibili: l10n.t("Bilibili"), custom: l10n.t("Custom API") })[engine] ?? engine;
/** 按钮文字 + 悬停时在按钮上方展开的引擎列表（点击列表项直接切换） */
const updateEngineButton = () => {
  const current = getConfig("engine", "race");
  engineButton.text = "$(arrow-swap) " + getEngineLabel(current);
  const tooltip = new MarkdownString(undefined, true);
  tooltip.isTrusted = { enabledCommands: [COMMAND_SET_ENGINE] };
  tooltip.appendMarkdown(
    getAvailableEngines()
      .map((engine) => `${engine === current ? "$(check)" : "&nbsp;&nbsp;&nbsp;&nbsp;"}&nbsp;[${getEngineLabel(engine)}](command:${COMMAND_SET_ENGINE}?${encodeURIComponent(JSON.stringify([engine]))})`)
      .join("\n\n")
  );
  engineButton.tooltip = tooltip;
};
const setEngine = (engine: string) => workspace.getConfiguration("translation").update("engine", engine, ConfigurationTarget.Global);

/** 点击按钮：切换到下一个引擎 */
async function cycleEngine() {
  const engines = getAvailableEngines();
  const index = engines.indexOf(getConfig("engine", "race"));
  await setEngine(engines[(index + 1) % engines.length]);
}

/** 弹出引擎列表，选中后写入用户设置 */
async function pickEngine() {
  const current = getConfig("engine", "race");
  const items = getAvailableEngines().map((engine) => ({ label: getEngineLabel(engine), description: engine === current ? "$(check)" : "", engine }));
  const picked = await window.showQuickPick(items, { placeHolder: l10n.t("Switch translation engine") });
  if (picked) await setEngine(picked.engine);
}

/** 防抖，delay 可以是函数，每次触发时读取最新配置 */
function debounce<T extends (...args: any[]) => any>(func: T, delay: number | (() => number)): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), typeof delay === "function" ? delay() : delay);
  };
}

const hasNonLatin = (text: string) => /[^\u0000-ÿ]/.test(text);

/** 只保留空格、字母、中文 */
function keepLettersAndSpaces(text: string) {
  return text.replace(/[^a-zA-Z一-龥\s]/g, " ").trim();
}

/** 英文翻译结果的各种命名风格；中文或单个单词返回 null */
function buildNamingStyles(text: string): Record<string, string> | null {
  if (hasNonLatin(text)) return null;
  const words = keepLettersAndSpaces(text).toLowerCase().split(" ");
  if (words.length <= 1) return null;
  const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);
  return {
    lowerCamel: words.map((word, index) => (index ? capitalize(word) : word)).join(""),
    upperCamel: words.map(capitalize).join(""),
    snake: words.join("_"),
    constant: words.map((word) => word.toUpperCase()).join("_"),
    original: text,
  };
}

/** 单个单词或中文结果的变量名 */
const toPlainName = (translated: string) => (hasNonLatin(translated) ? translated : keepLettersAndSpaces(translated).toLowerCase());

/** 获取选中文本，没有选中则隐藏状态栏 */
function getSelectedText() {
  const editor = window.activeTextEditor;
  if (editor) {
    const selectedText = editor.document.getText(editor.selection).trim();
    if (selectedText.length > 0) return selectedText;
  }
  return statusBar.hide();
}

/** 状态栏显示选中文本的翻译 */
async function refreshStatusBar() {
  if (!getConfig("statusBar", true)) return statusBar.hide();
  const selectedText = getSelectedText();
  if (!selectedText) return;
  statusBar.text = "$(pulse) " + selectedText;
  statusBar.show();
  const translated = await translate(selectedText);
  statusBar.text = "$(library) " + translated;
}

/** Ctrl+N：翻译选中文本，在顶部选择框中选择要替换的结果（不直接替换） */
async function showTranslation() {
  const editor = window.activeTextEditor;
  if (!editor) return;
  const selectedText = getSelectedText();
  if (!selectedText) return;
  const translated = await translate(selectedText);
  statusBar.text = translated;
  if (!translated) return;
  const styles = buildNamingStyles(translated);
  const visibleStyles = getVisibleStyles();
  const items = styles
    ? Object.entries(styles)
        .filter(([style]) => visibleStyles.includes(style))
        .map(([style, name]) => ({ label: name, description: getStyleLabel(style) }))
    : [{ label: toPlainName(translated), description: "" }];
  const picked = await window.showQuickPick(items, { placeHolder: l10n.t("Choose a variable name to replace the selection"), matchOnDescription: true });
  if (!picked || editor.selection.isEmpty) return;
  await editor.edit((editBuilder) => editBuilder.replace(editor.selection, picked.label));
}

/** 悬停翻译：有选区时翻译选区，否则翻译光标下的单词 */
async function provideHover(document: TextDocument, position: Position) {
  if (!getConfig("hover", true)) return;
  const editor = window.activeTextEditor;
  const selection = editor && editor.document === document && editor.selection.contains(position) && !editor.selection.isEmpty ? editor.selection : undefined;
  const range = selection ?? document.getWordRangeAtPosition(position);
  if (!range) return;
  const text = document.getText(range).trim();
  if (!text) return;
  try {
    const translated = await translate(text, true);
    if (!translated) return;
    const markdown = new MarkdownString(undefined, true);
    markdown.isTrusted = { enabledCommands: [COMMAND_COPY, COMMAND_REPLACE] };
    const renderRow = (name: string, style = "") => {
      const copyArgs = encodeURIComponent(JSON.stringify([name]));
      const replaceArgs = encodeURIComponent(JSON.stringify([document.uri.toString(), range.start.line, range.start.character, range.end.line, range.end.character, name]));
      const links: string[] = [];
      if (getConfig("showCopy", true)) links.push(`[$(copy)](command:${COMMAND_COPY}?${copyArgs} "${l10n.t("Copy")}")`);
      if (getConfig("showReplace", true)) links.push(`[$(replace)](command:${COMMAND_REPLACE}?${replaceArgs} "${l10n.t("Replace")}")`);
      const label = style ? `${STYLE_ICONS[style] ?? style}&nbsp;&nbsp;` : "";
      const escapedName = name.replace(/[\\`*_{}\[\]()#+!|<>~-]/g, "\\$&");
      return [label + escapedName, ...links].join("&nbsp;&nbsp;");
    };
    const styles = buildNamingStyles(translated);
    if (!styles) {
      markdown.appendMarkdown(renderRow(toPlainName(translated)));
    } else {
      const visibleStyles = getVisibleStyles();
      const rows = Object.entries(styles)
        .filter(([style]) => visibleStyles.includes(style))
        .map(([style, name]) => renderRow(name, style));
      if (!rows.length) return;
      markdown.appendMarkdown(rows.join("\n\n"));
    }
    return new Hover(markdown, range);
  } catch {}
}

/** 选中文本后自动在选区旁弹出翻译 */
const showSelectionHover = debounce(() => {
  const editor = window.activeTextEditor;
  if (!editor || editor.selection.isEmpty || !getConfig("hover", true) || !getConfig("selectionHover", true)) return;
  const text = editor.document.getText(editor.selection).trim();
  if (text.length > getMaxLength() || !/[a-zA-Z一-龥]/.test(text)) return; // 过长或不含文字不弹出
  commands.executeCommand("editor.action.showHover");
}, () => getConfig("selectionHoverDelay", 400));

export function activate(context: ExtensionContext) {
  initState(context.globalState);
  updateEngineButton();
  engineButton.show();
  context.subscriptions.push(
    commands.registerCommand(COMMAND_TRANSLATE, debounce(showTranslation, 300)),
    commands.registerCommand(COMMAND_PICK_ENGINE, pickEngine),
    commands.registerCommand(COMMAND_SET_ENGINE, setEngine),
    commands.registerCommand(COMMAND_CYCLE_ENGINE, cycleEngine),
    commands.registerCommand(COMMAND_COPY, async (name: string) => {
      await env.clipboard.writeText(name);
      window.setStatusBarMessage(l10n.t("Copied: {0}", name), 2000);
    }),
    commands.registerCommand(COMMAND_REPLACE, async (uri: string, startLine: number, startChar: number, endLine: number, endChar: number, name: string) => {
      const edit = new WorkspaceEdit();
      edit.replace(Uri.parse(uri), new Range(startLine, startChar, endLine, endChar), name);
      await workspace.applyEdit(edit);
    }),
    languages.registerHoverProvider("*", { provideHover }),
    workspace.onDidChangeConfiguration((event) => (event.affectsConfiguration("translation.engine") || event.affectsConfiguration("translation.customApi")) && updateEngineButton()),
    statusBar,
    engineButton,
    window.onDidChangeTextEditorSelection(debounce(refreshStatusBar, 300)),
    window.onDidChangeTextEditorSelection(showSelectionHover)
  );
}
export function deactivate() {}
