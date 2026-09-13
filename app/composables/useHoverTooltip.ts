// A single floating tooltip (teleported to <body>, positioned via
// getBoundingClientRect + clamping) shared by the Revenue Calendar and
// Nightly Margin pages' Month/Year calendar cells. Replaces an earlier
// per-cell `position: absolute` tooltip that clipped off-screen for cells
// in the rightmost column — a real bug caught by hovering a real cell near
// the viewport edge, not a hypothetical. Generic over the row-shape `T`
// (both pages use the same {label, value, strong?, tone?} TipRow[] shape,
// but this file doesn't need to know that).
export function useHoverTooltip<T>() {
  const rows = ref<T | null>(null)
  const style = ref<{ top: string, left: string }>({ top: '-9999px', left: '-9999px' })
  const tipRef = ref<HTMLElement | null>(null)

  function show(e: MouseEvent, value: T | null | undefined) {
    if (!value) {
      rows.value = null
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    rows.value = value
    nextTick(() => {
      const el = tipRef.value
      if (!el) return
      const tipRect = el.getBoundingClientRect()
      let left = rect.left + rect.width / 2 - tipRect.width / 2
      left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8))
      let top = rect.top - tipRect.height - 6
      if (top < 8) top = rect.bottom + 6
      style.value = { left: `${left}px`, top: `${top}px` }
    })
  }
  function hide() {
    rows.value = null
  }

  return { rows, style, tipRef, show, hide }
}
