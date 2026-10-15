import type { DataConnection } from 'peerjs';

// Resolves with the payload of the next `event`, or rejects if the connection errors or is closed
// first.
function asyncOnceOrFail(
  connection: DataConnection,
  event: 'open' | 'data',
  closedMessage: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const removeListeners = () => {
      connection.off(event, onEvent);
      connection.off('error', onError);
      connection.off('close', onClose);
    };
    const onEvent = (payload?: unknown) => {
      removeListeners();
      resolve(payload);
    };
    const onError = (error: Error) => {
      removeListeners();
      reject(error);
    };
    const onClose = () => {
      removeListeners();
      reject(new Error(closedMessage));
    };

    connection.on(event, onEvent);
    connection.on('error', onError);
    connection.on('close', onClose);
  });
}

// Resolves once the connection is open, or rejects if it errors or is closed first.
export async function asyncOnceOpen(connection: DataConnection): Promise<void> {
  if (connection.open) return;
  await asyncOnceOrFail(connection, 'open', 'The connection was closed before it was opened.');
}

// Resolves with the next received payload, or rejects if the connection errors or is closed
// first. The connection must already be open.
export function asyncOnceData(connection: DataConnection): Promise<unknown> {
  const closedMessage = 'The connection was closed before a response was received.';

  // A connection closed before this call would never emit another `close` event.
  if (!connection.open) return Promise.reject(new Error(closedMessage));

  return asyncOnceOrFail(connection, 'data', closedMessage);
}

export function asyncOnceClose(connection: DataConnection): Promise<void> {
  return new Promise((resolve) => {
    connection.once('close', () => {
      resolve();
    });
  });
}

// How long `closeConnection` waits for the remote peer to close the connection.
const CLOSE_TIMEOUT_MS = 5_000;

// Close the connection once the packets sent so far have been delivered, which is how connections
// should be closed by default (enforced by a lint rule).
// PeerJS's plain `close()` tears down the connection immediately, discarding packets that are still
// in flight, such as an error packet sent right before closing. With `flush`, PeerJS sends a close
// marker after them instead, and the remote peer closes the connection when it receives the
// marker. If it does not do so in time (e.g. it is unresponsive), the connection is closed
// immediately.
export async function closeConnection(connection: DataConnection): Promise<void> {
  if (!connection.open) {
    // There is nothing to deliver, but `close()` still cleans up a connection being negotiated.
    // eslint-disable-next-line no-restricted-syntax
    connection.close();
    return;
  }

  const closed = asyncOnceClose(connection);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  connection.close({ flush: true });
  await Promise.race([
    closed,
    new Promise((resolve) => (timeout = setTimeout(resolve, CLOSE_TIMEOUT_MS))),
  ]);
  clearTimeout(timeout);

  // eslint-disable-next-line no-restricted-syntax
  if (connection.open) connection.close();
}
