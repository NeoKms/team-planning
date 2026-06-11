import { onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

const REVIEW_FORM_URL = 'https://forms.gle/AxddU7u4oGxsDNeq7'
const REVIEW_LAST_SHOWN_KEY = 'team-planning:review-last-shown'

// Minimum cooldown between prompts — 5 days
const COOLDOWN_MS = 5 * 24 * 60 * 60 * 1000
// Show automatically after 2 minutes of viewing a result page
const TIMER_DELAY_MS = 2 * 60 * 1000

// Routes that count as "viewing allocation results"
const TRACKED_ROUTE_NAMES = new Set(['allocation-report', 'sprint-allocation'])

export const useReviewPrompt = () => {
  const route = useRoute()
  const showPrompt = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null

  const canShow = (): boolean => {
    if (typeof window === 'undefined') return false
    const last = window.localStorage.getItem(REVIEW_LAST_SHOWN_KEY)
    if (!last) return true
    return Date.now() - Number(last) >= COOLDOWN_MS
  }

  const markShown = () => {
    window.localStorage.setItem(REVIEW_LAST_SHOWN_KEY, String(Date.now()))
  }

  const triggerPrompt = () => {
    if (!canShow()) return
    showPrompt.value = true
    markShown()
  }

  const startTimer = () => {
    if (timer !== null) return // already running
    if (!canShow()) return
    timer = setTimeout(() => {
      timer = null
      triggerPrompt()
    }, TIMER_DELAY_MS)
  }

  const stopTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  // Start timer when entering a tracked route, stop when leaving
  watch(
    () => route.name,
    (newName) => {
      if (newName && TRACKED_ROUTE_NAMES.has(String(newName))) {
        startTimer()
      } else {
        stopTimer()
      }
    },
    { immediate: true },
  )

  // Clean up on page hide / tab close
  const handlePageHide = () => stopTimer()

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide)
  }

  onUnmounted(() => {
    stopTimer()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', handlePageHide)
    }
  })

  const openForm = () => {
    window.open(REVIEW_FORM_URL, '_blank', 'noopener,noreferrer')
    showPrompt.value = false
  }

  const dismiss = () => {
    showPrompt.value = false
  }

  return { showPrompt, openForm, dismiss }
}

