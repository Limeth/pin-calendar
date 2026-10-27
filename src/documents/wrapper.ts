import type { Versioned } from '@/versioned';
import type { UncheckedRop } from '@/validation';
import type { Repo, DocHandle } from '@automerge/automerge-repo';
import type { Rop } from 'automerge-diy-vue-hooks';
import type { Ref } from 'vue';

export type DocumentWrapper<T> = {
  repo: Repo;
  data: Ref<Rop<T>>;
  handle: DocHandle<T>;
};

// The current version is read unchecked, see `UncheckedRop`, except for the properties in `Trusted`,
// which do not have getters yet.
export type VersionedDocumentWrapper<T, Trusted extends keyof T = never> = {
  repo: Repo;
  versionedData: Ref<Versioned<Rop<T>>>;
  data: Ref<UncheckedRop<T, Trusted>>;
  handle: DocHandle<Versioned<T>>;
};
