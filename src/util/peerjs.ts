import type { DataConnection } from 'peerjs';

export function asyncOnceOpen(connection: DataConnection): Promise<void> {
  return new Promise((resolve) => {
    connection.once('open', () => {
      resolve();
    });
  });
}

export function asyncOnceData(connection: DataConnection): Promise<unknown> {
  return new Promise((resolve) => {
    connection.once('data', (payload) => {
      resolve(payload);
    });
  });
}

export function asyncOnceClose(connection: DataConnection): Promise<void> {
  return new Promise((resolve) => {
    connection.once('close', () => {
      resolve();
    });
  });
}
