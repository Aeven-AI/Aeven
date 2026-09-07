import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"用 Cordis 工具扩展运行中的智能体","description":"","frontmatter":{"editSource":"docs/user/develop/practice/dynamic-cordis.zh.md"},"headers":[],"relativePath":"develop/practice/dynamic-cordis.md","filePath":"develop/practice/dynamic-cordis.md"}');
const _sfc_main = { name: "develop/practice/dynamic-cordis.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="用-cordis-工具扩展运行中的智能体" tabindex="-1">用 Cordis 工具扩展运行中的智能体 <a class="header-anchor" href="#用-cordis-工具扩展运行中的智能体" aria-label="Permalink to &quot;用 Cordis 工具扩展运行中的智能体&quot;">​</a></h1><p>本实战指南启用 <a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/tool-cordis/README.zh.md" target="_blank" rel="noreferrer"><code>@deepseek-ai/dsh-tool-cordis</code></a>。智能体可以检查当前 Cordis 进程，并在内存中挂载或卸载模型编写的插件。临时插件会在卸载或进程退出时消失，并可能影响同一进程中的其他会话。</p><h2 id="运行" tabindex="-1">运行 <a class="header-anchor" href="#运行" aria-label="Permalink to &quot;运行&quot;">​</a></h2><p>使用仓库内 overlay 启动浏览器界面：</p><div class="language-sh vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">sh</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">pnpm</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> dsh</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> web</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --patch</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> apps/cli/config/examples/cordis/cordis.yml</span></span></code></pre></div><p>该命令需要模型凭据。<a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/tool-cordis/README.zh.md" target="_blank" rel="noreferrer">Cordis 工具参考</a>定义了四类约定：工具参数、存续时间、清理行为和安全性。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("develop/practice/dynamic-cordis.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const dynamicCordis = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  dynamicCordis as default
};
