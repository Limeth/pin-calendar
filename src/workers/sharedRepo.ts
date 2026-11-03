// The entry of the shared worker. It sets `self.onconnect` before anything is awaited, as Chrome
// loses `connect` events dispatched before then. The worker's code awaits the Automerge WASM module
// when it is imported (a top-level `await`), which may take long on a first visit, so it is imported
// dynamically. Do not import anything else here, not even indirectly.
// https://github.com/Menci/vite-plugin-wasm/issues/37

declare const self: SharedWorkerGlobalScope;

const worker = import('./sharedRepoMain').then(({ SharedRepoWorker }) => new SharedRepoWorker());

self.onconnect = (eventConnect: MessageEvent) => {
  const port = eventConnect.ports[0];

  if (port === undefined) return;

  // The port keeps the tab's messages until the worker's code starts it.
  void worker.then((worker) => worker.onConnect(port));
};
