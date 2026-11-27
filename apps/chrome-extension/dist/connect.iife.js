(function() {
	//#region src/connect.ts
	/**
	* The page the Aeven app opens when it starts the browser for the agent or pairs
	* this extension: it wakes the extension's worker with the pairing secret the
	* app put in the fragment, and the worker connects to the app and closes this tab.
	*/
	const secret = location.hash.slice(1);
	history.replaceState(null, "", location.pathname);
	chrome.runtime.sendMessage({
		wake: true,
		secret
	});
	//#endregion
})();
