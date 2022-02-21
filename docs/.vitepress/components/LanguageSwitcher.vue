<template>
  <div style="float: right; background-color: rgba(27, 31, 35, 0.05); padding: 5px 10px; border-radius: 6px; font-size: 0.9rem;">
    Code:
    <input type="radio" id="ts" value="ts" v-model="language" style="margin-left: 1em;">
    <label for="ts">TypeScript</label>
    <input type="radio" id="js" value="js" v-model="language" style="margin-left: 1em;">
    <label for="js">JavaScript</label>
  </div>
</template>

<script setup lang="ts">
import {ref, watch, onMounted, onBeforeUnmount} from 'vue';

const language = ref('ts');

watch(language, () => {update();});

onMounted(() => {
  language.value = localStorage.getItem('language') ?? 'ts';
});

if (import.meta.hot) {
  const handle = setInterval(update, 500);
  onBeforeUnmount(() => {clearInterval(handle);});
}

function update() {
  for (const el of document.querySelectorAll('div.language-js, div.language-ts, .only-js, .only-ts')) {
    el.style.display = 'none'
  }
  for (const el of document.querySelectorAll(`div.language-${language.value}, .only-${language.value}`)) {
    el.style.display = 'block';
  }
  localStorage.setItem('language', language.value);
}
</script>
