import type { Repo, DocHandle } from '@automerge/automerge-repo';
import type { Rop } from 'automerge-diy-vue-hooks';
import type { Ref } from 'vue';

export type DocumentWrapper<T> = {
  repo: Repo;
  data: Ref<Rop<T>>;
  handle: DocHandle<T>;
};
