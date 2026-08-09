<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import WidgetAccountPanel from '../components/WidgetAccountPanel.vue';

// Kept alive as a direct-link/iframe-embeddable fallback route — the SDK
// (sdk/js/wallet-widget.js) mounts WidgetAccountPanel.vue natively instead
// of visiting this route, but anyone manually iframing /widget/:token still
// needs it to work exactly as before.
const route = useRoute();
const token = route.params.token as string;
const returnUrl = route.query.returnUrl as string | undefined;

const containerEl = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | undefined;

function postResize() {
  window.parent?.postMessage(
    { type: 'packeta-widget-resize', height: document.documentElement.scrollHeight },
    '*',
  );
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
    <WidgetAccountPanel :token="token" :return-url="returnUrl" />
  </div>
</template>
