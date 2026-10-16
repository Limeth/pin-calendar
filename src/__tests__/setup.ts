import { afterEach, vi } from 'vitest';
// IndexedDB, which stores the authentication keys, see `auth.ts`.
import 'fake-indexeddb/auto';
import { resetNetwork } from './fakes/peerjs';

// WebRTC and the signalling server are not available in tests, see `fakes/peerjs.ts`.
vi.mock('peerjs', () => import('./fakes/peerjs'));

afterEach(() => {
  resetNetwork();
});
