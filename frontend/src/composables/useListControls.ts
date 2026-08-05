import { computed, ref, watch, type Ref } from 'vue';

// Generic search + sort + pagination over a reactive list, shared by every
// admin panel list view (transactions, wallets, customers, installments,
// panel users, scheduler logs) so each one gets the same behavior for free
// instead of re-implementing it per view.
export interface ListControlsOptions<T> {
  // Returns the strings a search term is matched against for one row
  // (already lowercased on the row side isn't required — matching lowercases
  // both sides). Omit to disable search entirely.
  searchFields?: (item: T) => (string | null | undefined)[];
  // Column key -> value accessor, used by toggleSort(key). Sorting a column
  // with no accessor registered here is a no-op.
  sortAccessors?: Record<string, (item: T) => string | number | Date>;
  // Column key sorted by default (must have an accessor), and its direction.
  defaultSort?: { key: string; dir?: 'asc' | 'desc' };
  pageSize?: number;
}

export function useListControls<T>(source: Ref<T[]>, options: ListControlsOptions<T> = {}) {
  const search = ref('');
  const sortKey = ref<string | null>(options.defaultSort?.key ?? null);
  const sortDir = ref<'asc' | 'desc'>(options.defaultSort?.dir ?? 'asc');
  const page = ref(1);
  const pageSize = ref(options.pageSize ?? 10);

  function toggleSort(key: string) {
    if (!options.sortAccessors?.[key]) return;
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey.value = key;
      sortDir.value = 'asc';
    }
  }

  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    if (!term || !options.searchFields) return source.value;
    return source.value.filter((item) =>
      options
        .searchFields!(item)
        .some((field) => field?.toLowerCase().includes(term)),
    );
  });

  const sorted = computed(() => {
    const accessor = sortKey.value ? options.sortAccessors?.[sortKey.value] : undefined;
    if (!accessor) return filtered.value;
    const dir = sortDir.value === 'asc' ? 1 : -1;
    return [...filtered.value].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize.value)));

  // Any change upstream of pagination resets to page 1, except a page-count
  // shrink (e.g. a filter narrowing the results) — that just clamps instead,
  // so the user isn't yanked back to page 1 while just browsing pages.
  watch([search, sortKey, sortDir, pageSize], () => {
    page.value = 1;
  });
  watch(totalPages, (max) => {
    if (page.value > max) page.value = max;
  });

  const pageItems = computed(() => {
    const start = (page.value - 1) * pageSize.value;
    return sorted.value.slice(start, start + pageSize.value);
  });

  function goToPage(n: number) {
    page.value = Math.min(Math.max(1, n), totalPages.value);
  }

  return {
    search,
    sortKey,
    sortDir,
    page,
    pageSize,
    filtered,
    sorted,
    pageItems,
    totalPages,
    toggleSort,
    goToPage,
  };
}
