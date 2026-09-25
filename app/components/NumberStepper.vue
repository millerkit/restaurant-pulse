<script setup lang="ts">
// A numeric input with its own up/down bump buttons to the right, replacing native
// browser spin-button arrows — those render flush against the text with no room to grab
// them reliably. Used on the Labor tab (app/pages/budget/labor.vue) after the user found
// the native arrows too cramped and wasn't using the adjacent range sliders much, so
// this is the input control that actually gets used day to day.
const props = withDefaults(defineProps<{
  modelValue: number
  step?: number
  min?: number | null
  max?: number | null
  decimals?: number
  width?: string
  disabled?: boolean
}>(), { step: 1, min: 0, max: null, decimals: 0, width: '68px', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function clamp(v: number) {
  let n = v
  if (props.min != null && n < props.min) n = props.min
  if (props.max != null && n > props.max) n = props.max
  return n
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (raw === '') return
  const n = Number(raw)
  if (!Number.isNaN(n)) emit('update:modelValue', clamp(n))
}

function bump(dir: 1 | -1) {
  const next = Math.round((props.modelValue + dir * props.step) / props.step) * props.step
  emit('update:modelValue', clamp(Number(next.toFixed(6))))
}
</script>

<template>
  <div class="number-stepper" :class="{ 'number-stepper-disabled': disabled }">
    <input
      type="number" :step="step" :min="min ?? undefined" :max="max ?? undefined"
      :value="decimals ? modelValue.toFixed(decimals) : modelValue"
      :disabled="disabled"
      @input="onInput" class="number-stepper-input" :style="{ width }"
    />
    <div class="number-stepper-arrows">
      <button type="button" tabindex="-1" aria-label="Increase" :disabled="disabled" @click="bump(1)">&#9650;</button>
      <button type="button" tabindex="-1" aria-label="Decrease" :disabled="disabled" @click="bump(-1)">&#9660;</button>
    </div>
  </div>
</template>

<style scoped>
.number-stepper { display: inline-flex; align-items: stretch; gap: 6px; }
.number-stepper-input {
  -moz-appearance: textfield; appearance: textfield;
  font-size: 14px; font-weight: 500; padding: 6px 8px;
  border: 1px solid var(--hair); border-radius: 5px;
  background: var(--surface); color: var(--ink); text-align: right;
}
.number-stepper-input::-webkit-outer-spin-button,
.number-stepper-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.number-stepper-arrows { display: flex; flex-direction: column; width: 22px; }
.number-stepper-arrows button {
  flex: 1; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--hair); background: var(--surface-alt); color: var(--ink-3);
  font-size: 7px; line-height: 1; padding: 0; cursor: pointer;
}
.number-stepper-arrows button:first-child { border-radius: 5px 5px 0 0; border-bottom: none; }
.number-stepper-arrows button:last-child { border-radius: 0 0 5px 5px; }
.number-stepper-arrows button:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

.number-stepper-disabled { opacity: 0.5; }
.number-stepper-input:disabled { cursor: not-allowed; }
.number-stepper-arrows button:disabled { cursor: not-allowed; }
.number-stepper-arrows button:disabled:hover { background: var(--surface-alt); color: var(--ink-3); border-color: var(--hair); }
</style>
