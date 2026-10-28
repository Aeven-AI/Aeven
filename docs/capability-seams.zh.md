<!-- 英文源文件由 scripts/gen-doc-graphs.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-doc-graphs` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/capability-seams.md` 重新记录配对。 -->

# 能力 Seams 与核心服务

[English](capability-seams.md) | 中文

服务可以是核心主干服务、可替换的能力 seam，也可以是组合包／组合点。下图展示了拥有服务声明的包、已知实现包，以及直接消费该服务的包。

```mermaid
flowchart LR
  pkg_identity_user["identity-user"]
  svc_identityUsers["ctx.identityUsers<br/>Authenticated user identity"]
  pkg_identity_user_aeven["identity-user-aeven"]
  pkg_client_connection["client-connection"]
  pkg_media["media"]
  svc_media["ctx.media<br/>Generated image and video"]
  pkg_media_aeven["media-aeven"]
  pkg_media_deepinfra["media-deepinfra"]
  pkg_media_openrouter["media-openrouter"]
  pkg_media_pi_ai["media-pi-ai"]
  pkg_computer_use["computer-use"]
  svc_computerUse["ctx.computerUse<br/>Computer-use provider registry"]
  pkg_computer_use_cua_driver_mcp["computer-use-cua-driver-mcp"]
  svc_computerUseProvider["ctx.computerUseProvider<br/>Loaded computer-use provider"]
  pkg_computer_use_macos_provider["computer-use-macos-provider"]
  svc_windowsComputerUseProvider["ctx.windowsComputerUseProvider<br/>Loaded Windows computer-use provider"]
  pkg_computer_use_windows_provider["computer-use-windows-provider"]
  pkg_attachment["attachment"]
  svc_attachments["ctx.attachments<br/>Durable binary attachment storage"]
  pkg_attachment_local["attachment-local"]
  pkg_api_session_controller["api-session-controller"]
  pkg_tool_fs["tool-fs"]
  pkg_llm_pi_ai["llm-pi-ai"]
  pkg_llm_deepseek["llm-deepseek"]
  pkg_llm["llm"]
  svc_llm["ctx.llm<br/>LLM adapter registry"]
  pkg_llm_replay["llm-replay"]
  pkg_agent_loop["agent-loop"]
  pkg_compaction_basic["compaction-basic"]
  pkg_deepseek_llm_api_extensions["deepseek-llm-api-extensions"]
  svc_deepseekLlmApiExtensions["ctx.deepseekLlmApiExtensions<br/>Official DeepSeek request extensions"]
  pkg_session_log_deepseek["session-log-deepseek"]
  pkg_plugin_package_inventory_deepseek["plugin-package-inventory-deepseek"]
  pkg_token_meter["token-meter"]
  svc_tokenMeter["ctx.tokenMeter<br/>Replay token measurement"]
  pkg_compaction_tool_result_pruner["compaction-tool-result-pruner"]
  svc_toolResultPruner["ctx.toolResultPruner<br/>Model-free tool-result pruning"]
  pkg_session["session"]
  svc_sessions["ctx.sessions<br/>In-memory session store"]
  pkg_agent["agent"]
  pkg_session_persistence["session-persistence"]
  pkg_session_query["session-query"]
  pkg_session_query_sqlite["session-query-sqlite"]
  pkg_subagent_in_process_driver["subagent-in-process-driver"]
  pkg_invariants["invariants"]
  pkg_message_feedback["message-feedback"]
  svc_sessionController["ctx.sessionController<br/>Host Session Remote controller"]
  svc_sessionFileReferences["ctx.sessionFileReferences<br/>Session-addressed file-reference Remote adapter"]
  svc_sessionSkillCatalog["ctx.sessionSkillCatalog<br/>Session-addressed skill Remote adapter"]
  pkg_api_settings_controller["api-settings-controller"]
  svc_credentialsController["ctx.credentialsController<br/>Host credential-surface Remote controller"]
  svc_settingsController["ctx.settingsController<br/>Host settings-surface Remote controller"]
  pkg_api_workspace_controller["api-workspace-controller"]
  svc_workspaceController["ctx.workspaceController<br/>Host Workspace Remote controller"]
  svc_directoryPickerController["ctx.directoryPickerController<br/>Host directory-picking Remote controller"]
  svc_invariants["ctx.invariants<br/>Package-owned invariant registry"]
  pkg_scope["scope"]
  pkg_typert_registry["typert-registry"]
  svc_typert["ctx.typert<br/>Runtime type registry"]
  pkg_typert_loader["typert-loader"]
  pkg_api_gateway["api-gateway"]
  svc_typertGateway["ctx.typertGateway<br/>Typert Host invocation gateway"]
  svc_sessionPersistence["ctx.sessionPersistence<br/>Durable session persistence seam"]
  pkg_session_persistence_jsonl["session-persistence-jsonl"]
  pkg_tool_bash["tool-bash"]
  pkg_hooks_claude_code["hooks-claude-code"]
  pkg_hooks_codex["hooks-codex"]
  pkg_settings["settings"]
  svc_settings["ctx.settings<br/>User-settings seam"]
  pkg_settings_file["settings-file"]
  pkg_tool_subagent["tool-subagent"]
  svc_subagentModelSelection["ctx.subagentModelSelection<br/>Subagent model-selection preference"]
  pkg_credentials["credentials"]
  svc_credentials["ctx.credentials<br/>Credential seam"]
  pkg_credentials_local["credentials-local"]
  pkg_authorization["authorization"]
  svc_authorization["ctx.authorization<br/>Authorization flow registry"]
  pkg_session_telemetry["session-telemetry"]
  svc_sessionTelemetry["ctx.sessionTelemetry<br/>Session telemetry seam"]
  pkg_session_telemetry_otel["session-telemetry-otel"]
  pkg_storage["storage"]
  svc_storage["ctx.storage<br/>Non-session storage hub"]
  pkg_storage_json["storage-json"]
  pkg_storage_sqlite["storage-sqlite"]
  pkg_storage_domain["storage-domain"]
  svc_storageDomain["ctx.storageDomain<br/>Domain data facility"]
  pkg_workspace["workspace"]
  svc_messageFeedback["ctx.messageFeedback<br/>Lifecycle-bound message feedback"]
  svc_workspaceRegistry["ctx.workspaceRegistry<br/>Workspace entity registry"]
  svc_sessionQuery["ctx.sessionQuery<br/>Session reads, traces, filters, and search"]
  pkg_session_reference["session-reference"]
  pkg_tool_session_query["tool-session-query"]
  pkg_file_reference["file-reference"]
  svc_fileReferences["ctx.fileReferences<br/>File reference discovery"]
  pkg_file_reference_local["file-reference-local"]
  svc_sessionReferenceResolver["ctx.sessionReferenceResolver<br/>Cross-session snapshot preparation"]
  pkg_session_title["session-title"]
  svc_sessionTitle["ctx.sessionTitle<br/>Log-backed session titles"]
  pkg_session_title_first_prompt_llm["session-title-first-prompt-llm"]
  pkg_session_title_all_prompts_llm["session-title-all-prompts-llm"]
  pkg_working_directory["working-directory"]
  svc_workingDirectory["ctx.workingDirectory<br/>Session working directory"]
  pkg_tool_bash_persistent["tool-bash-persistent"]
  pkg_tool_pwsh["tool-pwsh"]
  pkg_tool_pwsh_persistent["tool-pwsh-persistent"]
  pkg_tool_working_directory["tool-working-directory"]
  pkg_worktrees["worktrees"]
  svc_worktrees["ctx.worktrees<br/>Git worktrees per task"]
  pkg_tool_worktrees["tool-worktrees"]
  pkg_system_prompt["system-prompt"]
  svc_systemPrompt["ctx.systemPrompt<br/>System prompt assembly registry"]
  pkg_tools["tools"]
  pkg_tool_terminal["tool-terminal"]
  pkg_tool_web["tool-web"]
  svc_tools["ctx.tools<br/>Tool registry and guarded execution pipeline"]
  pkg_tool_ask_user["tool-ask-user"]
  pkg_tool_cordis["tool-cordis"]
  pkg_tool_skill["tool-skill"]
  pkg_tool_todo["tool-todo"]
  pkg_user_questions["user-questions"]
  svc_userQuestions["ctx.userQuestions<br/>Human question/answer seam"]
  pkg_plan_mode["plan-mode"]
  svc_planMode["ctx.planMode<br/>Plan collaboration state"]
  pkg_agent_presets["agent-presets"]
  svc_agentPresets["ctx.agentPresets<br/>Per-session agent composition"]
  pkg_commands["commands"]
  svc_commands["ctx.commands<br/>Human command registry"]
  pkg_session_projection["session-projection"]
  svc_sessionProjections["ctx.sessionProjections<br/>Session projection units"]
  pkg_session_projection_cache["session-projection-cache"]
  svc_sessionProjectionCache["ctx.sessionProjectionCache<br/>Persisted projection cache"]
  pkg_subagent["subagent"]
  pkg_skill["skill"]
  svc_skills["ctx.skills<br/>Skill provider registry"]
  pkg_skill_badge["skill-badge"]
  pkg_skill_filesystem["skill-filesystem"]
  svc_agents["ctx.agents<br/>Agent service"]
  pkg_acp["acp"]
  pkg_agent_default_model["agent-default-model"]
  svc_agentDefaultModel["ctx.agentDefaultModel<br/>Default Agent model selection"]
  pkg_headless["headless"]
  svc_agentLoop["ctx.agentLoop<br/>Concrete loop driver"]
  pkg_base["base"]
  pkg_sdk_minimal["sdk-minimal"]
  pkg_goal["goal"]
  svc_goals["ctx.goals<br/>Same-session goal domain"]
  pkg_e2b["e2b"]
  svc_e2b["ctx.e2b<br/>E2B sandbox lifecycle owner"]
  pkg_fs_e2b["fs-e2b"]
  pkg_subprocess_e2b["subprocess-e2b"]
  pkg_subprocess["subprocess"]
  svc_subprocess["ctx.subprocess<br/>Subprocess seam"]
  pkg_subprocess_local["subprocess-local"]
  pkg_bash_local["bash-local"]
  pkg_bash_sandbox["bash-sandbox"]
  pkg_terminal_bash["terminal-bash"]
  pkg_lsp_stdio["lsp-stdio"]
  pkg_subagent_acp["subagent-acp"]
  pkg_subagent_codex["subagent-codex"]
  pkg_subagent_claude_code["subagent-claude-code"]
  pkg_shell["shell"]
  svc_shell["ctx.shell<br/>Bash executor seam"]
  pkg_pwsh_local["pwsh-local"]
  pkg_shell_env["shell-env"]
  svc_shellEnv["ctx.shellEnv<br/>Managed bash environment registry"]
  pkg_terminal["terminal"]
  svc_terminals["ctx.terminals<br/>Persistent PTY session registry"]
  pkg_sandbox["sandbox"]
  svc_sandbox["ctx.sandbox<br/>Process-sandbox seam"]
  pkg_sandbox_local["sandbox-local"]
  pkg_sandbox_policy["sandbox-policy"]
  svc_sandboxPolicy["ctx.sandboxPolicy<br/>Sandbox policy home"]
  pkg_fs_sandbox["fs-sandbox"]
  pkg_user_approval["user-approval"]
  svc_approval["ctx.approval<br/>Approval seam"]
  pkg_permission_presets["permission-presets"]
  svc_permissionPresets["ctx.permissionPresets<br/>Permission presets"]
  pkg_code_runtime["code-runtime"]
  svc_codeRuntime["ctx.codeRuntime<br/>Code-execution seam"]
  pkg_code_runtime_worker_thread["code-runtime-worker-thread"]
  pkg_experimental_code_runtime_python["experimental-code-runtime-python"]
  pkg_fs["fs"]
  svc_fs["ctx.fs<br/>Filesystem provider seam"]
  pkg_fs_local["fs-local"]
  pkg_fs_observation_policy["fs-observation-policy"]
  pkg_compaction["compaction"]
  svc_compaction["ctx.compaction<br/>Compaction seam"]
  svc_subagents["ctx.subagents<br/>Subagent provider and continuation service"]
  pkg_subagent_spawn_in_process["subagent-spawn-in-process"]
  pkg_subagent_fork_in_process["subagent-fork-in-process"]
  pkg_subagent_avn_sdk["subagent-avn-sdk"]
  pkg_tool_subagent_control["tool-subagent-control"]
  pkg_tool_ralph["tool-ralph"]
  pkg_experimental_agent_team["experimental-agent-team"]
  svc_agentTeams["ctx.agentTeams<br/>Agent Teams coordination domain"]
  pkg_experimental_tool_agent_team["experimental-tool-agent-team"]
  pkg_experimental_client_ui_agent_team["experimental-client-ui-agent-team"]
  pkg_inspector["inspector"]
  svc_inspector["ctx.inspector<br/>Cross-realm runtime inspection"]
  pkg_jobs["jobs"]
  svc_jobs["ctx.jobs<br/>Background job registry"]
  pkg_jobs_local["jobs-local"]
  pkg_tool_jobs["tool-jobs"]
  pkg_web["web"]
  svc_web["ctx.web<br/>Web access provider registry"]
  pkg_web_search_exa["web-search-exa"]
  pkg_web_search_perplexity["web-search-perplexity"]
  pkg_web_search_deepseek["web-search-deepseek"]
  pkg_web_fetch_http["web-fetch-http"]
  pkg_spill["spill"]
  svc_spillStore["ctx.spillStore<br/>Spill storage seam"]
  pkg_spill_local["spill-local"]
  pkg_spill_policy["spill-policy"]
  pkg_host_directory_picker["host-directory-picker"]
  svc_directoryPicker["ctx.directoryPicker<br/>Workspace-directory picking seam"]
  pkg_host_directory_picker_native["host-directory-picker-native"]
  pkg_host_directory_picker_browse["host-directory-picker-browse"]
  pkg_host_webserver["host-webserver"]
  svc_webServer["ctx.webServer<br/>HTTP route registration"]
  pkg_client_modules["client-modules"]
  pkg_client_hmr["client-hmr"]
  svc_clientModules["ctx.clientModules<br/>Client plugin graph host"]
  pkg_workflow["workflow"]
  svc_workflowEngine["ctx.workflowEngine<br/>Workflow script engine"]
  pkg_workflow_worker_thread["workflow-worker-thread"]
  pkg_tool_workflow["tool-workflow"]
  pkg_webhook["webhook"]
  svc_webhookRuntime["ctx.webhookRuntime<br/>Webhook rule runtime"]
  pkg_webhook_github["webhook-github"]
  pkg_lsp["lsp"]
  svc_lsp["ctx.lsp<br/>Language-server navigation seam"]
  pkg_tool_lsp["tool-lsp"]
  pkg_cordis_host_runner["cordis-host-runner"]
  svc_dynamicCordisRunner["ctx.dynamicCordisRunner<br/>Dynamic Cordis package host runner"]
  svc_cordisInspect["ctx.cordisInspect<br/>Dynamic Cordis inspect registry"]
  pkg_account_integrations["account-integrations"]
  svc_accountIntegrations["ctx.accountIntegrations<br/>Connector account registry"]
  pkg_ui_automations["ui-automations"]
  pkg_ui_settings_integrations["ui-settings-integrations"]
  pkg_automations["automations"]
  svc_automations["ctx.automations<br/>Built-in local automation authority"]
  pkg_browser_chromium["browser-chromium"]
  svc_browserChromium["ctx.browserChromium<br/>Host Chromium launcher"]
  pkg_capability["capability"]
  svc_capabilities["ctx.capabilities<br/>Learned capability registry"]
  pkg_api_memory_manager["api-memory-manager"]
  pkg_tool_capability["tool-capability"]
  pkg_device["device"]
  svc_devices["ctx.devices<br/>Device sessions and control"]
  pkg_device_local["device-local"]
  pkg_tool_device["tool-device"]
  pkg_document_extract["document-extract"]
  svc_documentExtract["ctx.documentExtract<br/>Document extraction registry"]
  pkg_document_extract_js["document-extract-js"]
  pkg_document_extract_ocr["document-extract-ocr"]
  pkg_document_extract_office["document-extract-office"]
  pkg_session_controller["session-controller"]
  pkg_job_controller["job-controller"]
  svc_jobController["ctx.jobController<br/>Background-job Remote owner"]
  pkg_ui_jobs["ui-jobs"]
  pkg_mail["mail"]
  svc_mail["ctx.mail<br/>Mail accounts and operations"]
  pkg_tool_mail["tool-mail"]
  pkg_memory["memory"]
  svc_memory["ctx.memory<br/>Long-term memory"]
  pkg_memory_memos["memory-memos"]
  pkg_memory_context["memory-context"]
  pkg_tool_memory["tool-memory"]
  svc_memoryManagerController["ctx.memoryManagerController<br/>Memory manager Remote"]
  pkg_ui_settings_memory["ui-settings-memory"]
  pkg_sync["sync"]
  svc_sync["ctx.sync<br/>Account sync"]
  pkg_sync_yjs["sync-yjs"]
  pkg_personalization["personalization"]
  pkg_session_sync["session-sync"]
  pkg_sync_controller["sync-controller"]
  svc_syncController["ctx.syncController<br/>Sync Remote"]
  pkg_ui_settings_sync["ui-settings-sync"]
  svc_personalizationController["ctx.personalizationController<br/>Personalization store and prompt section"]
  pkg_ui_settings_personalization["ui-settings-personalization"]
  pkg_skill_catalog["skill-catalog"]
  svc_skillCatalog["ctx.skillCatalog<br/>Vendored skill catalog"]
  pkg_api_speech_to_text["api-speech-to-text"]
  svc_speechController["ctx.speechController<br/>Speech Remote"]
  pkg_ui_voice_input["ui-voice-input"]
  pkg_speech_to_text["speech-to-text"]
  svc_speechToText["ctx.speechToText<br/>Transcription provider registry"]
  pkg_speech_to_text_whisper["speech-to-text-whisper"]
  pkg_terminal_controller["terminal-controller"]
  svc_terminalController["ctx.terminalController<br/>Terminal Remote"]
  pkg_ui_sidebar_terminal["ui-sidebar-terminal"]
  pkg_workspace_files["workspace-files"]
  svc_workspaceFiles["ctx.workspaceFiles<br/>Workspace file Remote"]
  pkg_ui_sidebar_files["ui-sidebar-files"]
  pkg_account_integrations --> svc_accountIntegrations
  pkg_account_integrations --> svc_mail
  pkg_agent --> svc_agents
  pkg_agent_default_model --> svc_agentDefaultModel
  pkg_agent_loop --> svc_agentLoop
  pkg_agent_presets --> svc_agentPresets
  pkg_api_gateway --> svc_typertGateway
  pkg_api_memory_manager --> svc_memoryManagerController
  pkg_api_session_controller --> svc_sessionController
  pkg_api_session_controller --> svc_sessionFileReferences
  pkg_api_session_controller --> svc_sessionSkillCatalog
  pkg_api_settings_controller --> svc_credentialsController
  pkg_api_settings_controller --> svc_settingsController
  pkg_api_speech_to_text --> svc_speechController
  pkg_api_workspace_controller --> svc_directoryPickerController
  pkg_api_workspace_controller --> svc_workspaceController
  pkg_attachment --> svc_attachments
  pkg_attachment_local --> svc_attachments
  pkg_authorization --> svc_authorization
  pkg_automations --> svc_automations
  pkg_bash_local --> svc_shell
  pkg_bash_sandbox --> svc_shell
  pkg_browser_chromium --> svc_browserChromium
  pkg_capability --> svc_capabilities
  pkg_client_modules --> svc_clientModules
  pkg_code_runtime --> svc_codeRuntime
  pkg_code_runtime_worker_thread --> svc_codeRuntime
  pkg_commands --> svc_commands
  pkg_compaction --> svc_compaction
  pkg_compaction_basic --> svc_compaction
  pkg_compaction_tool_result_pruner --> svc_toolResultPruner
  pkg_computer_use --> svc_computerUse
  pkg_computer_use --> svc_computerUseProvider
  pkg_computer_use --> svc_windowsComputerUseProvider
  pkg_computer_use_cua_driver_mcp --> svc_computerUse
  pkg_computer_use_macos_provider --> svc_computerUseProvider
  pkg_computer_use_windows_provider --> svc_windowsComputerUseProvider
  pkg_cordis_host_runner --> svc_cordisInspect
  pkg_cordis_host_runner --> svc_dynamicCordisRunner
  pkg_credentials --> svc_credentials
  pkg_credentials_local --> svc_credentials
  pkg_deepseek_llm_api_extensions --> svc_deepseekLlmApiExtensions
  pkg_device --> svc_devices
  pkg_device_local --> svc_devices
  pkg_document_extract --> svc_documentExtract
  pkg_document_extract_js --> svc_documentExtract
  pkg_document_extract_ocr --> svc_documentExtract
  pkg_document_extract_office --> svc_documentExtract
  pkg_e2b --> svc_e2b
  pkg_experimental_agent_team --> svc_agentTeams
  pkg_experimental_code_runtime_python --> svc_codeRuntime
  pkg_file_reference --> svc_fileReferences
  pkg_file_reference_local --> svc_fileReferences
  pkg_fs --> svc_fs
  pkg_fs_e2b --> svc_fs
  pkg_fs_local --> svc_fs
  pkg_fs_sandbox --> svc_fs
  pkg_goal --> svc_goals
  pkg_host_directory_picker --> svc_directoryPicker
  pkg_host_directory_picker_browse --> svc_directoryPicker
  pkg_host_directory_picker_native --> svc_directoryPicker
  pkg_host_webserver --> svc_webServer
  pkg_identity_user --> svc_identityUsers
  pkg_identity_user_aeven --> svc_identityUsers
  pkg_inspector --> svc_inspector
  pkg_invariants --> svc_invariants
  pkg_job_controller --> svc_jobController
  pkg_jobs --> svc_jobs
  pkg_jobs_local --> svc_jobs
  pkg_llm --> svc_llm
  pkg_llm_deepseek --> svc_llm
  pkg_llm_pi_ai --> svc_llm
  pkg_llm_replay --> svc_llm
  pkg_lsp --> svc_lsp
  pkg_lsp_stdio --> svc_lsp
  pkg_mail --> svc_mail
  pkg_media --> svc_media
  pkg_media_aeven --> svc_media
  pkg_media_deepinfra --> svc_media
  pkg_media_openrouter --> svc_media
  pkg_media_pi_ai --> svc_media
  pkg_memory --> svc_memory
  pkg_memory_memos --> svc_memory
  pkg_message_feedback --> svc_messageFeedback
  pkg_permission_presets --> svc_permissionPresets
  pkg_personalization --> svc_personalizationController
  pkg_plan_mode --> svc_planMode
  pkg_plugin_package_inventory_deepseek --> svc_deepseekLlmApiExtensions
  pkg_pwsh_local --> svc_shell
  pkg_sandbox --> svc_sandbox
  pkg_sandbox_local --> svc_sandbox
  pkg_sandbox_policy --> svc_sandboxPolicy
  pkg_session --> svc_sessions
  pkg_session_log_deepseek --> svc_deepseekLlmApiExtensions
  pkg_session_persistence --> svc_sessionPersistence
  pkg_session_persistence_jsonl --> svc_sessionPersistence
  pkg_session_projection --> svc_sessionProjections
  pkg_session_projection_cache --> svc_sessionProjectionCache
  pkg_session_query --> svc_sessionQuery
  pkg_session_query_sqlite --> svc_sessionQuery
  pkg_session_reference --> svc_sessionReferenceResolver
  pkg_session_telemetry --> svc_sessionTelemetry
  pkg_session_telemetry_otel --> svc_sessionTelemetry
  pkg_session_title --> svc_sessionTitle
  pkg_session_title_all_prompts_llm --> svc_sessionTitle
  pkg_session_title_first_prompt_llm --> svc_sessionTitle
  pkg_settings --> svc_settings
  pkg_settings_file --> svc_settings
  pkg_shell --> svc_shell
  pkg_shell_env --> svc_shellEnv
  pkg_skill --> svc_skills
  pkg_skill_badge --> svc_skills
  pkg_skill_catalog --> svc_skillCatalog
  pkg_skill_filesystem --> svc_skills
  pkg_speech_to_text --> svc_speechToText
  pkg_speech_to_text_whisper --> svc_speechToText
  pkg_spill --> svc_spillStore
  pkg_spill_local --> svc_spillStore
  pkg_storage --> svc_storage
  pkg_storage_domain --> svc_storageDomain
  pkg_storage_json --> svc_storage
  pkg_storage_sqlite --> svc_storage
  pkg_subagent --> svc_subagents
  pkg_subagent_acp --> svc_subagents
  pkg_subagent_avn_sdk --> svc_subagents
  pkg_subagent_claude_code --> svc_subagents
  pkg_subagent_codex --> svc_subagents
  pkg_subagent_fork_in_process --> svc_subagents
  pkg_subagent_spawn_in_process --> svc_subagents
  pkg_subprocess --> svc_subprocess
  pkg_subprocess_e2b --> svc_subprocess
  pkg_subprocess_local --> svc_subprocess
  pkg_sync --> svc_sync
  pkg_sync_controller --> svc_syncController
  pkg_sync_yjs --> svc_sync
  pkg_system_prompt --> svc_systemPrompt
  pkg_terminal --> svc_terminals
  pkg_terminal_bash --> svc_terminals
  pkg_terminal_controller --> svc_terminalController
  pkg_token_meter --> svc_tokenMeter
  pkg_tool_subagent --> svc_subagentModelSelection
  pkg_tools --> svc_tools
  pkg_typert_registry --> svc_typert
  pkg_user_approval --> svc_approval
  pkg_user_questions --> svc_userQuestions
  pkg_web --> svc_web
  pkg_web_fetch_http --> svc_web
  pkg_web_search_deepseek --> svc_web
  pkg_web_search_exa --> svc_web
  pkg_web_search_perplexity --> svc_web
  pkg_webhook --> svc_webhookRuntime
  pkg_workflow --> svc_workflowEngine
  pkg_workflow_worker_thread --> svc_workflowEngine
  pkg_working_directory --> svc_workingDirectory
  pkg_workspace --> svc_workspaceRegistry
  pkg_workspace_files --> svc_workspaceFiles
  pkg_worktrees --> svc_worktrees
  svc_accountIntegrations --> pkg_ui_automations
  svc_accountIntegrations --> pkg_ui_settings_integrations
  svc_agentDefaultModel --> pkg_api_session_controller
  svc_agentDefaultModel --> pkg_headless
  svc_agentLoop --> pkg_base
  svc_agentLoop --> pkg_sdk_minimal
  svc_agentTeams --> pkg_experimental_client_ui_agent_team
  svc_agentTeams --> pkg_experimental_tool_agent_team
  svc_agents --> pkg_acp
  svc_agents --> pkg_agent_loop
  svc_agents --> pkg_subagent_in_process_driver
  svc_approval --> pkg_acp
  svc_approval --> pkg_tool_bash
  svc_approval --> pkg_tools
  svc_attachments --> pkg_api_session_controller
  svc_attachments --> pkg_llm_deepseek
  svc_attachments --> pkg_llm_pi_ai
  svc_attachments --> pkg_tool_fs
  svc_authorization --> pkg_llm_pi_ai
  svc_automations --> pkg_ui_automations
  svc_capabilities --> pkg_api_memory_manager
  svc_capabilities --> pkg_tool_capability
  svc_clientModules --> pkg_client_hmr
  svc_codeRuntime --> pkg_tools
  svc_compaction --> pkg_compaction_basic
  svc_cordisInspect --> pkg_tool_cordis
  svc_credentials --> pkg_api_settings_controller
  svc_credentials --> pkg_llm_deepseek
  svc_credentials --> pkg_llm_pi_ai
  svc_deepseekLlmApiExtensions --> pkg_llm_deepseek
  svc_devices --> pkg_tool_device
  svc_directoryPicker --> pkg_api_workspace_controller
  svc_documentExtract --> pkg_session_controller
  svc_dynamicCordisRunner --> pkg_tool_cordis
  svc_e2b --> pkg_fs_e2b
  svc_e2b --> pkg_subprocess_e2b
  svc_fileReferences --> pkg_api_session_controller
  svc_fs --> pkg_tool_fs
  svc_identityUsers --> pkg_client_connection
  svc_invariants --> pkg_agent
  svc_invariants --> pkg_agent_loop
  svc_invariants --> pkg_scope
  svc_invariants --> pkg_session
  svc_jobController --> pkg_ui_jobs
  svc_jobs --> pkg_tool_bash
  svc_jobs --> pkg_tool_jobs
  svc_jobs --> pkg_tool_subagent
  svc_jobs --> pkg_tool_terminal
  svc_llm --> pkg_agent_loop
  svc_llm --> pkg_compaction_basic
  svc_lsp --> pkg_tool_lsp
  svc_mail --> pkg_tool_mail
  svc_memory --> pkg_api_memory_manager
  svc_memory --> pkg_memory_context
  svc_memory --> pkg_memory_memos
  svc_memory --> pkg_tool_capability
  svc_memory --> pkg_tool_memory
  svc_memoryManagerController --> pkg_ui_settings_memory
  svc_personalizationController --> pkg_ui_settings_personalization
  svc_sandbox --> pkg_bash_sandbox
  svc_sandbox --> pkg_terminal_bash
  svc_sandboxPolicy --> pkg_bash_sandbox
  svc_sandboxPolicy --> pkg_fs_sandbox
  svc_sandboxPolicy --> pkg_terminal_bash
  svc_sessionPersistence --> pkg_agent_loop
  svc_sessionPersistence --> pkg_hooks_claude_code
  svc_sessionPersistence --> pkg_hooks_codex
  svc_sessionPersistence --> pkg_message_feedback
  svc_sessionPersistence --> pkg_session_query
  svc_sessionPersistence --> pkg_session_query_sqlite
  svc_sessionPersistence --> pkg_tool_bash
  svc_sessionProjectionCache --> pkg_api_session_controller
  svc_sessionProjectionCache --> pkg_session_query
  svc_sessionProjectionCache --> pkg_session_reference
  svc_sessionProjectionCache --> pkg_subagent
  svc_sessionProjections --> pkg_api_session_controller
  svc_sessionProjections --> pkg_session_title
  svc_sessionProjections --> pkg_tool_todo
  svc_sessionQuery --> pkg_session_reference
  svc_sessionQuery --> pkg_tool_session_query
  svc_sessions --> pkg_agent
  svc_sessions --> pkg_agent_loop
  svc_sessions --> pkg_invariants
  svc_sessions --> pkg_message_feedback
  svc_sessions --> pkg_session_persistence
  svc_sessions --> pkg_session_query
  svc_sessions --> pkg_session_query_sqlite
  svc_sessions --> pkg_subagent_in_process_driver
  svc_settings --> pkg_api_settings_controller
  svc_settings --> pkg_llm_deepseek
  svc_settings --> pkg_llm_pi_ai
  svc_shell --> pkg_hooks_claude_code
  svc_shell --> pkg_hooks_codex
  svc_shell --> pkg_tool_bash
  svc_shell --> pkg_tool_pwsh
  svc_shellEnv --> pkg_tool_bash
  svc_shellEnv --> pkg_tool_pwsh
  svc_skillCatalog --> pkg_account_integrations
  svc_skills --> pkg_tool_skill
  svc_speechController --> pkg_ui_voice_input
  svc_speechToText --> pkg_api_speech_to_text
  svc_spillStore --> pkg_spill_policy
  svc_storage --> pkg_storage_domain
  svc_storageDomain --> pkg_message_feedback
  svc_storageDomain --> pkg_workspace
  svc_subagentModelSelection --> pkg_tool_subagent
  svc_subagents --> pkg_tool_ralph
  svc_subagents --> pkg_tool_subagent
  svc_subagents --> pkg_tool_subagent_control
  svc_subprocess --> pkg_bash_local
  svc_subprocess --> pkg_bash_sandbox
  svc_subprocess --> pkg_lsp_stdio
  svc_subprocess --> pkg_subagent_acp
  svc_subprocess --> pkg_subagent_claude_code
  svc_subprocess --> pkg_subagent_codex
  svc_subprocess --> pkg_terminal_bash
  svc_sync --> pkg_memory_memos
  svc_sync --> pkg_personalization
  svc_sync --> pkg_session_sync
  svc_sync --> pkg_sync_controller
  svc_syncController --> pkg_ui_settings_sync
  svc_systemPrompt --> pkg_agent_loop
  svc_systemPrompt --> pkg_tool_fs
  svc_systemPrompt --> pkg_tool_terminal
  svc_systemPrompt --> pkg_tool_web
  svc_systemPrompt --> pkg_tools
  svc_terminalController --> pkg_ui_sidebar_terminal
  svc_terminals --> pkg_tool_terminal
  svc_tokenMeter --> pkg_compaction_basic
  svc_toolResultPruner --> pkg_compaction_basic
  svc_tools --> pkg_agent_loop
  svc_tools --> pkg_tool_ask_user
  svc_tools --> pkg_tool_bash
  svc_tools --> pkg_tool_cordis
  svc_tools --> pkg_tool_fs
  svc_tools --> pkg_tool_skill
  svc_tools --> pkg_tool_subagent
  svc_tools --> pkg_tool_terminal
  svc_tools --> pkg_tool_todo
  svc_tools --> pkg_tool_web
  svc_typert --> pkg_api_gateway
  svc_typert --> pkg_typert_loader
  svc_userQuestions --> pkg_tool_ask_user
  svc_web --> pkg_tool_web
  svc_webServer --> pkg_client_connection
  svc_webServer --> pkg_client_hmr
  svc_webServer --> pkg_client_modules
  svc_webhookRuntime --> pkg_webhook_github
  svc_workflowEngine --> pkg_tool_ralph
  svc_workflowEngine --> pkg_tool_workflow
  svc_workingDirectory --> pkg_tool_bash
  svc_workingDirectory --> pkg_tool_bash_persistent
  svc_workingDirectory --> pkg_tool_pwsh
  svc_workingDirectory --> pkg_tool_pwsh_persistent
  svc_workingDirectory --> pkg_tool_working_directory
  svc_workspaceFiles --> pkg_ui_sidebar_files
  svc_workspaceRegistry --> pkg_api_session_controller
  svc_workspaceRegistry --> pkg_api_workspace_controller
  svc_worktrees --> pkg_tool_worktrees
  svc_fs -. event gate .-> pkg_fs_observation_policy
```
| ctx 键 | 角色 | 所属包 | 实现 | 直接消费方 | 配套插件 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `ctx.identityUsers` | `seam` | [`identity-user`](../packages/identity/user) | [`identity-user-aeven`](../packages/identity/user-aeven) | [`client-connection`](../packages/client/connection) | - | Authorities resolve a request's credential headers to a user synchronously; the request fence consults the seam before dispatch and answers 401 when nobody is recognized. authority 会同步地把请求的凭据 header 解析为用户；请求围栏在派发之前调用该 seam，无人被认得时回答 401。 |
| `ctx.media` | `seam` | [`media`](../packages/media/media) | [`media-aeven`](../packages/media/media-aeven), [`media-deepinfra`](../packages/media/media-deepinfra), [`media-openrouter`](../packages/media/media-openrouter), [`media-pi-ai`](../packages/media/media-pi-ai) | - | - | One service spans both media: images return bytes directly, while video is a job a caller starts, polls, and fetches. Consumers own every model-facing name and schema. 一个服务横跨两种媒体：图像直接返回字节，而视频是调用方启动、轮询并取回的任务。模型看到的每个名称与 schema 都由 Consumer 负责。 |
| `ctx.computerUse` | `seam` | [`computer-use`](../packages/computer-use/computer-use) | [`computer-use-cua-driver-mcp`](../packages/computer-use/computer-use-cua-driver-mcp) | - | - | The registry holds one optional provider slot for the shared computer-use service; the Cua Driver MCP adapter reserves it and exposes the driver's own tools through the shared tool runtime, releasing the slot with them. 注册表为共享的 computer-use 服务保留唯一的可选提供方槽位；Cua Driver MCP 适配器占用该槽位，并通过共享工具运行时暴露驱动自身的工具，释放时一并注销。 |
| `ctx.computerUseProvider` | `core` | [`computer-use`](../packages/computer-use/computer-use) | [`computer-use-macos-provider`](../packages/computer-use/computer-use-macos-provider) | - | - | The provider a platform adapter published, addressed as `ctx.computerUseProvider` by the surfaces that run its tasks. The slot on that seam is what keeps it single: the adapter claims the slot before publishing, so a second provider fails with the name of the one already registered. 平台适配器发布的提供方，由运行其任务的表层以 `ctx.computerUseProvider` 寻址。该 seam 上的槽位保证它只有一个：适配器在发布前先占用槽位，因此第二个提供方会带着已注册者的名字失败。 |
| `ctx.windowsComputerUseProvider` | `core` | [`computer-use`](../packages/computer-use/computer-use) | [`computer-use-windows-provider`](../packages/computer-use/computer-use-windows-provider) | - | - | The Windows provider, addressed as `ctx.windowsComputerUseProvider`. It carries its own name because Cordis declares a service by augmenting `Context`, and one property cannot hold two provider types in one program; the seam's slot, not the property name, is what keeps a host to one provider. Windows 提供方，以 `ctx.windowsComputerUseProvider` 寻址。它使用自己的名字，是因为 Cordis 通过扩展 `Context` 来声明服务，而同一个属性无法在同一个程序中持有两种提供方类型；让一台主机只保留一个提供方的是该 seam 的槽位，而不是属性名。 |
| `ctx.attachments` | `seam` | [`attachment`](../packages/attachment/attachment) | [`attachment-local`](../packages/attachment/attachment-local) | [`api-session-controller`](../packages/api/session-controller), [`tool-fs`](../packages/fs/tool-fs), [`llm-pi-ai`](../packages/llm/llm-pi-ai), [`llm-deepseek`](../packages/llm/llm-deepseek) | - | The host commits accepted images before session events; provider adapters resolve authorized durable references into provider-native content. 宿主会在会话事件之前提交已接受的图片；提供方适配器将已授权的持久引用解析为提供方原生内容。 |
| `ctx.llm` | `seam` | [`llm`](../packages/llm/llm) | [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai), [`llm-replay`](../packages/test-support/llm-replay) | [`agent-loop`](../packages/core/agent-loop), [`compaction-basic`](../packages/compaction/compaction-basic) | - | Adapters register provider implementations; the loop and compaction call the provider-neutral stream service. 适配器注册提供方实现；agent loop（智能体循环）与压缩功能调用提供方无关的流服务。 |
| `ctx.deepseekLlmApiExtensions` | `seam` | [`deepseek-llm-api-extensions`](../packages/llm/deepseek-llm-api-extensions) | [`session-log-deepseek`](../packages/session/session-log-deepseek), [`plugin-package-inventory-deepseek`](../packages/llm/plugin-package-inventory-deepseek) | [`llm-deepseek`](../packages/llm/llm-deepseek) | - | Plugins prepare independent top-level fields; the official adapter merges them and commits their delivery state after HTTP acceptance. 插件准备彼此独立的顶层字段；官方适配器会合并这些字段，并在 HTTP 接受后提交其交付状态。 |
| `ctx.tokenMeter` | `core` | [`token-meter`](../packages/llm/token-meter) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | Owns isolated per-session replay folds; pressure consumers share immutable revisioned measurements. 拥有按会话隔离的回放折叠区；压力消费方共享不可变且带修订版本的测量结果。 |
| `ctx.toolResultPruner` | `core` | [`compaction-tool-result-pruner`](../packages/compaction/compaction-tool-result-pruner) | - | [`compaction-basic`](../packages/compaction/compaction-basic) | - | Rewrites oversized current tool results through replayable single-node surface replacements before summary compaction. 在摘要压缩前，通过可回放的单节点表层替换来改写过大的当前工具结果。 |
| `ctx.sessions` | `core` | [`session`](../packages/core/session) | - | [`agent-loop`](../packages/core/agent-loop), [`agent`](../packages/core/agent), [`session-persistence`](../packages/session/session-persistence), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`subagent-in-process-driver`](../packages/subagent/subagent-in-process-driver), [`invariants`](../packages/runtime-diagnostics/invariants), [`message-feedback`](../packages/feedback/message-feedback) | - | Owns append-only Session instances and emits the durable session event feed. 拥有仅追加的 Session 实例，并发出持久的会话事件流。 |
| `ctx.sessionController` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | Owns Session commands, cold reads, durable-event following, live control state, model catalogs, workspace opening, and Agent activation policy. 负责 Session 命令、冷读取、持久事件跟随、实时控制状态、模型目录、workspace 打开与 Agent 激活策略。 |
| `ctx.sessionFileReferences` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | Delegates file-reference discovery through the Session Controller's established Agent lookup policy. 通过 Session Controller 的既有 Agent lookup 策略委托文件引用发现。 |
| `ctx.sessionSkillCatalog` | `core` | [`api-session-controller`](../packages/api/session-controller) | - | - | - | Lists the Session composition's user-invocable skills without activating a cold Agent. 在不激活冷 Agent 的前提下列出 Session 组合中允许用户调用的 skill。 |
| `ctx.credentialsController` | `core` | [`api-settings-controller`](../packages/api/settings-controller) | - | - | - | Projects the credential-reference seam onto the generated Remote namespace: batch fan-out, view projection, and refusal mapping live here, not on the seam Definition. 把凭据引用 seam 投影到生成的 Remote namespace：批量扇出、视图投影与拒绝映射都在这里，而不在 seam Definition 上。 |
| `ctx.settingsController` | `core` | [`api-settings-controller`](../packages/api/settings-controller) | - | - | - | Projects the user-settings seam onto the generated Remote namespace: the read is always redacted and every refusal is classified here, not on the seam Definition. 把用户设置 seam 投影到生成的 Remote namespace：读取一律脱敏，所有拒绝在这里分类，而不在 seam Definition 上。 |
| `ctx.workspaceController` | `core` | [`api-workspace-controller`](../packages/api/workspace-controller) | - | - | - | Owns Workspace commands and reconnect-safe Workspace state delivery through the generated Remote namespace. 通过生成的 Remote namespace 负责 Workspace 命令和可在重连后收敛的 Workspace 状态投递。 |
| `ctx.directoryPickerController` | `core` | [`api-workspace-controller`](../packages/api/workspace-controller) | - | - | - | Carries the picking seam onto the wire: capability gating, cancellation, and the seam-coded failures a browser directory flow discriminates on. 把选目录 seam 送上线：能力门禁、取消传播，以及浏览器目录流程用于分支判断的 seam 错误码。 |
| `ctx.invariants` | `core` | [`invariants`](../packages/runtime-diagnostics/invariants) | - | [`session`](../packages/core/session), [`agent`](../packages/core/agent), [`scope`](../packages/core/scope), [`agent-loop`](../packages/core/agent-loop) | - | Companion subpaths register owner-local checks; the service owns selection, uniqueness, child fibers, and package-attributed failures. 配套子路径注册所属包本地的检查；该服务负责选择、唯一性、子 fiber，以及标明所属包的失败。 |
| `ctx.typert` | `core` | [`typert-registry`](../packages/typert/registry) | - | [`typert-loader`](../packages/typert/loader), [`api-gateway`](../packages/api/gateway) | - | Plugins register live zod contributions directly or through avn-typert-loader; the API gateway consumes invocation descriptors and providers, while other runtime consumers query schemas and reflection metadata at their own edges. 插件直接或通过 avn-typert-loader 注册实时 zod 贡献；API 网关消费调用描述符和提供方，其他运行时消费方则在各自边界查询 schema 与反射元数据。 |
| `ctx.typertGateway` | `core` | [`api-gateway`](../packages/api/gateway) | - | - | - | Associates generated Remote descriptors with live Cordis services, resolves registered identities, and exposes unary calls through the shared Connection RPC carrier. 将生成的 Remote 描述符与实时 Cordis 服务关联，解析已注册的身份，并通过共享的 Connection RPC 载体提供一元调用。 |
| `ctx.sessionPersistence` | `seam` | [`session-persistence`](../packages/session/session-persistence) | [`session-persistence-jsonl`](../packages/session/session-persistence-jsonl) | [`agent-loop`](../packages/core/agent-loop), [`tool-bash`](../packages/shell/tool-bash), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex), [`session-query`](../packages/session-query/session-query), [`session-query-sqlite`](../packages/session-query/session-query-sqlite), [`message-feedback`](../packages/feedback/message-feedback) | - | The JSONL backend persists the SessionEvent vocabulary as one artifact per Session. JSONL backend 把 SessionEvent 词汇持久化为每个 Session 一份产物。 |
| `ctx.settings` | `seam` | [`settings`](../packages/settings/settings) | [`settings-file`](../packages/settings/settings-file) | [`api-settings-controller`](../packages/api/settings-controller), [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | Plugins register namespace schemas and resolve layered values; providers store the raw document. The LLM adapters register their entry config as the composition base under the user section; the settings controller serves redacted layered descriptors and writes the user layer. 插件注册命名空间 schema 并解析分层值；提供方存储原始文档。LLM（大语言模型）适配器在用户分区下将其入口配置注册为组合基础；settings controller 提供经过脱敏的分层描述符，并写入用户层。 |
| `ctx.subagentModelSelection` | `core` | [`tool-subagent`](../packages/subagent/tool-subagent) | - | [`tool-subagent`](../packages/subagent/tool-subagent) | - | Owns the default-off settings namespace that Agent-scoped delegation tools sample when composing a new top-level Session. 拥有默认关闭的设置命名空间；Agent 作用域的委派工具会在组合新顶层 Session 时读取它。 |
| `ctx.credentials` | `seam` | [`credentials`](../packages/credentials/credentials) | [`credentials-local`](../packages/credentials/credentials-local) | [`api-settings-controller`](../packages/api/settings-controller), [`llm-deepseek`](../packages/llm/llm-deepseek), [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | Configuration carries references to secrets; providers own the values. Consumers resolve per operation, so a rotated credential reaches the very next request; the settings controller exposes value-free views and write-only storage. 配置携带对机密信息的引用；提供方拥有实际值。消费方按操作解析，因此轮换后的凭据会在紧接着的下一次请求中生效；settings controller 提供不含实际值的视图和只写存储。 |
| `ctx.authorization` | `seam` | [`authorization`](../packages/credentials/authorization) | - | [`llm-pi-ai`](../packages/llm/llm-pi-ai) | - | Flows are registered by the plugin that knows how to obtain one credential and keyed by the record they write; the seam owns the conversation and the one-attempt-per-key lifecycle, never the protocol. flow 由知道如何取得某份凭据的插件注册，并以其写入的记录为键；seam 拥有这段对话与"每个键同时只跑一次尝试"的生命周期，而非协议本身。 |
| `ctx.sessionTelemetry` | `seam` | [`session-telemetry`](../packages/session/session-telemetry) | [`session-telemetry-otel`](../packages/session/session-telemetry-otel) | - | - | The seam captures, redacts, and hands session records to one backend; nothing else consumes the service — its output leaves the process. 该 seam 捕获会话记录、进行脱敏并交给一个后端；没有其他组件消费该服务，其输出会离开当前进程。 |
| `ctx.storage` | `seam` | [`storage`](../packages/storage/storage) | [`storage-json`](../packages/storage/storage-json), [`storage-sqlite`](../packages/storage/storage-sqlite) | [`storage-domain`](../packages/storage/storage-domain) | - | Backends register side by side under names; data forms (domain first) mount on the hub and translate typed operations into opaque KV-unit primitives. 各后端以不同名称并列注册；数据形态（领域优先）挂载到枢纽上，并将类型化操作转换为不透明的 KV 单元原语。 |
| `ctx.storageDomain` | `core` | [`storage-domain`](../packages/storage/storage-domain) | - | [`workspace`](../packages/workspace/workspace), [`message-feedback`](../packages/feedback/message-feedback) | - | Waits for every configured backend, then publishes the domain form as one lifecycle-bound service for typed durable state. 等待所有已配置后端就绪，然后将领域形态发布为一个受生命周期约束的服务，用于类型化持久状态。 |
| `ctx.messageFeedback` | `core` | [`message-feedback`](../packages/feedback/message-feedback) | - | - | - | Owns local per-assistant-message feedback, lifecycle and target validation, per-item compare-and-set, and the Host unary Remote contract without entering Session history or telemetry. 拥有本地逐 assistant 消息反馈、生命周期与目标校验、逐条目 compare-and-set 及 Host 一元 Remote 契约，且不进入 Session 历史或遥测。 |
| `ctx.workspaceRegistry` | `core` | [`workspace`](../packages/workspace/workspace) | - | [`api-workspace-controller`](../packages/api/workspace-controller), [`api-session-controller`](../packages/api/session-controller) | - | Owns WorkspaceId-branded records over the domain facility; stable sessionIds accounts drive Host RPC and GUI projections. 通过领域设施拥有带 WorkspaceId 品牌类型的记录；稳定的 sessionIds 账户驱动 Host RPC 与 GUI 投影。 |
| `ctx.sessionQuery` | `seam` | [`session-query`](../packages/session-query/session-query) | [`session-query-sqlite`](../packages/session-query/session-query-sqlite) | [`session-reference`](../packages/context/session-reference), [`tool-session-query`](../packages/session-query/tool-session-query) | - | The interface supplies exact reads, filters, and traces; its concrete backend adds full-text reconciliation, ranking, snippets, and cursor generations, while the model consumer owns workspace authority and cursor-free rendering. 该接口提供精确读取、过滤和追踪；具体后端还提供全文协调、排序、摘要片段和游标世代，而模型消费方负责工作区权限与不含游标的渲染。 |
| `ctx.fileReferences` | `seam` | [`file-reference`](../packages/context/file-reference) | [`file-reference-local`](../packages/context/file-reference-local) | [`api-session-controller`](../packages/api/session-controller) | - | The interface returns path-only completion candidates within an Agent cwd; providers own namespace access and ranking without reading file contents. 该接口返回 Agent cwd 内仅含路径的补全候选；提供方负责命名空间访问与排序，但不读取文件内容。 |
| `ctx.sessionReferenceResolver` | `core` | [`session-reference`](../packages/context/session-reference) | - | - | - | Projects bounded current-surface conversation snapshots into durable untrusted message context; host adapters own mention syntax. 将当前表层中有界的对话快照投影为持久但不可信的消息上下文；Host 适配器负责提及语法。 |
| `ctx.sessionTitle` | `seam` | [`session-title`](../packages/session/session-title) | [`session-title-first-prompt-llm`](../packages/session/session-title-first-prompt-llm), [`session-title-all-prompts-llm`](../packages/session/session-title-all-prompts-llm) | - | - | Owns the deterministic fallback, latest-title fold, and sole optional asynchronous provider registration. 负责确定性回退、最新标题折叠区，以及唯一的可选异步提供方注册。 |
| `ctx.workingDirectory` | `seam` | [`working-directory`](../packages/session/working-directory) | - | [`tool-bash`](../packages/shell/tool-bash), [`tool-bash-persistent`](../packages/shell/tool-bash-persistent), [`tool-pwsh`](../packages/shell/tool-pwsh), [`tool-pwsh-persistent`](../packages/shell/tool-pwsh-persistent), [`tool-working-directory`](../packages/session/tool-working-directory) | - | Resolves a session's effective directory from the immutable header plus the last logged `session/cwd`; shell tools resolve their working directory through it with the header as fallback. 从不可变头部加上最后记录的 `session/cwd` 解析会话的生效目录；shell 工具通过它解析工作目录，并以头部作为回退。 |
| `ctx.worktrees` | `seam` | [`worktrees`](../packages/session/worktrees) | - | [`tool-worktrees`](../packages/session/tool-worktrees) | - | Runs `git worktree add -b <branch> <path> <rev>` through `ctx.subprocess` and then moves the session through `ctx.workingDirectory`, so a task works in its own checkout instead of the shared tree. 通过 `ctx.subprocess` 运行 `git worktree add -b <branch> <path> <rev>`，随后通过 `ctx.workingDirectory` 移动会话，使任务在自己的检出中工作而不是共享工作树。 |
| `ctx.systemPrompt` | `core` | [`system-prompt`](../packages/core/system-prompt) | - | [`agent-loop`](../packages/core/agent-loop), [`tools`](../packages/core/tools), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-web`](../packages/web/tool-web) | - | Collects prompt sections and model-facing tool schemas for each step. 为每个步骤收集提示词各部分和面向模型的工具 schema。 |
| `ctx.tools` | `core` | [`tools`](../packages/core/tools) | - | [`agent-loop`](../packages/core/agent-loop), [`tool-ask-user`](../packages/interaction/tool-ask-user), [`tool-bash`](../packages/shell/tool-bash), [`tool-cordis`](../packages/extensions/tool-cordis), [`tool-fs`](../packages/fs/tool-fs), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-skill`](../packages/skill/tool-skill), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-todo`](../packages/todo/tool-todo), [`tool-web`](../packages/web/tool-web) | - | Registers capabilities, owns PTC mode transport, and routes calls through pre-policy, monotonic guards, around dispatch, post-policy, and final-result observation. 注册能力，负责 PTC mode 传输，并让调用依次经过策略前处理、单调守卫、环绕分派、策略后处理和最终结果观测。 |
| `ctx.userQuestions` | `seam` | [`user-questions`](../packages/interaction/user-questions) | - | [`tool-ask-user`](../packages/interaction/tool-ask-user) | - | UI front ends provide the active human-answer provider; tool-ask-user pauses a tool call on the provider-neutral ask() promise. UI 前端提供当前生效的人工回答提供方；tool-ask-user 在提供方无关的 ask() promise 上暂停工具调用。 |
| `ctx.planMode` | `core` | [`plan-mode`](../packages/plan/plan-mode) | - | - | - | Folds logged plan/mode state, flushes user selections at turn boundaries, renders deployment-owned guidance, registers /plan, and keeps the plan-exit schema stable across transitions. 折叠已记录的计划／模式状态，在轮次边界刷新用户选择，渲染由部署方拥有的指导信息，注册 /plan，并在状态转换期间保持计划退出 schema 稳定。 |
| `ctx.agentPresets` | `core` | [`agent-presets`](../packages/preset/agent-presets) | - | - | - | Discovers preset directories over trusted and user-authored roots and mounts one preset cordis.yml under an agent scope during creation, rejecting a row that never activates or that publishes into the root service realm. 在受信任根目录与用户创作根目录上发现 preset 目录，并在创建期把一份 preset cordis.yml 挂载到 agent 作用域之下，拒绝始终未激活或向根服务 realm 发布服务的行。 |
| `ctx.commands` | `core` | [`commands`](../packages/interaction/commands) | - | - | - | Plugins register direct human commands without sending invocations to the model. 插件注册直接面向人的命令，而不会把调用发送给模型。 |
| `ctx.sessionProjections` | `core` | [`session-projection`](../packages/session/session-projection) | - | [`api-session-controller`](../packages/api/session-controller), [`tool-todo`](../packages/todo/tool-todo), [`session-title`](../packages/session/session-title) | - | Domains register state-driven fold units; the eager drive keeps per-session watermark states and the Session controller serves baselines and pushes changed values. 各领域注册由状态驱动的折叠单元；主动驱动过程维护每个会话的水位状态，Session controller 提供 baseline 并推送发生变化的值。 |
| `ctx.sessionProjectionCache` | `core` | [`session-projection-cache`](../packages/session/session-projection-cache) | - | [`api-session-controller`](../packages/api/session-controller), [`session-query`](../packages/session-query/session-query), [`session-reference`](../packages/context/session-reference), [`subagent`](../packages/subagent/subagent) | - | Durably checkpoints projection unit states per session (throttled + turn/end/detach mandatory points) and serves the cold-read ladder: cache row + persistence tail replay, so listings never load full logs. 按会话持久保存投影单元状态的检查点（节流检查点，以及轮次／结束／分离时的必选检查点），并提供冷读取阶梯：缓存行加持久化尾部回放，因此列表读取永远不需要加载完整日志。 |
| `ctx.skills` | `seam` | [`skill`](../packages/skill/skill) | [`skill-badge`](../packages/skill/skill-badge), [`skill-filesystem`](../packages/skill/skill-filesystem) | [`tool-skill`](../packages/skill/tool-skill) | - | Merges provider skill catalogs; tool-skill renders the session-prefix catalog and loads complete skill bodies. 合并提供方的 skill（技能）目录；tool-skill 渲染会话前缀目录，并加载完整的 skill 正文。 |
| `ctx.agents` | `core` | [`agent`](../packages/core/agent) | - | [`agent-loop`](../packages/core/agent-loop), [`acp`](../packages/acp/acp), [`subagent-in-process-driver`](../packages/subagent/subagent-in-process-driver) | - | Owns live Agent handles, the create/resume factory seam, and process-local initiator propagation. 拥有实时 Agent 句柄、创建／恢复工厂 seam，以及进程本地的发起方传播。 |
| `ctx.agentDefaultModel` | `core` | [`agent-default-model`](../packages/core/agent-default-model) | - | [`api-session-controller`](../packages/api/session-controller), [`headless`](../packages/bundle/headless) | - | Layers the default ModelSelection through settings so direct and Host-backed Agent entry points share one state owner. 通过 settings 分层默认 `ModelSelection`，让直接入口与 Host 支撑的 Agent 入口共享同一个状态所有者。 |
| `ctx.agentLoop` | `bundle` | [`agent-loop`](../packages/core/agent-loop) | - | [`base`](../packages/bundle/base), [`sdk-minimal`](../packages/bundle/sdk-minimal) | - | The one concrete loop plugin; extension packages depend on avn-agent events and services, not on this package. 唯一的具体循环插件；扩展包依赖 avn-agent 的事件和服务，而不依赖此包。 |
| `ctx.goals` | `core` | [`goal`](../packages/goal/goal) | - | - | - | Folds revisioned objective state from the session log and keeps live continuation activation process-local. 从会话日志折叠带修订版本的目标状态，并将实时延续激活保留在进程本地。 |
| `ctx.e2b` | `core` | [`e2b`](../packages/e2b/e2b) | - | [`fs-e2b`](../packages/e2b/fs-e2b), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | - | Owns one shared E2B SDK handle, remote working directory, and final sandbox disposition so both fundamental E2B providers inhabit the same Linux runtime. |
| `ctx.subprocess` | `seam` | [`subprocess`](../packages/subprocess/subprocess) | [`subprocess-local`](../packages/subprocess/subprocess-local), [`subprocess-e2b`](../packages/e2b/subprocess-e2b) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash), [`lsp-stdio`](../packages/lsp/lsp-stdio), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code) | - | The bash executors, the PTY shell backend, the LSP host, and the out-of-process ACP, Codex, and Claude Code subagent backends spawn through ctx.subprocess; the service owns process coordinates, tree/session lifetime, stdio dispositions, terminal mechanics, and kill escalation. Bash 执行器、PTY shell 后端、LSP Host，以及进程外 ACP、Codex 和 Claude Code subagent 后端都通过 ctx.subprocess 执行 spawn；该服务负责进程坐标、进程树／会话生命周期、stdio 处置、终端机制和 kill 升级。 |
| `ctx.shell` | `seam` | [`shell`](../packages/shell/shell) | [`bash-local`](../packages/shell/bash-local), [`bash-sandbox`](../packages/shell/bash-sandbox), [`pwsh-local`](../packages/shell/pwsh-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh), [`hooks-claude-code`](../packages/hooks/hooks-claude-code), [`hooks-codex`](../packages/hooks/hooks-codex) | - | The model-facing shell tools and hook bridges consume this seam; sandboxed, remote, or PowerShell executors replace bash-local without touching them. 面向模型的 shell 工具和钩子桥接消费此 seam；沙箱、远程或 PowerShell 执行器可以替换 bash-local，而无需改动这些消费方。 |
| `ctx.shellEnv` | `core` | [`shell-env`](../packages/shell/shell-env) | - | [`tool-bash`](../packages/shell/tool-bash), [`tool-pwsh`](../packages/shell/tool-pwsh) | - | Plugins declare effect-scoped AVN_* facts; each shell tool collects one trusted snapshot per execution and its executor rebuilds the namespace. 插件声明限定于 effect 作用域的 AVN_* 事实；每个 shell 工具在每次执行时收集一份可信快照，其执行器据此重建命名空间。 |
| `ctx.terminals` | `seam` | [`terminal`](../packages/terminal/terminal) | [`terminal-bash`](../packages/terminal/terminal-bash) | [`tool-terminal`](../packages/terminal/tool-terminal) | - | The registry owns exact-Agent session identity and cleanup; backends own terminal mechanics, while tool-terminal exposes the owner-scoped model tools. 注册表负责精确到 Agent 的会话身份和清理；后端负责终端机制，tool-terminal 则提供限定于所有者作用域的模型接口。 |
| `ctx.sandbox` | `seam` | [`sandbox`](../packages/sandbox/sandbox) | [`sandbox-local`](../packages/sandbox/sandbox-local) | [`bash-sandbox`](../packages/shell/bash-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | Consumers hand over the exact argv they are about to spawn; same-world backends wrap it under a per-call policy and report enforcement. 消费方交出即将执行 spawn 的确切 argv；与宿主共享文件系统和内核的后端按每次调用的策略包装该 argv，并报告强制执行情况。 |
| `ctx.sandboxPolicy` | `core` | [`sandbox-policy`](../packages/sandbox/sandbox-policy) | - | [`bash-sandbox`](../packages/shell/bash-sandbox), [`fs-sandbox`](../packages/fs/fs-sandbox), [`terminal-bash`](../packages/terminal/terminal-bash) | - | The one home for the deployment default mode + workspace root; only the sandboxed executor and provider read the service (the tool layers use the pure `sandbox/mode` fold it also exports). Both enforcing families read it so bash and fs cannot confine to different roots. 统一保存部署默认模式和工作区根目录；只有沙箱执行器和提供方读取该服务（工具层使用它同时导出的纯 `sandbox/mode` 折叠区）。两类强制执行组件都读取该服务，因此 bash 与 fs 不会限制到不同的根目录。 |
| `ctx.approval` | `seam` | [`user-approval`](../packages/interaction/user-approval) | - | [`tools`](../packages/core/tools), [`tool-bash`](../packages/shell/tool-bash), [`acp`](../packages/acp/acp) | - | One-shot permission decisions dispatched over the `approval/request` waterfall; answerers are listeners (the ACP bridge for its own agents), absence fails closed to `unavailable`. 一次性权限决策通过 `approval/request` waterfall（瀑布式事件）分派；回答方是监听器（即 ACP 为自身 agent 提供的桥接），没有回答方时以 `unavailable` 关闭失败。 |
| `ctx.permissionPresets` | `core` | [`permission-presets`](../packages/interaction/permission-presets) | - | - | - | User-facing preset table (`workspace-write`/`danger-full-access`) bundling the sandbox-mode and approval-policy knobs; a switch writes one `permission/preset` event through to both knob events. 面向用户的预设表（`workspace-write`／`danger-full-access`），将沙箱模式与审批策略选项组合在一起；一次切换会写入一个 `permission/preset` 事件，并贯通到两个选项事件。 |
| `ctx.codeRuntime` | `seam` | [`code-runtime`](../packages/code-runtime/code-runtime) | [`code-runtime-worker-thread`](../packages/code-runtime/code-runtime-worker-thread), [`experimental-code-runtime-python`](../packages/experimental/code-runtime-python) | [`tools`](../packages/core/tools) | - | Runs one model-written program against host-provided async bindings; backends differ by substrate and language (the tool registry consumes it for PTC mode). 使用 Host 提供的异步绑定运行一段由模型编写的程序；各后端采用不同的基础环境和语言（工具注册表在 PTC mode 下消费该服务）。 |
| `ctx.fs` | `seam` | [`fs`](../packages/fs/fs) | [`fs-local`](../packages/fs/fs-local), [`fs-sandbox`](../packages/fs/fs-sandbox), [`fs-e2b`](../packages/e2b/fs-e2b) | [`tool-fs`](../packages/fs/tool-fs) | [`fs-observation-policy`](../packages/fs/fs-observation-policy) | tool-fs executes read/write/edit through ctx.fs; fs-sandbox fences mutations by the shared sandbox mode; fs-observation-policy contributes observed-state checks through the fs/* event gate. tool-fs 通过 ctx.fs 执行读取／写入／编辑；fs-sandbox 按共享沙箱模式限制变更；fs-observation-policy 通过 fs/* 事件门禁贡献基于观测状态的检查。 |
| `ctx.compaction` | `seam` | [`compaction`](../packages/compaction/compaction) | [`compaction-basic`](../packages/compaction/compaction-basic) | [`compaction-basic`](../packages/compaction/compaction-basic) | - | The basic backend consumes post-step pressure and request-error recovery events; there is no model-facing compact tool. 基础后端消费步骤后的压力事件和请求错误恢复事件；不存在面向模型的压缩工具。 |
| `ctx.subagents` | `seam` | [`subagent`](../packages/subagent/subagent) | [`subagent-spawn-in-process`](../packages/subagent/subagent-spawn-in-process), [`subagent-fork-in-process`](../packages/subagent/subagent-fork-in-process), [`subagent-acp`](../packages/subagent/subagent-acp), [`subagent-codex`](../packages/subagent/subagent-codex), [`subagent-claude-code`](../packages/subagent/subagent-claude-code), [`subagent-avn-sdk`](../packages/subagent/subagent-avn-sdk) | [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-subagent-control`](../packages/subagent/tool-subagent-control), [`tool-ralph`](../packages/workflow/tool-ralph) | - | Providers implement transports; the service also owns optional Activation-based continuation orchestration, tool-subagent selects one-shot or continuable delegation, tool-subagent-control delivers follow-ups, and tool-ralph requires one fresh structured-output route. 提供方实现传输；该服务还负责可选的、基于 Activation 的延续编排，tool-subagent 选择一次性或可延续委派，tool-subagent-control 传递后续消息，而 tool-ralph 要求一条全新的结构化输出路由。 |
| `ctx.agentTeams` | `core` | [`experimental-agent-team`](../packages/experimental/agent-team) | - | [`experimental-tool-agent-team`](../packages/experimental/tool-agent-team), [`experimental-client-ui-agent-team`](../packages/experimental/client-ui-agent-team) | - | Owns the implicit-root roster, durable peer mailbox, shared task DAG, continuable-child lifecycle, and generated Team Remote methods; tool-agent-team contributes model controls and client-ui-agent-team mounts the browser contribution. 负责隐式 Root roster、持久 peer mailbox、共享任务 DAG、continuable child 生命周期与生成式 Team Remote method；tool-agent-team 提供模型控制工具，client-ui-agent-team 挂载浏览器 contribution。 |
| `ctx.inspector` | `core` | `inspector` | - | - | - | Owns the Worker-hosted CDP target and the transport-independent Host and Client observation and Cordis-tree query API. 负责 Worker 托管的 CDP target，以及独立于传输的 Host 和 Client observation 与 Cordis tree query API。 |
| `ctx.jobs` | `seam` | [`jobs`](../packages/jobs/jobs) | [`jobs-local`](../packages/jobs/jobs-local) | [`tool-bash`](../packages/shell/tool-bash), [`tool-terminal`](../packages/terminal/tool-terminal), [`tool-subagent`](../packages/subagent/tool-subagent), [`tool-jobs`](../packages/jobs/tool-jobs) | - | Producers (background bash, PTY sends, and subagent delegations) register running work; tool-jobs is the model-facing controller that reads, lists, and kills it; jobs-local is the process-local registry. 生产方（后台 bash、PTY 发送和 subagent 委派）登记正在运行的工作；tool-jobs 是面向模型的控制器，用于读取、列出和终止这些工作；jobs-local 是进程本地注册表。 |
| `ctx.web` | `seam` | [`web`](../packages/web/web) | [`web-search-exa`](../packages/web/web-search-exa), [`web-search-perplexity`](../packages/web/web-search-perplexity), [`web-search-deepseek`](../packages/web/web-search-deepseek), [`web-fetch-http`](../packages/web/web-fetch-http) | [`tool-web`](../packages/web/tool-web) | - | Search and fetch providers register into one ctx.web seam; tool-web owns the stable model-facing names. 搜索和抓取提供方注册到同一个 ctx.web seam；tool-web 负责稳定的面向模型名称。 |
| `ctx.spillStore` | `seam` | [`spill`](../packages/spill/spill) | [`spill-local`](../packages/spill/spill-local) | [`spill-policy`](../packages/spill/spill-policy) | - | The backend saves oversized tool text and returns a model-facing locator plus retrieval hint; spill-policy is the tools/post-execute consumer that decides when to spill. 后端保存过大的工具文本，并返回面向模型的定位信息和取回提示；spill-policy 是 tools/post-execute 消费方，负责决定何时 spill。 |
| `ctx.directoryPicker` | `seam` | [`host-directory-picker`](../packages/host/directory-picker) | [`host-directory-picker-native`](../packages/host/directory-picker-native), [`host-directory-picker-browse`](../packages/host/directory-picker-browse) | [`api-workspace-controller`](../packages/api/workspace-controller) | - | Discriminated interaction capability: the native backend opens one OS chooser on the host display, the browse backend serves listing/creation primitives for the in-app browser; dual-face backends fill ui-workspace directory-flow slots from their browser halves (no wire advertisement). 带判别标记的交互能力：原生后端在 Host 显示设备上打开一个操作系统选择器，浏览后端为应用内浏览器提供列表与创建原语；双端后端通过其浏览器侧填充 ui-workspace 目录流程的 slot（不通过协议发布）。 |
| `ctx.webServer` | `core` | [`host-webserver`](../packages/host/webserver) | - | [`client-connection`](../packages/client/connection), [`client-modules`](../packages/client/modules), [`client-hmr`](../packages/client/hmr) | - | Plain node:http carrier: named-route registry, index transform taps, and the static dist fallback; web-transport plugins register their own routes. 普通的 node:http 载体：具名路由注册表、索引转换 tap，以及静态 dist 回退；Web 传输插件注册自己的路由。 |
| `ctx.clientModules` | `core` | [`client-modules`](../packages/client/modules) | - | [`client-hmr`](../packages/client/hmr) | - | Composes the __AVN_BOOT__ entry graph from an incremental avn.client scan, serves plugin bundles, and notifies rebuilt/graph-changed subscribers. 通过增量 `avn.client` 扫描组合 __AVN_BOOT__ 入口图，提供插件组合包，并通知重建／图变更订阅方。 |
| `ctx.workflowEngine` | `seam` | [`workflow`](../packages/workflow/workflow) | [`workflow-worker-thread`](../packages/workflow/workflow-worker-thread) | [`tool-workflow`](../packages/workflow/tool-workflow), [`tool-ralph`](../packages/workflow/tool-ralph) | - | One engine per context, as in bash, with no named-provider registry; the general workflow and fixed Ralph consumers start runs whose agent() calls fan out through ctx.subagents. 每个上下文使用一个引擎，与 bash 相同，且没有具名提供方注册表；通用工作流与固定 Ralph 消费方启动运行，其中的 agent() 调用通过 ctx.subagents 扇出。 |
| `ctx.webhookRuntime` | `core` | [`webhook`](../packages/webhook/webhook) | - | [`webhook-github`](../packages/webhook/webhook-github) | - | Provider adapters dispatch authenticated deliveries; trusted plugins register independent process-local rules, and the runtime turns non-null results into ordinary Workspace-backed Sessions without delivery or completion state. 提供方适配器分派已认证交付；可信插件注册独立的进程本地规则，runtime 把非 null 结果转换为普通的 Workspace-backed Session，不保留交付或完成状态。 |
| `ctx.lsp` | `seam` | [`lsp`](../packages/lsp/lsp) | [`lsp-stdio`](../packages/lsp/lsp-stdio) | [`tool-lsp`](../packages/lsp/tool-lsp) | - | Provider registration and selection plus normalized query execution over exactly four operations; the seam offers no protocol escape hatch, so a backend translates into the normalized request and result. 提供方注册与选择，加上恰好四种操作的标准化查询执行；该 seam 不提供协议逃生口，后端必须转换为标准化请求和结果。 |
| `ctx.dynamicCordisRunner` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | Owns the in-memory definition registry, the vm sandbox for host halves, and the request-run round trip; browser pages reach the same service over the wire through its remote namespace. 拥有内存定义注册表、Host 半的 vm 沙箱和 request-run 往返流程；浏览器页面通过其 Remote 命名空间在线访问同一服务。 |
| `ctx.cordisInspect` | `core` | [`cordis-host-runner`](../packages/extensions/cordis-host-runner) | - | [`tool-cordis`](../packages/extensions/tool-cordis) | - | Registers host inspect providers, mirrors the client provider manifest, and routes client queries through the dynamic Cordis transport. 注册 Host inspect 提供方、镜像 Client 提供方 manifest，并通过动态 Cordis 传输路由 Client 查询。 |
| `ctx.accountIntegrations` | `seam` | `account-integrations` | - | `ui-automations`, `ui-settings-integrations` | - | One Host row owns each signed-in user's connector accounts, their OAuth and bot sessions, and the MCP servers those accounts expose; an agent mounts only its owner's connectors. 每个宿主行拥有某个已登录用户的连接器账号、这些账号的 OAuth 与机器人会话，以及它们暴露的 MCP 服务器；一个 agent 只挂载其所有者的连接器。 |
| `ctx.automations` | `core` | [`automations`](../packages/core/automations) | - | `ui-automations` | - | Durable admission, owner-scoped agents, and run history for scheduled prompts; a schedule never widens the tool access its run starts with. 为定时提示词提供持久准入、按所有者隔离的 agent 与运行历史；一次调度不会放宽其运行开始时已有的工具访问。 |
| `ctx.browserChromium` | `core` | [`browser-chromium`](../packages/web/browser-chromium) | - | - | - | Launches the Chromium that the sidebar browser and the browser tools attach to, over a remote debugging port and one shared signed-in profile. 启动侧栏浏览器与浏览器工具所连接的 Chromium，经由一个远程调试端口和一个共享的已登录配置。 |
| `ctx.capabilities` | `core` | [`capability`](../packages/capability/capability) | - | [`api-memory-manager`](../packages/memory/api-memory-manager), [`tool-capability`](../packages/capability/tool-capability) | - | Stores one owner's learned procedures as agentskills-compatible directories and serves them to recall consumers; the registry contributes no skills of its own. 把一个所有者的已学过程存为与 agentskills 兼容的目录，并提供给回忆消费者；注册表本身不贡献任何 skill。 |
| `ctx.devices` | `seam` | [`device`](../packages/device/device) | [`device-local`](../packages/device/device-local) | [`tool-device`](../packages/device/tool-device) | - | Hosts register here and the service owns which session is looking at which device, so the model's device tools and every client watching that session share one state stream. 宿主在此注册，服务拥有「哪个会话在看哪台设备」，因此模型的设备工具与每个观看该会话的客户端共享同一份状态流。 |
| `ctx.documentExtract` | `seam` | [`document-extract`](../packages/document/document-extract) | [`document-extract-js`](../packages/document/document-extract-js), [`document-extract-ocr`](../packages/document/document-extract-ocr), [`document-extract-office`](../packages/document/document-extract-office) | `session-controller` | - | Providers register the document formats they extract; the registry resolves a caller's request to one provider and reports the formats the composition can serve. 提供方注册自己可提取的文档格式；注册表把调用方的请求解析到一个提供方，并报告该组合可服务的格式。 |
| `ctx.jobController` | `core` | `job-controller` | - | `ui-jobs` | - | Streams one session's job roster and one job's retained output to browsers over the generated `job` namespace and stops a job on a human's behalf; the model's consuming cursor never observes those streams. 通过生成的 `job` namespace 把某个会话的后台任务名册和某个任务的保留输出流式发给浏览器，并代表人类停止任务；模型自己的消费游标不会观察到这些流。 |
| `ctx.mail` | `seam` | [`mail`](../packages/mail/mail) | `account-integrations` | [`tool-mail`](../packages/mail/tool-mail) | - | Account sources register owner-scoped accounts, and every operation resolves its named account for the given owner before a socket opens. 账号来源注册按所有者隔离的账号，每个操作在打开套接字之前先为给定所有者解析出所命名的账号。 |
| `ctx.memory` | `seam` | [`memory`](../packages/memory/memory) | [`memory-memos`](../packages/memory/memory-memos) | [`api-memory-manager`](../packages/memory/api-memory-manager), [`memory-context`](../packages/memory/memory-context), [`memory-memos`](../packages/memory/memory-memos), [`tool-capability`](../packages/capability/tool-capability), [`tool-memory`](../packages/memory/tool-memory) | - | One registered provider serves recall, turn capture, and inspection to every memory consumer; the definition holds no storage of its own. 唯一注册的提供方向每个记忆消费者提供回忆、回合捕获与检查；定义本身不持有存储。 |
| `ctx.memoryManagerController` | `core` | [`api-memory-manager`](../packages/memory/api-memory-manager) | - | `ui-settings-memory` | - | Serves what Aeven has learned about the signed-in user, with view, correct, and forget, always for the caller of the running request. 提供 Aeven 对已登录用户所了解到的一切，含查看、更正与遗忘，且始终服务于当前请求的调用方。 |
| `ctx.sync` | `seam` | [`sync`](../packages/sync/sync) | [`sync-yjs`](../packages/sync/sync-yjs) | [`memory-memos`](../packages/memory/memory-memos), [`personalization`](../packages/preset/personalization), [`session-sync`](../packages/session/session-sync), `sync-controller` | - | 让账户的文档和流在该账户的每台设备上保持一致，并通过 Aeven 中转服务器端到端加密传输。 |
| `ctx.syncController` | `core` | `sync-controller` | - | `ui-settings-sync` | - | 开启账户同步、加入与批准设备以及移除设备，始终为当前请求的调用方执行。 |
| `ctx.personalizationController` | `core` | [`personalization`](../packages/preset/personalization) | - | `ui-settings-personalization` | - | One Host row owns each account's voice and notes, the Remote behind Settings → Personalization, and the system-prompt section that renders the session owner's preferences after the persona. 一个宿主行拥有每个账号的声音与笔记、设置 → 个性化背后的 Remote，以及在 persona 之后渲染会话所有者偏好的系统提示词段落。 |
| `ctx.skillCatalog` | `core` | [`skill-catalog`](../packages/skill/skill-catalog) | - | `account-integrations` | - | Read-only local source of installable skills: the catalog lists what a reader may install and the installer reads one entry's files from the same tree. 可安装 skill 的本地只读来源：目录列出读者可安装的内容，安装器从同一棵树读取某个条目的文件。 |
| `ctx.speechController` | `core` | [`api-speech-to-text`](../packages/speech/api-speech-to-text) | - | `ui-voice-input` | - | Authenticated, cancellation-aware Client access to speech preparation and transcription; a speech call never activates or submits to an Agent. 经过认证且可取消的客户端语音准备与转写访问；一次语音调用不会激活或提交给 agent。 |
| `ctx.speechToText` | `seam` | [`speech-to-text`](../packages/speech/speech-to-text) | [`speech-to-text-whisper`](../packages/speech/speech-to-text-whisper) | [`api-speech-to-text`](../packages/speech/api-speech-to-text) | - | Named providers register disposably and the registry resolves each request to one provider and one model. 具名提供方可注册且可释放，注册表把每个请求解析到一个提供方和一个模型。 |
| `ctx.terminalController` | `core` | `terminal-controller` | - | `ui-sidebar-terminal` | - | Typed Remote control of transient session-owned terminal processes, which run with the execution environment's system-user permissions. 对短暂的、会话所有终端进程的类型化 Remote 控制；这些进程以执行环境的系统用户权限运行。 |
| `ctx.workspaceFiles` | `core` | `workspace-files` | - | `ui-sidebar-files` | - | Serves listings, text previews, and a bounded name search over a session's workspace root for the sidebar file explorer; nothing here writes. 为侧栏文件浏览器提供某会话工作区根目录下的列目录、文本预览与有界名称搜索；此处不写入任何内容。 |

维护模式：混合模式。服务从 Cordis 声明中发现；接口、实现和消费方角色在 `scripts/gen-doc-graphs.ts` 中分类，并设有完整性守卫。
