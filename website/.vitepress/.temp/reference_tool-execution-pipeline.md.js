import { resolveComponent, useSSRContext } from "vue";
import { ssrRenderAttrs, ssrRenderSuspense, ssrRenderComponent } from "vue/server-renderer";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"工具执行流水线","description":"","frontmatter":{"editSource":"docs/tool-execution-pipeline.zh.md"},"headers":[],"relativePath":"reference/tool-execution-pipeline.md","filePath":"reference/tool-execution-pipeline.md"}');
const _sfc_main = { name: "reference/tool-execution-pipeline.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  const _component_Mermaid = resolveComponent("Mermaid");
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="工具执行流水线" tabindex="-1">工具执行流水线 <a class="header-anchor" href="#工具执行流水线" aria-label="Permalink to &quot;工具执行流水线&quot;">​</a></h1><p>此图展示策略、钩子、沙箱、文件系统守卫、结果重写、最终结果观察和 UI 渲染在不改变循环的情况下何时运行。<code>tools/pre-execute</code> waterfall（瀑布式事件）首先运行，随后是单调守卫，然后运行 <code>tools/execute</code> 和 <code>tools/post-execute</code> waterfall；这三个 waterfall 可以改写一次调用。由定义自身控制的 <code>finalizeContent</code> 和 <code>tools/result</code> 在此之后运行。</p>`);
  ssrRenderSuspense(_push, {
    default: () => {
      _push(ssrRenderComponent(_component_Mermaid, {
        id: "mermaid-7",
        class: "mermaid",
        graph: "flowchart%20TD%0A%20%20model%5B%22Assistant%20message%20contains%20tool-call%20block%22%5D%0A%20%20toolCall%5B%22Session%20event%3A%20%3Ccode%3Etool%2Fcall%3C%2Fcode%3E%3Cbr%2F%3Elogged%20before%20execution%22%5D%0A%20%20presentCall%5B%22UI%20pending%20card%3Cbr%2F%3EpresentCall(args)%22%5D%0A%20%20pre%5B%22%3Ccode%3Etools%2Fpre-execute%3C%2Fcode%3E%20waterfall%3Cbr%2F%3Ehooks%2C%20permission%2C%20sandbox%22%5D%0A%20%20guards%5B%22Registered%20monotonic%20guards%3Cbr%2F%3Edeny%20or%20abstain%3B%20identity%20protected%22%5D%0A%20%20denied%5B%22denied%20or%20approval%20refused%3Cbr%2F%3Etool%20body%20skipped%22%5D%0A%20%20approval%5B%22%3Ccode%3Ectx.approval%3C%2Fcode%3E%20one-shot%20prompt%3Cbr%2F%3Eabsent%20or%20unanswerable%3A%20deny%22%5D%0A%20%20around%5B%22%3Ccode%3Etools%2Fexecute%3C%2Fcode%3E%20waterfall%3Cbr%2F%3Etimeout%2C%20retry%2C%20metrics%20(around%20dispatch)%22%5D%0A%20%20toolBody%5B%22Registered%20tool%20execute()%20body%22%5D%0A%20%20fsGate%5B%22%3Ccode%3Efs%2Fwrite-intent%3C%2Fcode%3E%20or%20%3Ccode%3Efs%2Fedit-intent%3C%2Fcode%3E%3Cbr%2F%3Etool-fs%20mutations%20only%22%5D%0A%20%20owned%5B%22Tool-owned%20session%20events%3Cbr%2F%3E%3Ccode%3Etodo%2Fwrite%3C%2Fcode%3E%2C%20%3Ccode%3Efs%2Fobserved%3C%2Fcode%3E%2C%20%3Ccode%3Ehook%2Finvoked%3C%2Fcode%3E%2C%20%3Ccode%3Ehook%2Fresult%3C%2Fcode%3E%2C%20%3Ccode%3Etool%2Fcode-dispatch%3C%2Fcode%3E%22%5D%0A%20%20post%5B%22%3Ccode%3Etools%2Fpost-execute%3C%2Fcode%3E%20waterfall%3Cbr%2F%3Eaccept%2C%20block%2C%20replace%2C%20add%20context%22%5D%0A%20%20normalized%5B%22Registry%20outer%20normalization%3Cbr%2F%3Epipeline%2Fresult%20snapshot%20throws%20become%20isError%22%5D%0A%20%20finalize%5B%22ToolDefinition.finalizeContent%3Cbr%2F%3Elast%20content-only%20invariant%22%5D%0A%20%20final%5B%22%3Ccode%3Etools%2Fresult%3C%2Fcode%3E%20synchronous%20notification%3Cbr%2F%3Efrozen%20authoritative%20outcome%22%5D%0A%20%20context%5B%22Active-batch%20additionalContexts%20FIFO%3Cbr%2F%3Einjected%20user%2Fmessage%20after%20recorded%20tool%20results%22%5D%0A%20%20toolResult%5B%22Session%20event%3A%20%3Ccode%3Etool%2Fresult%3C%2Fcode%3E%3Cbr%2F%3Esingle%20model-facing%20outcome%22%5D%0A%20%20allResults%5B%22Tool%20batch%20settled%3Cbr%2F%3Erecorded%20tool%2Fresult%20events%20complete%22%5D%0A%20%20presentResult%5B%22UI%20completed%20card%3Cbr%2F%3EpresentResult(args%2C%20result)%22%5D%0A%20%20model%20--%3E%20toolCall%0A%20%20toolCall%20--%3E%20presentCall%0A%20%20toolCall%20--%3E%20pre%0A%20%20pre%20--%3E%7Callow%7C%20guards%0A%20%20guards%20--%3E%7Callow%7C%20around%0A%20%20guards%20--%3E%7Cdeny%7C%20denied%0A%20%20guards%20-.-%3E%7Cthrow%7C%20normalized%0A%20%20around%20--%3E%20toolBody%0A%20%20pre%20--%3E%7Cdeny%7C%20denied%0A%20%20pre%20--%3E%7Cask%7C%20approval%0A%20%20approval%20--%3E%7Callowed-once%7C%20guards%0A%20%20approval%20--%3E%7Crejected%2C%20cancelled%2C%20unavailable%7C%20denied%0A%20%20approval%20-.-%3E%7Cthrow%7C%20normalized%0A%20%20denied%20--%3E%20post%0A%20%20pre%20-.-%3E%7Cthrow%7C%20normalized%0A%20%20toolBody%20--%3E%20fsGate%0A%20%20fsGate%20--%3E%20toolBody%0A%20%20toolBody%20--%3E%20owned%0A%20%20toolBody%20--%3E%20around%0A%20%20around%20--%3E%20post%0A%20%20around%20-.-%3E%7Cwrapper%20throws%7C%20normalized%0A%20%20post%20-.-%3E%7Cthrow%7C%20normalized%0A%20%20post%20--%3E%20finalize%0A%20%20normalized%20--%3E%20finalize%0A%20%20finalize%20--%3E%20final%0A%20%20final%20--%3E%20toolResult%0A%20%20toolResult%20--%3E%20presentResult%0A%20%20toolResult%20--%3E%20allResults%0A%20%20allResults%20--%3E%20context%0A"
      }, null, _parent));
    },
    fallback: () => {
      _push(` Loading... `);
    },
    _: 1
  });
  _push(`<p>文件系统的先读后编辑检查位于 <code>tool-fs</code> 之下，通过 <code>fs/*</code> 事件实现。通用的前置／后置 waterfall 承载钩子与审批策略；<code>ctx.approval</code> 在单调守卫之前处理询问，而不得重新排序的所有者策略仍作为已注册的守卫。超时等环绕分发关注点对 <code>tools/execute</code> 进行包装。注册表会对候选结果进行无损快照；如果快照失败，则会先将失败规范化，之后再由可见定义中已随快照固定的 <code>finalizeContent</code> 回调强制执行其同步且仅限内容的不变式。随后，<code>tools/result</code> 会观察不可变、可由 JSON 无损表示的结果。这样一来，钩子便可跨越不同工具系列，而无需让工具与某个策略服务耦合。PTC mode 会将保留的 <code>run_code</code> 传输及其序列化子调用都送入流水线；子调用携带父级 token、记录 <code>tool/code-dispatch</code>、将拒绝呈现为具有约束力的驳回，并省略 <code>additionalContexts</code>，以保持调用与结果相邻。</p><p>维护模式：英文源文件包含人工维护的 Mermaid 流程图，并由生成器写出；本中文文件作为经评审对侧通过双语配对维护。确切的工具 schema 与事件签名位于生成的目录中。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("reference/tool-execution-pipeline.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const toolExecutionPipeline = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  toolExecutionPipeline as default
};
