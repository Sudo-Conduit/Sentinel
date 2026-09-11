// sw-llmd.js — service worker hosting the shared MLCEngine.
// This is what makes the model survive S-Matrix's window closing: the engine
// lives here, not in any app tab, per WebLLM's Service Worker Engine pattern
// (CreateServiceWorkerMLCEngine / activateServiceWorker).
importScripts('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/lib/index.js');

if (typeof webllm !== 'undefined' && webllm.activateServiceWorker) {
  webllm.activateServiceWorker();
} else {
  // Fallback: some builds export ESM only. If importScripts above fails,
  // llmd.js falls back to an in-page engine and logs a warning — see llmd.js.
  self.addEventListener('message', () => {});
}

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
