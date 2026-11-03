import * as uuid from 'uuid';

// A Web Lock that this tab holds until it is closed, so that the shared worker can tell when it is,
// see `ToSharedRepoMessageInit.tabLockName`. The browser releases it however the tab ends, e.g.
// also when it crashes or is discarded, unlike `pagehide`, which is not always dispatched.
const TAB_LOCK_NAME = `pin-calendar-tab:${uuid.v7()}`;

let tabLock: Promise<string> | undefined;

// Resolves with the lock's name once the lock is held, so that the shared worker's request for it is
// not granted before.
export function holdTabLock(): Promise<string> {
  tabLock ??= new Promise((resolve) => {
    void navigator.locks.request(TAB_LOCK_NAME, () => {
      resolve(TAB_LOCK_NAME);
      // Never released.
      return new Promise<never>(() => {});
    });
  });

  return tabLock;
}
