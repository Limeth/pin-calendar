import { afterEach, vi } from 'vitest';
// IndexedDB, which stores the authentication keys, see `auth.ts`.
import 'fake-indexeddb/auto';
import { locks } from 'node:worker_threads';
import { resetNetwork } from './fakes/peerjs';

// Web Locks, which tabs hold until they are closed, see `holdTabLock`. Not provided by happy-dom.
Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });

// WebRTC and the signalling server are not available in tests, see `fakes/peerjs.ts`.
vi.mock('peerjs', () => import('./fakes/peerjs'));

afterEach(() => {
  resetNetwork();
});
