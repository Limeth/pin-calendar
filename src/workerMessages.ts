import type { DocumentId } from '@automerge/automerge-repo';
import type { HashArgs } from './hash';
import type { CalendarId } from './client';

export type ToSharedRepoMessageInit = {
  type: 'init';
  calendarId: CalendarId;
  // TODO: The ID is always generated on the shared worker. Remove it from here and from LocalStorageData.
  documentIdEphemeral: DocumentId | undefined;
  documentIdLocal: DocumentId;
  hashArgs: HashArgs;
  repoEphemeralPort: MessagePort;
  repoLocalPort: MessagePort;
  repoSharedPort: MessagePort;
};

export type ToSharedRepoMessageWebRtcStartSuccess = {
  type: 'webrtc-start-success';
};

export type ToSharedRepoMessageWebRtcStopSuccess = {
  type: 'webrtc-stop-success';
};

export type ToSharedRepoMessageWebRtcPollAliveAcq = {
  type: 'webrtc-pollalive-acq';
};

export type ToSharedRepoMessage =
  | ToSharedRepoMessageInit
  | ToSharedRepoMessageWebRtcStartSuccess
  | ToSharedRepoMessageWebRtcStopSuccess
  | ToSharedRepoMessageWebRtcPollAliveAcq;

/// Sent when the ephemeral and local documents are ready to be found.
export type FromSharedRepoMessageReadyLocal = {
  type: 'ready-local';
  documentIdEphemeral: DocumentId;
  documentIdLocal: DocumentId;
};

/// Sent when the shared documents are ready to be found.
export type FromSharedRepoMessageReadyShared = {
  type: 'ready-shared';
};

export type FromSharedRepoMessageWebRtcStart = {
  type: 'webrtc-start';
  documentSharedAvailableLocallyDuringInitialization: boolean;
};

export type FromSharedRepoMessageWebRtcStop = {
  type: 'webrtc-stop';
};

export type FromSharedRepoMessageWebRtcPollAlive = {
  type: 'webrtc-pollalive';
};

export type FromSharedRepoMessage =
  | FromSharedRepoMessageReadyLocal
  | FromSharedRepoMessageReadyShared
  | FromSharedRepoMessageWebRtcStart
  | FromSharedRepoMessageWebRtcStop
  | FromSharedRepoMessageWebRtcPollAlive;

export class MessagePortWrapper<MessageSend, MessageRecv> {
  port: MessagePort;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.addEventListener('message', (event) => {
      console.debug('message', event.data);
    });
  }

  /// Start listening to incoming messages.
  start() {
    this.port.start();
  }

  postMessage(message: MessageSend, transfer?: Transferable[]) {
    console.debug('post', {
      message,
      transfer,
    });
    this.port.postMessage(message, { transfer });
  }

  on(messageHandler: (message: MessageRecv) => void) {
    this.port.addEventListener('message', (event) => {
      messageHandler(event.data as MessageRecv);
    });
  }

  once(messageHandler: (message: MessageRecv) => boolean) {
    const wrapper: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      outerHandler?: (this: MessagePort, ev: MessagePortEventMap['message']) => any;
    } = {};
    wrapper.outerHandler = (event: MessageEvent) => {
      if (messageHandler(event.data as MessageRecv))
        this.port.removeEventListener('message', wrapper.outerHandler!);
    };
    this.port.addEventListener('message', wrapper.outerHandler);
  }

  onceAsync(filter: (message: MessageRecv) => boolean = () => true): Promise<MessageRecv> {
    return new Promise((resolve) => {
      this.once((message) => {
        const accepted = filter(message);
        if (accepted) resolve(message);
        return accepted;
      });
    });
  }
}
