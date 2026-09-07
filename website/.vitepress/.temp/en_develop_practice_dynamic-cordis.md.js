import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Extend a running agent with Cordis tools","description":"","frontmatter":{"editSource":"docs/user/develop/practice/dynamic-cordis.md"},"headers":[],"relativePath":"en/develop/practice/dynamic-cordis.md","filePath":"en/develop/practice/dynamic-cordis.md"}');
const _sfc_main = { name: "en/develop/practice/dynamic-cordis.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="extend-a-running-agent-with-cordis-tools" tabindex="-1">Extend a running agent with Cordis tools <a class="header-anchor" href="#extend-a-running-agent-with-cordis-tools" aria-label="Permalink to &quot;Extend a running agent with Cordis tools&quot;">​</a></h1><p>This practice guide enables <a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/tool-cordis/README.md" target="_blank" rel="noreferrer"><code>@deepseek-ai/dsh-tool-cordis</code></a>. The agent can inspect its current Cordis process and mount or unmount model-authored plugins in memory. Temporary plugins disappear when they are unmounted or the process exits and may affect other sessions in the same process.</p><h2 id="run-it" tabindex="-1">Run it <a class="header-anchor" href="#run-it" aria-label="Permalink to &quot;Run it&quot;">​</a></h2><p>Start the browser interface with the checked-in overlay:</p><div class="language-sh vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">sh</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">pnpm</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> dsh</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> web</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --patch</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> apps/cli/config/examples/cordis/cordis.yml</span></span></code></pre></div><p>The command requires a model credential. The <a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/extensions/tool-cordis/README.md" target="_blank" rel="noreferrer">Cordis tool reference</a> defines the tool arguments, lifetime, cleanup, and safety contracts.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/develop/practice/dynamic-cordis.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const dynamicCordis = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  dynamicCordis as default
};
