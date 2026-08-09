<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import WidgetPayPanel from '../components/WidgetPayPanel.vue';

// Kept alive as a direct-link/iframe-embeddable fallback route — the SDK
// (sdk/js/pay-widget.js) mounts WidgetPayPanel.vue natively instead of
// visiting this route, but anyone manually iframing /pay-widget/:authority
// still needs it to work exactly as before.
const route = useRoute();
const authority = route.params.authority as string;

const containerEl = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | undefined;

function postResize() {
  window.parent?.postMessage(
    { type: 'packeta-widget-resize', height: document.documentElement.scrollHeight },
    '*',
  );
}

function onComplete(result: { transactionId: string; status: 'COMPLETED' | 'FAILED' }) {
  window.parent?.postMessage({ type: 'packeta-payment-complete', ...result }, '*');
}

onMounted(() => {
  resizeObserver = new ResizeObserver(postResize);
  if (containerEl.value) resizeObserver.observe(containerEl.value);
  postResize();
});
onUnmounted(() => resizeObserver?.disconnect());
</script>

<template>
  <div ref="containerEl">
    <WidgetPayPanel :authority="authority" @complete="onComplete" />
  </div>
</template>
