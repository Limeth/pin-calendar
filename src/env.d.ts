/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { WebRtcNetworkAdapter } from './webrtc';

declare global {
  interface Window {
    webrtc: WebRtcNetworkAdapter;
  }
}
