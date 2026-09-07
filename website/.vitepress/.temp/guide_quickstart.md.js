import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"使用 Web UI","description":"","frontmatter":{"editSource":"docs/user/guide/index.zh.md"},"headers":[],"relativePath":"guide/quickstart.md","filePath":"guide/quickstart.md"}');
const _sfc_main = { name: "guide/quickstart.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="使用-web-ui" tabindex="-1">使用 Web UI <a class="header-anchor" href="#使用-web-ui" aria-label="Permalink to &quot;使用 Web UI&quot;">​</a></h1><p>请先按照<a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md#run" target="_blank" rel="noreferrer">根目录 README</a> 中的说明启动 Web UI；命令会打印其访问地址。本指南从服务器已经运行的状态开始。<code>dsh</code> 进程会把启动时所在的目录作为默认文件系统位置；全新的 Web UI 则不会选中任何工作区，你需要添加一个工作区。</p><h2 id="配置模型" tabindex="-1">配置模型 <a class="header-anchor" href="#配置模型" aria-label="Permalink to &quot;配置模型&quot;">​</a></h2><p>打开<strong>设置 → 模型</strong>，输入 <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek API 密钥</a>并保存。模型路由会立即可用，不需要重启服务器。</p><p><a href="./providers">模型配置指南</a>介绍其他提供方和自定义 OpenAI 兼容端点。</p><h2 id="选择工作区" tabindex="-1">选择工作区 <a class="header-anchor" href="#选择工作区" aria-label="Permalink to &quot;选择工作区&quot;">​</a></h2><p>点击<strong>选择工作区</strong>，添加启动 <code>dsh</code> 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。</p><h2 id="运行任务" tabindex="-1">运行任务 <a class="header-anchor" href="#运行任务" aria-label="Permalink to &quot;运行任务&quot;">​</a></h2><p>启动一个会话并发送：</p><blockquote><p>Summarize this repository and identify its main packages.</p></blockquote><p>Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，Web UI 会先询问你。</p><h2 id="继续使用" tabindex="-1">继续使用 <a class="header-anchor" href="#继续使用" aria-label="Permalink to &quot;继续使用&quot;">​</a></h2><ul><li><a href="./providers">配置模型</a></li><li><a href="./python-sdk">使用 Python SDK</a></li><li><a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.zh.md" target="_blank" rel="noreferrer">使用其他 CLI 模式</a></li><li><a href="./../develop/basic/">开发插件</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/quickstart.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const quickstart = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  quickstart as default
};
