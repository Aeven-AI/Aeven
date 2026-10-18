# Agent Note: 内置西班牙语 GUI locale

Status: implemented

[English](2026-10-19-shipped-spanish-locale.md) | 中文

## Problem

浏览器 GUI 只内置了 `zh` 与 `en` 两个 locale，而 `LocaleRuntime.register` 要求恰好这一对：类型化对象形式接收基于 `LOCALE_IDS` 的 `Record<BuiltInLocaleId, LocaleDictOf<N>>`。因此第三个内置语言没有受支持的路径。为外部插件预留的语言包接缝通过未类型化的 `register(ns, locale, dict)` 重载逐个 locale 注册，用这种方式内置一门语言可能漏掉键，使同一屏混排西班牙语与英语，而所有门禁仍然通过。

## Decision

**西班牙语（`es`）是内置 GUI locale。** `LOCALE_IDS` 列出 `zh`、`en` 与 `es`，`BUILT_IN_LOCALE_METADATA` 给 `es` 名为 `Español` 的标签与 `en` 回退，因此请求 `es-419` 的浏览器按主语言子标签匹配，将来某个命名空间缺键时也能解析。向 `LOCALE_IDS` 增加一个元素会让每个类型化的 `register(ns, { zh, en })` 调用点变成编译错误，直到它同时带上 `es` 词典——这是语言包接缝无法强制的完整性。

**每个内置命名空间都带一份以 `zh` 键集为基准检查的西班牙语词典。** 词典保持既有形状：`zh` 仍是键集的事实来源，`en` 与 `es` 在编译期与它对照；为 `en` 加类型标注的文件同样为 `es` 加标注。登录前 `auth.aeven` 的文案不会进入 locale 服务——门禁运行在插件图之前——因此它自带的词典表里包含 `es` 条目，并按相同的主语言子标签规则匹配浏览器标签。

**词典对等门禁检查每个内置 locale。** `scripts/locale-dictionary-parity.spec.ts` 会发现 `es` 词典与 `Es` 后缀名，把每对词典中出现的每个 locale 都与 `zh` 对照，并对声明西班牙语的词典对数量设下限，使扫描范围收窄时失败而不是在更少的语言上空转通过。

西班牙语文案采用中性的拉丁美洲用语与第二人称，逐字保留产品名、模型 id、协议标签与 `{placeholder}` 名；引号与省略号改用西班牙语标点（`«»`、`…`）。

## Alternatives considered

**把西班牙语做成外部语言包。** 否决。该接缝是为仓库外语言准备的，其单语言注册未类型化，部分翻译的语言包会让同一屏出现两种语言，且没有门禁发现。

**按 `en` 的键顺序推导 `es`，而不显式声明。** 否决。键漂移会以裸 key 的形式出现在运行中的 UI 里，而这正是 `zh`／`en` 词典对已经防范的失败。

## Consequences

内置一门语言的成本现在是完整的一套词典：`pnpm run typecheck` 会指出缺少词典的每个命名空间，对等 spec 会指出漂移的每个键。起始 locale 不变——`FALLBACK_LOCALE` 仍指向 `en`，浏览器检测仍决定临时语言。语言包路径对不在仓库内发布的语言依然可用。西班牙语除既有的 `.one`／`.other` 键对之外不需要复数规则，但计数短语内的性数一致是任何词典门禁都无法检查的翻译问题。`packages/client/locale/tests/apply.client.spec.ts` 与 `document-language.client.spec.ts` 固定西班牙语文案与 `es` 文档标签；locale README 对记录内置集合。
