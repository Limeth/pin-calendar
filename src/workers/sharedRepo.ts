import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { DocHandle, isValidDocumentId, Repo, type DocumentId } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as uuid from 'uuid';
import { WebRtcNetworkAdapter } from '@/webrtc';
import { LocalDocumentDefault, type LocalDocument } from '@/client';
import { ref, toRef, type Ref } from 'vue';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import {
  EphemeralDocumentDefault,
  MessagePortWrapper,
  type DocumentWrapper,
  type EphemeralDocument,
} from '@/account';

export type ToSharedRepoMessageInit = {
  type: 'init';
  documentIdEphemeral: DocumentId | undefined;
  documentIdLocal: DocumentId;
  repoEphemeralPort: MessagePort;
  repoLocalPort: MessagePort;
  repoSharedPort: MessagePort;
};

export type ToSharedRepoMessage = ToSharedRepoMessageInit;

export type FromSharedRepoMessageReady = {
  type: 'ready';
  documentIdEphemeral: DocumentId;
  documentIdLocal: DocumentId;
};

export type FromSharedRepoMessage = FromSharedRepoMessageReady;

declare const self: SharedWorkerGlobalScope;

class SharedRepo {
  repoEphemeral: Repo;
  repoLocal: Repo;
  repoShared: Repo;
  initialized?: {
    docEphemeral: DocumentWrapper<EphemeralDocument>;
    docLocal: DocumentWrapper<LocalDocument>;
  };

  constructor() {
    this.repoEphemeral = new Repo({
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-ephemeral:' + uuid.v7()) as any,
    });
    this.repoLocal = new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-local:' + uuid.v7()) as any,
    });
    this.repoShared = new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-shared:' + uuid.v7()) as any,
    });
  }

  // TODO/FIXME: Prevent this function from being executed twice concurrently (it's async).
  async initialize(
    message: ToSharedRepoMessageInit,
  ): Promise<NonNullable<typeof this.initialized>> {
    if (this.initialized !== undefined) return this.initialized;

    const docHandleEphemeral: DocHandle<EphemeralDocument> =
      this.repoEphemeral.create<EphemeralDocument>(EphemeralDocumentDefault());
    const docDataEphemeral = makeReactive(docHandleEphemeral) as Ref<Rop<EphemeralDocument>>;
    let docHandleLocal: DocHandle<LocalDocument>;

    if (isValidDocumentId(message.documentIdLocal)) {
      docHandleLocal = await this.repoLocal.find<LocalDocument>(message.documentIdLocal);
    } else {
      docHandleLocal = this.repoLocal.create<LocalDocument>(LocalDocumentDefault());
    }

    const docDataLocal = makeReactive(docHandleLocal) as Ref<Rop<LocalDocument>>;

    // TODO: WebRTC is not supported in Shared Workers.
    // this.repoShared.networkSubsystem.addNetworkAdapter(
    //   new WebRtcNetworkAdapter({
    //     clientSettings: docDataLocal,
    //     connectedPeers: toRef(docDataEphemeral.value.connectedPeers),
    //   }),
    // );

    this.initialized = {
      docEphemeral: {
        handle: docHandleEphemeral,
        data: docDataEphemeral,
      },
      docLocal: {
        handle: docHandleLocal,
        data: docDataLocal,
      },
    };

    return this.initialized;
  }
}

// Because automerge is a WASM module and loads asynchronously,
// a bug in Chrome causes the 'connect' event to fire before the
// module is loaded. This promise lets us block until the module loads
// even if the event arrives first.
// Ideally Chrome would fix this upstream but this isn't a terrible hack.
const repoPromise = (async () => {
  return new SharedRepo();
})();

self.onconnect = (eventConnect: MessageEvent) => {
  console.log('connect', eventConnect);

  const port = new MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>(
    eventConnect.ports[0],
  );

  port.on((message) => {
    onMessage(message, port);
  });

  port.start();
};

async function onMessage(
  message: ToSharedRepoMessage,
  port: MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>,
) {
  const repo = await repoPromise;
  const initialized = await repo.initialize(message);

  // be careful to not accidentally create a strong reference to port
  // that will prevent dead ports from being garbage collected
  repo.repoEphemeral.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoEphemeralPort, { useWeakRef: true }),
  );

  repo.repoLocal.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoLocalPort, { useWeakRef: true }),
  );

  repo.repoShared.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoSharedPort, { useWeakRef: true }),
  );

  port.postMessage({
    type: 'ready',
    documentIdEphemeral: initialized.docEphemeral.handle.documentId,
    documentIdLocal: initialized.docLocal.handle.documentId,
  });
}
