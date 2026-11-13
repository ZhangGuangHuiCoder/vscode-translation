import { l10n, Memento, window, workspace } from "vscode";

/** 读取 translation.* 配置 */
export const getConfig = <T>(key: string, defaultValue: T) => workspace.getConfiguration("translation").get<T>(key, defaultValue);

/** 可翻译的最大字符数 */
export const getMaxLength = () => getConfig("maxLength", 120);

type BingToken = { key: string; token: string; expireAt: number };
type CacheItem = { result: string; createdAt: number };

const BING_TOKEN_TTL = 3600000;
const requestHeaders = new Headers();
requestHeaders.append("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1");

let state: Memento;
export const initState = (memento: Memento) => (state = memento);

/** 获取必应翻译的 key 和 token（缓存 1 小时） */
async function fetchBingToken() {
  const html = await (await fetch("https://cn.bing.com/translator/", { headers: requestHeaders })).text();
  const rawParams = html.match(/params_AbusePreventionHelper.+3600000]/)![0].match(/\[.+\]/)![0];
  const [key, token] = JSON.parse(rawParams);
  const bingToken: BingToken = { key, token, expireAt: Date.now() + BING_TOKEN_TTL };
  await state.update("bingToken", bingToken);
  return bingToken;
}

/** 必应翻译 */
async function bingTranslate(toChinese: boolean, text: string) {
  let bingToken = state.get<BingToken>("bingToken");
  if (!bingToken || bingToken.expireAt < Date.now()) bingToken = await fetchBingToken();
  const body = new URLSearchParams();
  body.append("fromLang", toChinese ? "en" : "zh-Hans");
  body.append("to", toChinese ? "zh-Hans" : "en");
  body.append("text", text);
  body.append("tryFetchingGenderDebiasedTranslations", "true");
  body.append("isRegenTrans", "1");
  body.append("token", bingToken.token);
  body.append("key", bingToken.key);
  const url = "https://cn.bing.com/ttranslatev3?isVertical=1&IG=14AAE98EE9E34FF8BAEEED779058B2D3&IID=translator.5029";
  const response = await fetch(url, { method: "POST", headers: requestHeaders, body });
  const data = (await response.json()) as { translations: { text: string }[] }[];
  return data[0].translations[0].text;
}

/** 腾讯翻译 */
async function tencentTranslate(toChinese: boolean, text: string) {
  const response = await fetch("https://transmart.qq.com/api/imt", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      header: { fn: "auto_translation", client_key: "browser 1-1" },
      type: "plain",
      model_category: "normal",
      text_domain: "general",
      source: { lang: toChinese ? "en" : "zh", text_list: [text] },
      target: { lang: toChinese ? "zh" : "en" },
    }),
  });
  const data = (await response.json()) as { auto_translation: string[] };
  return data.auto_translation[0].trim();
}

/** Index-Translate（B 站开源翻译模型）免费公网接口，兼容 OpenAI 规范 */
async function bilibiliTranslate(toChinese: boolean, text: string) {
  const response = await fetch("https://index-translate.bilibili.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Index-Translate-Client/1.0" },
    body: JSON.stringify({
      model: getConfig("bilibiliModel", "Index-Translate-2B"),
      messages: [{ role: "user", content: `请将以下文本翻译为${toChinese ? "中文" : "英语"}，直接输出翻译结果，不要进行任何解释。\n\n${text}` }],
      temperature: 0,
      max_tokens: 256,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!response.ok) throw new Error("Index-Translate 返回 " + response.status);
  const data = (await response.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content.trim();
}

type CustomApi = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  resultPath?: string;
  languages?: { en?: string; zh?: string };
};

/** 自定义翻译接口：{text} {from} {to} 占位符会被替换，再按 resultPath 取出译文 */
async function customTranslate(toChinese: boolean, text: string) {
  const api = getConfig<CustomApi>("customApi", {});
  if (!api.url) throw new Error("未配置 translation.customApi.url");
  const en = api.languages?.en ?? "en";
  const zh = api.languages?.zh ?? "zh";
  const values: Record<string, string> = { text, from: toChinese ? en : zh, to: toChinese ? zh : en };
  const headers = new Headers(requestHeaders);
  for (const [name, value] of Object.entries(api.headers ?? {})) headers.set(name, value);
  const isForm = (headers.get("Content-Type") ?? "").includes("x-www-form-urlencoded");
  const fill = (template: string, escape: (value: string) => string) => template.replace(/\{(text|from|to)\}/g, (_, name: string) => escape(values[name]));
  const escapeJson = (value: string) => JSON.stringify(value).slice(1, -1);
  const method = (api.method ?? "POST").toUpperCase();
  const url = fill(api.url, encodeURIComponent);
  const body = method === "GET" || !api.body ? undefined : fill(api.body, isForm ? encodeURIComponent : escapeJson);
  const response = await fetch(url, { method, headers, body });
  if (!response.ok) throw new Error("自定义接口返回 " + response.status);
  let data: any = await response.json();
  for (const key of (api.resultPath ?? "").split(".").filter(Boolean)) data = data?.[key];
  if (typeof data !== "string" || !data.trim()) throw new Error("自定义接口未取到译文，请检查 resultPath");
  return data.trim();
}

/** 按配置的引擎翻译：race 同时请求取最快，其余先主后备 */
async function requestTranslation(toChinese: boolean, text: string) {
  const engine = getConfig<string>("engine", "race");
  if (engine === "race") {
    const nonEmpty = async (task: Promise<string>) => (await task) || Promise.reject("empty");
    /** 只在两个机器翻译（必应、腾讯）之间竞速 */
    return Promise.any([nonEmpty(bingTranslate(toChinese, text)), nonEmpty(tencentTranslate(toChinese, text))]);
  }
  const engines: Record<string, typeof bingTranslate> = { bing: bingTranslate, tencent: tencentTranslate, bilibili: bilibiliTranslate, custom: customTranslate };
  const primary = engines[engine] ?? bingTranslate;
  const fallback = engine === "bing" ? tencentTranslate : bingTranslate;
  try {
    return await primary(toChinese, text);
  } catch {
    return await fallback(toChinese, text);
  }
}

const cache = new Map<string, CacheItem>();

/** 翻译文本：英文转中文，中文转英文；超长返回空字符串 */
export async function translate(text: string, silent = false) {
  const cached = cache.get(text);
  if (cached && Date.now() - cached.createdAt < getConfig("cacheSeconds", 60) * 1000) return cached.result;
  try {
    if (text.length < 1 || text.length > getMaxLength()) return "";
    const toChinese = /^[\u0000-ÿ]+$/.test(text);
    /** 驼峰转空格 */
    const plainText = text.replace(/([a-z])([A-Z])/g, "$1 $2");
    const result = await requestTranslation(toChinese, plainText);
    cache.set(text, { result, createdAt: Date.now() });
    return result;
  } catch {
    if (!silent) window.showErrorMessage(l10n.t("Translation request failed"));
    return Promise.reject("网络翻译异常");
  }
}
