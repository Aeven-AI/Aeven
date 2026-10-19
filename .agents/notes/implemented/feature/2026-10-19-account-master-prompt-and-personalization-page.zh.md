# Agent Note: 按账户的主提示词与 Personalization 页面

Status: implemented

[English](2026-10-19-account-master-prompt-and-personalization-page.md) | 中文

## 问题

Aeven 的身份是一段长提示词（`deployment:persona`），随 `aeven` 预设一起发布。产品里既没有地方显示它，也没有任何办法修改它：想改变 Aeven 是什么，只能去编辑组合文件并重启。Settings → Personalization——唯一关于 Aeven 如何说话的页面——提供的是一种语气、自由文本备注，以及一个标着“How should Aeven call you?”的字段：这个问题读起来像在问对话中的称呼，写的却是账户显示名，也就是用来登录并喂给 `<user_profile>` 的那个东西。于是这个页面用一张昵称表来呈现一个账户事实，同时完全不让人看到真正支配回答的那些指令。

## 决策

Settings → Personalization 变成三项设置——语气、备注、主提示词——并且没有姓名字段。

**主提示词是该人对 persona 段落的按账户覆盖。** `@aeven/personalization` 把它存进该人已有的文档（格式版本 2，字段 `masterPrompt`，空值表示“出厂提示词掌管”）。对该人所拥有的每个顶层 agent，控制器都会在该 agent 的作用域里注册一个顺序为标准 `DEPLOYMENT_PERSONA` 的 `deployment:persona` 段落；最近的同名作用域获胜，因此本人的文本只替换自己会话中的预设 persona，不影响他人。

**出厂提示词仍留在组合声明它的地方。** 该段落的文本提供者是 `stored || shipped`：当本人什么都没写时，控制器通过 agent 的父作用域从提示词注册表里读出 persona 文本——也就是预设自己的注册——而不是在别处保留第二份副本。因此被改成空的文档绝不会让某个会话失去身份。

**Host 无需组装即可读取已注册的某个段落。** `SystemPrompt.sectionText(name, context)` 在指定作用域中解析段落文本，其调用提供者的方式与组装完全一致。它在变量插值之前返回文本，因此编辑器里显示的就是 `{{model}}` 与 `{{cwd}}` 的原样。

**被委派的子代理沿用出厂 persona。** 子 agent 可能在本控制器要用的同一作用域里注册自己的 persona，而同一作用域内同名两次注册会在加载时失败；因此控制器跳过会话头带有委派深度的 agent。

**Remote 携带生效中的文本。** `get()` 返回偏好、界限、`effectiveMasterPrompt`（本人的文本，或出厂文本）以及 `customMasterPrompt`；`update()` 保存；`resetMasterPrompt()` 清除覆盖。超过 `maxMasterPromptChars`（默认 20000）的文本会带 `master-prompt-too-long` 被整体拒绝，正如备注以 `notes-too-long` 被拒绝。

**页面陈述名字，而不再索要它。** “What Aeven calls you”现在是一行说明：Aeven 从一个人在对话中的自我介绍里学到它。账户显示名保留自己的归宿；本页不再写入它。

### 页面的形态

语气是一行四个选项，被选中的那项在行下自我说明——取代了四张满宽卡片、每张都带标题、描述与示例。备注保留 Save，因为它是打出来的。主提示词始终显示在自己的标题之下，本人改过时标记为 `Yours`，并提供 Save 与 Reset to default；编辑器打开时显示的就是该人会话已经携带的文本，并带相对上限的字数统计。

## 考虑过的替代方案

**整个安装共用一份主提示词。** 由所有账户共读一份部署级文档被否掉了：这个页面是个人设置，文本最自然的归属者是它所适用于的那个人，而共享提示词还需要一个管理界面和一条免重启的重新加载路径，按账户存储都不需要。

**把主提示词作为另一个段落追加，而不是替换 persona。** 挂在 persona 之后会让两条指令同时生效、由模型自己去调和；“恢复默认”也就失去意义，因为默认从未被替换。遮蔽式注册才让一条文本真正说了算。

**把出厂提示词复制进 personalization 的配置。** 从 `web-app/cordis.patch.yml` 的第二个字段读取默认值，意味着同样的 8,269 个字符要出现在两个文件里，而副本会悄无声息地腐坏。通过 `sectionText` 读取预设自己的注册让文本只有一个归宿，代价是一次只有在调用方存在 agent 时才可用的 Host 读取。

**保留姓名字段，只改标签。** 按产品自身的逻辑就被否掉：一个问“该怎么称呼你”的字段，是把对话事实摆成了账户表单。账户名仍可通过账户界面编辑；本页不再假装是那个地方。

## 后果

- 本人编辑过的提示词从下一个请求起就对模型可见，并且可以从会话日志重建，因为 persona 段落记录在每次 `request/header` 中。
- 以相同的名字与顺序替换 persona 段落，使什么都没改的人组装出的提示词形态完全一致，因此已录制的会话快照不会变动。
- 委派行为保持原样，而被委派的助手不会读到委派者的主提示词。改了提示词再去委派的人，在子 agent 里得到的是出厂 persona。
- 改名现在只存在于账户界面；本页没有它的编辑器。
- `@aeven/personalization` 新增了对 `@aeven/scope` 的 Host 依赖（`scopeOf`、`scopeParentOf`），依赖策略把 `scopeParentOf` 归类为 peer-required 导出。

## 测试

`packages/preset/personalization/tests/store.spec.ts` 钉住文档格式、修剪与两种拒绝、无变化时的答复、重置以及按人隔离。`packages/core/system-prompt/tests/scoped.spec.ts` 钉住 `sectionText`：最近作用域解析、每次读取都求值提供者、未知名称，以及未插值的文本。`packages/client/ui-settings-personalization/tests/PersonalizationSection.client.spec.tsx` 钉住这个页面：只有一行的语气选择器与它唯一的那段说明、消失的姓名字段、只在脏时保存且拒绝超限文本的备注、始终显示的生效提示词编辑器、`Yours` 徽标、重置，以及读取失败后的重试。
