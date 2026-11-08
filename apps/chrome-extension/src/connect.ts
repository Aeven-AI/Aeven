/**
 * The page the Aeven app opens when it starts the browser for the agent: it wakes
 * the extension's worker, which connects to the app and closes this tab.
 */
void chrome.runtime.sendMessage({ wake: true })
