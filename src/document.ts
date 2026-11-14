/** 文档拆分与还原（纯逻辑，不依赖 vscode） */

const CJK = /[一-龥]/;
const LATIN = /[a-zA-Z]/;
/** 行首的 Markdown 标记（引用、标题、列表、任务框），翻译时原样保留 */
const LINE_PREFIX = /^(\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?)(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** 是否含有可翻译的文字（英文字母或中文） */
export const hasLetters = (text: string) => LATIN.test(text) || CJK.test(text);

/** 待翻译的片段：核心文字前后的空白原样保留 */
type Piece = { lead: string; core: string; trail: string };
type Segment = string | Piece;

/** 文档以英文为主则译成中文，否则译成英文 */
export function detectToChinese(content: string) {
  const latin = content.match(/[a-zA-Z]+/g)?.length ?? 0;
  const cjk = content.match(/[一-龥]+/g)?.length ?? 0;
  return latin >= cjk;
}

/** 把文档拆成每行的片段，代码块、front matter、已是目标语言的内容原样保留 */
export function splitDocument(content: string, toChinese: boolean) {
  const needsTranslation = (text: string) => hasLetters(text) && (toChinese ? !CJK.test(text) : CJK.test(text));
  const toSegment = (text: string): Segment => {
    const core = text.trim();
    if (!needsTranslation(core)) return text;
    const lead = text.slice(0, text.indexOf(core));
    return { lead, core, trail: text.slice(lead.length + core.length) };
  };
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let inFrontMatter = lines[0]?.trim() === "---";
  const segments = lines.map((line, index): Segment[] => {
    if (inFrontMatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFrontMatter = false;
      return [line];
    }
    const isFence = FENCE.test(line);
    if (isFence) inFence = !inFence;
    const trimmed = line.trim();
    if (isFence || inFence || /^<[^>]+>$/.test(trimmed)) return [line];
    if (trimmed.startsWith("|")) return line.split(/(\|)/).map(toSegment); // 表格：逐个单元格翻译
    const [, prefix, body] = line.match(LINE_PREFIX)!;
    return [prefix, toSegment(body)];
  });
  return { segments, eol: content.includes("\r\n") ? "\r\n" : "\n" };
}

/** 所有需要翻译的文本（去重） */
export const collectTexts = (segments: Segment[][]) => [...new Set(segments.flat().flatMap((segment) => (typeof segment === "string" ? [] : [segment.core])))];

/** 用译文还原整个文档，没有译文的片段保持原文 */
export const assembleDocument = (segments: Segment[][], translated: Map<string, string>, eol: string) =>
  segments.map((line) => line.map((segment) => (typeof segment === "string" ? segment : segment.lead + (translated.get(segment.core) ?? segment.core) + segment.trail)).join("")).join(eol);
