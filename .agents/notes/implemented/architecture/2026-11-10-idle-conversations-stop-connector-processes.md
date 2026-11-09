# Agent Note: Idle conversations stop their connector processes

Status: implemented

English

## Problem

`avn-host-account-integrations` mounts a signed-in user's connectors into each agent when the agent is created and keeps them until the agent is disposed. A Google connector (Gmail, Drive, Calendar) is one Node process per agent, running the Workspace MCP bridge; Microsoft and Discord connectors are one Node process each as well. On hosted Web, pink ran 18 Workspace bridge processes for 17 accounts after three and a half hours, at about 85 MB resident each, and most belonged to conversations nobody was using. An account with all three Google connectors pays about 250 MB per open conversation, so the processes, not the Host, set how many conversations one machine holds.

## Decision

A conversation's connector child processes stop after `connectorIdleMs` (default 300 seconds) without a step or a tool call, and its next step starts them again. `agent/pre-step` already synchronizes connectors before the model is asked, so a stopped connector is mounted again before its tools are needed and the model sees the same tool set. Remote MCP servers stay mounted because they hold no process.

Use is counted at `agent/created`, at every `agent/pre-step` synchronization, and at `tools/pre-execute` and `tools/post-execute`. `connectorIdleMs` must exceed `timeoutMs`, the tool request budget, and the constructor rejects a configuration where it does not; with both ends of a call counted, a process never stops under a call it is serving. An idle stop removes the connections from the agent's table before it disposes them, and a synchronization waits for a stop in progress, so a step never reads a connection that is being disposed.

The default rests on a measurement: starting one Workspace bridge and listing its tools takes 220 to 270 ms on a development Mac, for 78 MB resident. Connector processes already restart whenever an access token rotates, which for Google is about once an hour, so a restart between steps is an existing path.

## Alternatives considered

One process per account and connector, shared by that account's conversations, removes more memory for accounts with several open conversations. It was deferred because the `mcp` plugin owns both the transport and the tool registrations inside one agent scope; sharing the process means separating the two, which changes `avn-mcp-client` for every consumer. Idle stopping is confined to this package and also covers the conversation that is simply left open.

Mounting lazily, on the first connector tool call, was rejected: the model must see a connector's tools before it can call one, and the tool list comes from the running server.

## Consequences

The first step of a conversation idle for longer than `connectorIdleMs` waits for its connector processes to start, about a quarter of a second each, in parallel. Tools re-registered after an idle stop are appended to the agent's tool list, so their position among the conversation's tools can differ from the previous turn, as it already can after a token rotation. Sharing one process across an account's conversations remains open.
