import { Memento, StatusBarAlignment, window } from "vscode";

let globalState: Memento;
const status = window.createStatusBarItem(StatusBarAlignment.Left);
type BingToken = { key: string; token: string; time: number };
const headers = new Headers();
headers.append("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1");
async function GetBingTokenKey() {
  const html = await (await fetch("https://cn.bing.com/translator/", { headers })).text();
  //@ts-ignore
  const params_AbusePreventionHelper = html.match(/params_AbusePreventionHelper.+3600000]/)[0].match(/\[.+\]/)[0];
  const key = JSON.parse(params_AbusePreventionHelper)[0];
  const token = JSON.parse(params_AbusePreventionHelper)[1];
  globalState.update("bing", { key, token, time: Date.now() + 3600000 });
  await new Promise((r) => setTimeout(r, 100));
  console.log("GetBingTokenKey", globalState.get<BingToken>("bing"));
}
// 只保留空格、字母、中文
function filterAlphaChineseAndSpace(str: string) {
  return str.replace(/[^a-zA-Z\u4e00-\u9fa5\s]/g, " ").trim();
}
async function bing(en2zh: boolean, str: string) {
  const bing = globalState.get<BingToken>("bing")!;
  if (!bing || bing.time < Date.now()) await GetBingTokenKey();
  const body = new URLSearchParams();
  body.append("fromLang", en2zh ? "en" : "zh-Hans");
  body.append("to", en2zh ? "zh-Hans" : "en");
  body.append("text", str);
  body.append("tryFetchingGenderDebiasedTranslations", "true");
  body.append("isRegenTrans", "1");
  body.append("token", bing.token);
  body.append("key", bing.key);
  const options = { method: "POST", headers, body };
  const url = "https://cn.bing.com/ttranslatev3?isVertical=1&IG=14AAE98EE9E34FF8BAEEED779058B2D3&IID=translator.5029";
  const result = (await (await fetch(url, options)).json()) as [{ translations: [{ text: string; to: "en" }]; usedLLM: true }];
  return filterAlphaChineseAndSpace(result[0].translations[0].text);
}

async function qq(en2zh: boolean, str: string) {
  const rs = await fetch("https://transmart.qq.com/api/imt", {
    body: JSON.stringify({
      header: { fn: "auto_translation", client_key: "browser 1-1" },
      type: "plain",
      model_category: "normal",
      text_domain: "general",
      source: { lang: en2zh ? "en" : "zh", text_list: [str] },
      target: { lang: en2zh ? "zh" : "en" },
    }),
    method: "POST",
    headers,
  });
  //@ts-ignore
  const { auto_translation } = await rs.json();
  return filterAlphaChineseAndSpace(auto_translation[0].trim());
}

/* 网络翻译 */
async function netTranslate(str: string) {
  if (str.length == 0) return "";
  console.log("联网翻译." + str);
  try {
    status.text = "$(pulse) " + str;
    status.show();
    const en2zh = /^\w+$/.test(str);
    try {
      return await qq(en2zh, str);
    } catch {
      return await bing(en2zh, str);
    }
  } catch {
    status.text = "网络翻译异常";
    window.showErrorMessage("网络翻译异常");
    return Promise.reject("网络翻译异常");
  } finally {
    status.text = "$(library) " + str;
  }
}
const initGlobalState = (e: Memento) => (globalState = e);
export { initGlobalState, netTranslate };
