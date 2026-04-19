<script setup lang="ts">
import { computed } from "vue";
import AppModal from "./AppModal.vue";
import { appAlertAcknowledged, appAlertModel } from "../services/appAlert";

const alertOpen = computed({
  get: () => appAlertModel.open,
  set(v: boolean) {
    if (v) {
      appAlertModel.open = true;
    } else {
      appAlertAcknowledged();
    }
  },
});

function onConfirm() {
  alertOpen.value = false;
}
</script>

<template>
  <AppModal
    v-model="alertOpen"
    :title="appAlertModel.title"
    max-width="400px"
    :mask-closable="true"
    :esc-closable="true"
    :show-close-button="false"
    panel-class="appAlertModalPanel"
    :body-scroll="true"
  >
    <p class="appAlertModalMsg">{{ appAlertModel.message }}</p>
    <template #footer>
      <div class="appAlertModalFooter">
        <button
          type="button"
          class="btn primary"
          size="large"
          @click="onConfirm"
        >
          确定
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.appAlertModalPanel) {
  max-height: min(90vh, 320px);
}

.appAlertModalMsg {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--fg);
  word-break: break-word;
}

.appAlertModalFooter {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}
</style>
