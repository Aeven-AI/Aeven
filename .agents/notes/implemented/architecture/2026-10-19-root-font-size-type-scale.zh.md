# Agent Note: 根字号即客户端排版基准

Status: implemented

[English](2026-10-19-root-font-size-type-scale.md) | 中文

## Problem

字号设置（12–17px，默认 16）只推动一条轴线：`body` 上的 `--avn-content-font-size`，加上比它低一档的第二个变量，以及由这一对变量算出的像素增量。写成 `calc(34px + var(--avn-content-font-delta))` 的字号会跟随设置；其余全部——设置弹窗、侧栏、菜单、输入框、工具输出、代码块、登录界面——都是字面的 `font-size: 14px`。结果是一位把字号设为 17px 的读者，得到 17px 的对话正文，却嵌在冻结在 16/14/12 的外壳里；而 93 个样式表里的 473 条像素字号声明，每一条都要单独学会这条轴线。

## Decision

**设置写入文档根字号，客户端字号一律用 `rem` 表达。** `boot-theme.ts` 在挂载外壳之前写入 `documentElement.style.fontSize`，`ThemePresenter` 随后保持它；于是客户端里的每一个 `rem` 都是读者所选字号的一份。在 16px 默认值下，渲染尺寸与它所替换的像素值完全一致，因此在有人改动设置之前，这次变更不可见。

**一张阶梯，用分数表达。** 16px 是基准（`1rem`），14 是 `0.875rem`，12 是 `0.75rem`；markdown 阶梯（h1 2.125rem……h6 0.6875rem，正文 1rem/1.75rem，代码 0.875rem）是同一张阶梯、同样的渲染尺寸。行高也用 `rem`，这样一行保持的是比例，而不是像素。

**增量管线退役。** `--avn-content-font-delta`、`--avn-content-font-delta-secondary`，以及它们喂养的 `calc(Npx + delta)` 度量都不再存在：过去为一档字号加增量的度量，现在就是它在默认值下所等于的那个分数。`--avn-content-font-size` 与 `--avn-content-font-size-secondary` 仍为客户端之外的界面写出，但客户端已无任何读取。

**像素字号即门禁失败。** `scripts/verify-client-type-scale.ts`（脚本 `verify-client-type-scale`，归入客户端门禁组）拒绝 `packages/client/*/src` 与 `packages/api/*/src` 中以 `px` 表达的 `font-size`、`line-height`、`font:` 简写、`--dsw-font-*` 令牌，以及承载字号的其它自定义属性。有意的例外在该行写下 `/* type-scale-allow: 理由 */`；目前唯一一处是 `packages/client/web/src/base.css` 里的 iOS 聚焦缩放下限，因为那个 16px 阈值是绝对的，而不是排版选择。

## Alternatives considered

**保留增量变量，用它乘整张阶梯。** 否决：每个尺寸都要维护两种表示（自身值与增量形式），阶梯藏在工具无法读取的 `calc()` 字符串里，而需要新增一档的组件仍要挑选一种增量变体。

**保留像素，改用 `zoom` 或变换来缩放。** 否决：亚像素的字形回流、随设置变化的视口，以及不再匹配其余 CSS 所依据布局的文字度量。

**把基准写在 `body` 而不是 `html` 上。** 否决：`rem` 解析的是根元素，写在 body 上不会缩放任何东西；要生效就得把每条声明改成 `em`，而 `em` 会沿嵌套级联，使组件的尺寸取决于父级。

## Consequences

改动设置现在会重新缩放整个界面，字号一行也如此说明（"影响整个界面"）。终端模拟器从同一份快照推导字形尺寸（`Math.round(fontSize * 13 / 16)`），因为 xterm 以自身的整数像素度量。门禁即执行手段：`pnpm run verify-client-type-scale` 会在新增像素字号时失败，其 spec 逐一钉住被接受与被拒绝的写法。随仓库内置的登录样式表（`ui-auth-aeven/src/vendor/aeven-auth.css`）与 Figma 导出的令牌表（`gradient-shadow-text.css`）随其余文件一并转换，因此插件之前的登录界面也跟随设置。图标暂时保留像素几何：它们由 SVG 属性定尺寸而非字号，缩放它们是另一个决定。
