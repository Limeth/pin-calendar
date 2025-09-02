import type { WebRtcNetworkAdapter } from './webrtc';

declare global {
  interface Window {
    webrtc: WebRtcNetworkAdapter;
  }
}
