import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
import { DocHandle, isValidDocumentId, Repo, type DocumentId } from '@automerge/automerge-repo';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as uuid from 'uuid';
import { WebRtcNetworkAdapter } from '@/webrtc';
import { LocalDocumentDefault, type LocalDocument } from '@/client';
import { ref, toRef, type Ref } from 'vue';
import { makeReactive, type Rop } from 'automerge-diy-vue-hooks';
import { EphemeralDocumentDefault, MessagePortWrapper, type EphemeralDocument } from '@/account';

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

// Because automerge is a WASM module and loads asynchronously,
// a bug in Chrome causes the 'connect' event to fire before the
// module is loaded. This promise lets us block until the module loads
// even if the event arrives first.
// Ideally Chrome would fix this upstream but this isn't a terrible hack.
const repoPromise = (async () => {
  return [
    new Repo({
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-ephemeral:' + uuid.v7()) as any,
    }),
    new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-local:' + uuid.v7()) as any,
    }),
    new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      peerId: ('repo-shared:' + uuid.v7()) as any,
    }),
  ];
})();

self.onconnect = (eventConnect: MessageEvent) => {
  console.log('connect', eventConnect);

  const port = eventConnect.ports[0];

  port.onmessage = (eventMessage) => {
    console.log('message', eventMessage);

    onMessage(
      eventMessage.data as ToSharedRepoMessage,
      new MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>(port),
    );
  };
};

async function onMessage(
  message: ToSharedRepoMessage,
  port: MessagePortWrapper<FromSharedRepoMessage, ToSharedRepoMessage>,
) {
  const [repoEphemeral, repoLocal, repoShared] = await repoPromise;
  const initialize = repoShared.networkSubsystem.adapters.length === 0;

  // be careful to not accidentally create a strong reference to port
  // that will prevent dead ports from being garbage collected
  repoEphemeral.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoEphemeralPort, { useWeakRef: true }),
  );

  repoLocal.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoLocalPort, { useWeakRef: true }),
  );

  repoShared.networkSubsystem.addNetworkAdapter(
    new MessageChannelNetworkAdapter(message.repoSharedPort, { useWeakRef: true }),
  );

  let docHandleEphemeral: DocHandle<EphemeralDocument>;

  if (isValidDocumentId(message.documentIdEphemeral)) {
    docHandleEphemeral = await repoEphemeral.find<EphemeralDocument>(message.documentIdEphemeral);
  } else {
    docHandleEphemeral = repoEphemeral.create<EphemeralDocument>(EphemeralDocumentDefault());
  }

  const docDataEphemeral = makeReactive(docHandleEphemeral) as Ref<Rop<EphemeralDocument>>;
  let docHandleLocal: DocHandle<LocalDocument>;

  if (isValidDocumentId(message.documentIdLocal)) {
    docHandleLocal = await repoLocal.find<LocalDocument>(message.documentIdLocal);
  } else {
    docHandleLocal = repoLocal.create<LocalDocument>(LocalDocumentDefault());
  }

  const docDataLocal = makeReactive(docHandleLocal) as Ref<Rop<LocalDocument>>;

  if (initialize) {
    repoShared.networkSubsystem.addNetworkAdapter(
      new WebRtcNetworkAdapter({
        clientSettings: docDataLocal,
        connectedPeers: toRef(docDataEphemeral.value.connectedPeers),
      }),
    );
  }

  port.postMessage({
    type: 'ready',
    documentIdEphemeral: docHandleEphemeral.documentId,
    documentIdLocal: docHandleLocal.documentId,
  });
}
