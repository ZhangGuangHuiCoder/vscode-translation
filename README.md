# 翻译（中英互译）

选中或悬停文本，即时中英互译，并一键转成小驼峰、大驼峰、下划线、常量等变量名。

## 功能

- **悬停翻译**：鼠标停在单词上，显示译文。
- **选中即译**：选中文本后，译文显示在状态栏，并在选区旁弹出，可以直接复制或替换。
- **变量命名**：中文转英文时，一键生成小驼峰、大驼峰、下划线、常量等变量名。
- **多个引擎**：必应、腾讯、哔哩哔哩，也可以接入自己的翻译接口；默认让必应和腾讯两个机器翻译同时请求，谁先返回用谁的。
- **中英文界面**：设置和提示跟随 VS Code 的显示语言。

## 使用方法

### 翻译

- **悬停**：鼠标停在单词上，稍等片刻出现译文。
- **选中**：选中一段文字（最多 120 个字符），状态栏显示译文，选区旁同时弹出翻译。

### 复制和替换

弹窗里每一行译文后面有两个图标：

- **复制**（两个重叠方块的图标）：把这一行复制到剪贴板。
- **替换**（带箭头的图标）：用这一行替换选中的文字（悬停时替换光标所在的单词）。

中文转英文且结果有多个单词时，弹窗会同时列出各种命名风格，选一行即可。

### 命令

选中文字后，按 <kbd>Ctrl+N</kbd>（macOS 为 <kbd>Cmd+N</kbd>），或右键选择“中英互译”，在顶部列表里选一项替换选中的文字。点击状态栏里的译文也一样。

### 切换引擎

状态栏左下角常驻一个引擎按钮：

- 鼠标停在按钮上，展开引擎列表，点一项直接切换。
- 直接点击按钮，循环切换到下一个引擎。
- 也可以在命令面板运行“切换翻译引擎”。

### 小提示

- 英文单词支持驼峰和下划线，会先拆成单词再翻译，例如 `getUserName` 翻译的是 “get user name”。
- 同一段文字 1 分钟内只请求一次，结果会缓存。
- 不想自动弹出时，在设置里关闭 `translation.selectionHover`；只想看状态栏，可以关闭 `translation.hover`。
- 翻译失败时，在状态栏切换到另一个引擎再试。

## 命名风格

| 风格 | 示例 |
| --- | --- |
| 小驼峰 | `userName` |
| 大驼峰 | `UserName` |
| 下划线 | `user_name` |
| 常量 | `USER_NAME` |
| 仅翻译 | `user name` |

## 设置

所有设置项都以 `translation.` 开头。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `translation.engine` | `race` | 翻译引擎：`race` 必应、腾讯同时请求，取最快的，`bing` 必应，`tencent` 腾讯（失败时回退到另一个），`bilibili` 哔哩哔哩 Index-Translate，`custom` 自定义接口 |
| `translation.bilibiliModel` | `Index-Translate-2B` | `bilibili` 引擎使用的模型：2B 最快，9B 均衡，35B-A3B 效果最好 |
| `translation.customApi` | 空 | 自定义翻译接口，见下文 |
| `translation.maxLength` | `120` | 可翻译的最大字符数，超出不翻译 |
| `translation.cacheSeconds` | `60` | 翻译结果缓存时间（秒） |
| `translation.hover` | `true` | 悬停翻译总开关，关闭后选区弹窗也不显示 |
| `translation.selectionHover` | `true` | 选中文本后自动在选区旁弹出翻译 |
| `translation.selectionHoverDelay` | `400` | 选中后弹出翻译的延迟（毫秒） |
| `translation.showCopy` / `translation.showReplace` | `true` | 弹窗中是否显示复制、替换图标 |
| `translation.statusBar` | `true` | 在状态栏显示翻译 |
| `translation.styleLowerCamel` 等 5 项 | 全部勾选 | 勾选要显示的命名风格：`styleLowerCamel` 小驼峰、`styleUpperCamel` 大驼峰、`styleSnake` 下划线、`styleConstant` 常量、`styleOriginal` 仅翻译 |

## 自定义翻译接口

可以接入自己的翻译服务（如 DeepL、自建接口）。在用户设置中配置 `translation.customApi`，并把 `translation.engine` 设为 `custom`。竞速只在必应和腾讯之间进行，不包含自定义接口。

| 字段 | 说明 |
| --- | --- |
| `url` | 接口地址 |
| `method` | `GET` 或 `POST`，默认 `POST` |
| `headers` | 请求头，例如 `Content-Type`、`Authorization` |
| `body` | 请求体模板（POST） |
| `resultPath` | 译文在返回 JSON 中的路径，用点分隔，数组用下标，例如 `translations.0.text` |
| `languages` | 语言代码映射，默认 `en` / `zh`，接口要求 `zh-CN` 等时配置 |

`url` 和 `body` 中可使用占位符：`{text}` 待翻译文本，`{from}` 源语言，`{to}` 目标语言。文本会按位置自动转义（URL 编码；`Content-Type` 为表单时对请求体 URL 编码，否则按 JSON 字符串转义）。

示例（DeepL）：

```json
"translation.engine": "custom",
"translation.customApi": {
  "url": "https://api-free.deepl.com/v2/translate",
  "headers": {
    "Authorization": "DeepL-Auth-Key 你的密钥",
    "Content-Type": "application/json"
  },
  "body": "{\"text\": [\"{text}\"], \"source_lang\": \"{from}\", \"target_lang\": \"{to}\"}",
  "resultPath": "translations.0.text",
  "languages": { "en": "EN", "zh": "ZH" }
}
```

自定义接口失败时会回退到必应。该设置只在用户级生效，工作区设置里的配置会被忽略，以免项目把你选中的文本发往未知地址。
