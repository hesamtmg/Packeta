<script setup lang="ts">
// The Packeta "Ledger P" mark: a P built from ledger rows. Bars are drawn in
// currentColor on the same 64×64 grid as the full logo, so the surrounding
// tile (gradient, size, radius) comes from the parent element's CSS.
</script>

<template>
  <svg class="brand-mark-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <g fill="currentColor">
      <rect x="18" y="12" width="21" height="5" rx="2.5" />
      <rect x="18" y="19.5" width="28" height="5" rx="2.5" opacity=".85" />
      <rect x="18" y="27" width="28" height="5" rx="2.5" opacity=".85" />
      <rect x="18" y="34.5" width="21" height="5" rx="2.5" />
      <rect x="18" y="42" width="8" height="5" rx="2.5" opacity=".85" />
      <rect x="18" y="49.5" width="8" height="5" rx="2.5" />
    </g>
  </svg>
</template>

<style scoped>
.brand-mark-svg {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
