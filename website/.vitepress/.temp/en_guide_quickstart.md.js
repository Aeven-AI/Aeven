import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Use the Web UI","description":"","frontmatter":{"editSource":"docs/user/guide/index.md"},"headers":[],"relativePath":"en/guide/quickstart.md","filePath":"en/guide/quickstart.md"}');
const _sfc_main = { name: "en/guide/quickstart.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="use-the-web-ui" tabindex="-1">Use the Web UI <a class="header-anchor" href="#use-the-web-ui" aria-label="Permalink to &quot;Use the Web UI&quot;">​</a></h1><p>Start the Web UI through the <a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md#run" target="_blank" rel="noreferrer">root README</a>; the command prints its URL. This guide begins after that server is running. The <code>dsh</code> process uses its invoking directory as the default filesystem location, but a fresh Web UI has no selected workspace until you add one.</p><h2 id="configure-a-model" tabindex="-1">Configure a model <a class="header-anchor" href="#configure-a-model" aria-label="Permalink to &quot;Configure a model&quot;">​</a></h2><p>Open <strong>Settings → Models</strong>, enter a <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek API key</a>, and save it. The model route becomes usable immediately without restarting the server.</p><p>The <a href="./providers">model configuration guide</a> covers other providers and custom OpenAI-compatible endpoints.</p><h2 id="choose-a-workspace" tabindex="-1">Choose a workspace <a class="header-anchor" href="#choose-a-workspace" aria-label="Permalink to &quot;Choose a workspace&quot;">​</a></h2><p>Click <strong>Choose workspace</strong>, add the project directory where you started <code>dsh</code>, and select it. The session composer remains unavailable until a workspace is selected.</p><h2 id="run-a-task" tabindex="-1">Run a task <a class="header-anchor" href="#run-a-task" aria-label="Permalink to &quot;Run a task&quot;">​</a></h2><p>Start a session and send:</p><blockquote><p>Summarize this repository and identify its main packages.</p></blockquote><p>The agent can read and edit workspace files, run commands, delegate work, and maintain a plan. The Web UI asks before operations that require approval under the active permission policy.</p><h2 id="continue" tabindex="-1">Continue <a class="header-anchor" href="#continue" aria-label="Permalink to &quot;Continue&quot;">​</a></h2><ul><li><a href="./providers">Configure models</a></li><li><a href="./python-sdk">Use the Python SDK</a></li><li><a href="https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md" target="_blank" rel="noreferrer">Use other CLI modes</a></li><li><a href="./../develop/basic/">Develop a plugin</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("en/guide/quickstart.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const quickstart = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  quickstart as default
};
