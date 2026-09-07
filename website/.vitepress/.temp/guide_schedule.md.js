import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"安排会话内提醒","description":"","frontmatter":{"editSource":"docs/user/guide/schedule.zh.md"},"headers":[],"relativePath":"guide/schedule.md","filePath":"guide/schedule.md"}');
const _sfc_main = { name: "guide/schedule.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="安排会话内提醒" tabindex="-1">安排会话内提醒 <a class="header-anchor" href="#安排会话内提醒" aria-label="Permalink to &quot;安排会话内提醒&quot;">​</a></h1><p>此 overlay 让一个 <code>dsh web</code> 进程显式启用 Schedule 提醒，同时不改变交付的默认 Web 组合：</p><div class="language-sh vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">sh</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">dsh</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> web</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --patch</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> apps/cli/config/examples/schedule/cordis.yml</span></span></code></pre></div><p>当前 overlay 支持使用正整数 <code>after_seconds</code>、绝对时间 <code>at</code> 目标，或至少 300 秒的固定速率 <code>every_seconds</code> 间隔创建提醒。模型通过 <code>schedule_create</code>、<code>schedule_list</code> 和 <code>schedule_delete</code> 管理它们；每个结果都会把交付标为 <code>session-local</code>。</p><p>启用此 overlay 后，成功打开且存在活动提醒的 Session 会在对话 header 中显示只读目录。目录列出完整 prompt、等待中或已逾期状态、单次或精确重复周期、浏览器本地目标时间与相对时间。侧边栏还会在 grouped、flat 与 search 行当前可用的 projection 值非空时，于标题后显示不可交互的闹钟。这些界面不会创建、编辑、删除或确认提醒；cold Session 的缓存闹钟允许短暂漏显或残留。</p><p>浏览器会为每条提示词附加其 IANA 时区。Time-context 会告诉模型，把未明确限定时区的日期和时间解释为该请求的浏览器时区。此假设仅用于自然语言解释：<code>schedule_create.at</code> 必须是带 <code>Z</code> 或数值偏移量且严格符合 RFC 3339 的日期时间，或是带显式 <code>UTC</code> 或 IANA Area/Location 时区的 <code>{ date, time, time_zone }</code>。Schedule 不保留或推断 Session 默认时区。夏令时缺口会被拒绝，重叠时段选择第一个时刻；成功创建的记录只保留所得的 UTC 目标。</p><p>每条提醒由原 Session 日志拥有。live 根 Agent 会等待到完全 idle，再在该对话中排入一个普通 follow-up 轮次。它绝不会中途引导当前工作，也不会添加独立回执或提醒卡片。关闭进程或让 Session 保持 cold 会停止内存 timer，但不会删除记录；重新打开同一个 Session 会恢复等待并交付逾期提醒。查看 cold 历史不会激活提醒，fork 也不会继承父 Session 的提醒。</p><p>Every 提醒始终与其创建时刻对齐。如果提醒逾期，只会呈现最新一个到期发生时点，下一个目标仍保留在原固定速率序列上。同一次 idle 决策中逾期的所有不同 Every 记录会合并为一个 follow-up，每条记录各有一个发生时点；错过的间隔不会形成积压。已到期的一次性提醒会在该批次之前运行。不支持日历表达式和 Cron 表达式。</p><p>创建和实际删除操作只有在 Session persistence 确认对应事件前缀后才会确认成功。Schedule 不提供浏览器、操作系统、邮件、短信或其他外部通知。持久 dispatch 会记录 follow-up 已经入队；它不确认模型成功或用户已收到提醒。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/schedule.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const schedule = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  schedule as default
};
