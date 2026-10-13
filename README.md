# Aeven (Æven)

English | [中文](README.zh.md)

## You bring the idea. Aeven finds the way.

Aeven is an open, model-independent AI operating layer for your digital life. It connects your files, apps, messages, browser, and tools so you can start with what you want to accomplish. Research a question, make a document, organize a project, build software, or carry a task from one application into another.

Aeven brings together the context to understand the task and the capabilities to act on it. It remembers relevant work, learns reusable procedures, and keeps that knowledge above the model. You can change the model underneath while keeping your sessions, connections, and accumulated context.

**AI can do more. So can you.**

[Get started](#run) · [Documentation](https://aeven-ai.github.io/Harness/) · [Desktop](apps/desktop/README.md) · [Developers](#open-by-design)

Aeven is in developer preview. Features and data formats can change. Read the [safety notice](SAFETY.md) before giving it access to your files, accounts, or computer.

## Table of Contents

- [Start with the outcome](#start-with-the-outcome)
- [The Aeven Layer](#the-aeven-layer)
- [Connect your world](#connect-your-world)
- [Run](#run)
- [Open by design](#open-by-design)
- [Contributing](#contributing)
- [Community and support](#community-and-support)
- [License](#license)

-----

## Start with the outcome

Your work rarely lives in one place. A message refers to a document. A document belongs to a project. The project has files, a repository, and decisions scattered across earlier conversations. Aeven can use connected services and local tools together, carrying context through the task.

Give it an outcome in your own words:

> “Compare these proposals, check the claims, and make a document explaining the tradeoffs.”
>
> “Find the files that belong to this project and propose a way to organize them.”
>
> “Investigate this bug, implement a fix, and run the relevant tests.”
>
> “Read the project discussion and draft an update for the team.”

Aeven can search, inspect files and attachments, use connected apps, create artifacts, run code, and delegate parts of a task to subagents. Skills provide specialized instructions; tools supply the actions. Browser and computer-use capabilities let it work with software beyond dedicated API integrations, where the host supports them.

You can follow the work in the conversation, refine the request, and respond to approval prompts under your active permission policy. Which actions are available depends on the installed capabilities, connected accounts, and access you grant.

-----

## The Aeven Layer

The model supplies intelligence. The Aeven Layer keeps the context and experience that make that intelligence useful to you.

It brings together four kinds of knowledge:

- **You:** preferences, relevant history, projects, and facts you have confirmed.
- **Your environment:** workspaces, connected accounts, files, and available services.
- **Available capabilities:** tools, skills, connectors, and execution environments.
- **Ways of working:** reusable procedures learned from completed tasks.

Long-term memory recalls relevant context across conversations. A background learner can turn completed work into procedures the agent can reuse, including steps, verification, and recovery. Sessions also retain their own history, with resume and fork support.

You can review, correct, and forget memories in **Settings → Memory**, and set response preferences in **Personalization** when signed in. Learning provides context for later work; each result still needs verification.

**Change the model. Keep your Aeven.** Model providers are configurable, while sessions, memory, and integrations are managed by Aeven. See the [model guide](docs/user/guide/providers.md) for supported providers and custom endpoints.

-----

## Connect your world

Aeven runs on your machine through the [desktop app](apps/desktop/README.md) or a local server with a browser interface. Both share the Web UI and local session state. Local execution gives the agent access to the files, development tools, and services you make available.

In **Settings → Connectors**, connect services such as GitHub, Google Drive, calendars, email, and messaging accounts. Provider setup and authentication vary; some connections require host configuration. **Skills** lets you import reusable instructions, and custom MCP connections can expose additional tools.

You choose the model provider and the systems Aeven can reach. A local host can still send data to configured model and connector services; your provider and permission choices determine where work goes.

Developers can also run one-shot headless tasks, integrate sessions through the TypeScript or Python SDK, and connect automation clients over ACP. The [CLI reference](apps/cli/README.md) covers these entry points.

-----

## Run

### Run from npm

Install Node.js 22.19+ in the 22.x series, or Node.js 24+, then run this from your project directory:

```sh
npx @aeven/cli web
```

Aeven starts the Web UI at `http://127.0.0.1:3080` by default and opens your browser on a local launch. Over SSH it prints the host URL; use your SSH client or editor's port forwarding to reach it. Pass `--no-open` to start without opening a browser.

### Run your first task

The interface needs a model provider and a selected workspace before you can send a task.

1. Open **Settings → Providers**, add your model provider, and save its credentials. No provider is configured by default.
2. Choose a workspace, add your project directory, and select it.
3. Select a model in the composer, start a session, and send a task:

> Summarize this repository and identify its main packages.

Tool calls and results appear in the conversation as the agent works. Operations that require approval under the active permission policy prompt you for a decision. See the [model configuration guide](docs/user/guide/providers.md) if your provider needs additional setup.

### Run from source

Use a repository checkout to develop or customize Aeven. Install the Node.js version above and the pnpm version declared in [package.json](package.json).

```sh
git clone https://github.com/Aeven-AI/Harness.git aeven
cd aeven
pnpm install
pnpm run build
pnpm avn web
```

The build prepares the package and frontend artifacts. `pnpm avn web` launches those artifacts without rebuilding. See the [development guide](docs/development.md) for the contributor workflow.

-----

## Open by design

You can inspect, run, modify, and extend Aeven yourself. Its everything-is-a-plugin design extends through the agent loop, model adapters, tools, permissions, session persistence, and UI. [Cordis](https://github.com/cordiverse/cordis) composes these plugins into a running application. A profile selects the composition, and configuration patches let you replace or extend it.

For example, you can add a tool, intercept a model request, supply context, change the execution provider, or build a client that reads the session event stream. The default agent loop is itself replaceable. This makes Aeven useful both as an application you run and as a harness you adapt for a different agent workflow.

- [Architecture](docs/architecture.md) — understand profiles, the agent loop, session events, and extension points.
- [Plugin development](docs/user/develop/basic/index.md) — learn to build a Cordis plugin.
- [Extension cookbook](docs/cookbook/extension-cookbook.md) — find the extension point for a capability.
- [TypeScript SDK](packages/sdk/client/README.md) and [Python SDK](docs/user/guide/python-sdk.md) — integrate agent sessions into an application.
- [Development guide](docs/development.md) — work on the source; coding agents follow [AGENTS.md](AGENTS.md).

Cordis's design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

## Contributing

Aeven is early in development, and we are not accepting external pull requests yet. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before starting work intended for this repository.

You can help by reporting reproducible bugs, sharing feedback and real use cases in [GitHub Discussions](https://github.com/Aeven-AI/Harness/discussions), or building skills, plugins, and integrations outside this repository. Guides and examples that help people get useful work done with Aeven are welcome too. Add the [`avn-plugin`](https://github.com/topics/avn-plugin) topic to plugin repositories so others can find them.

## Community and support

Ask questions and share what you are building in [GitHub Discussions](https://github.com/Aeven-AI/Harness/discussions) or the [Aeven Discord community](https://discord.gg/Ycq5dCaS4).

## License

[Apache-2.0](LICENSE). Attribution for the code Aeven derives from is in [NOTICE](NOTICE). Dependency licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Dev Note

<details>
<summary>Working notes</summary>

None.

</details>
