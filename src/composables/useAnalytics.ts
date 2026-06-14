/**
 * Composable для трекинга ключевых пользовательских действий.
 * Отправляет события в Google Tag Manager (dataLayer) и Яндекс.Метрику (reachGoal).
 * На localhost оба счётчика не загружаются, поэтому данные никуда не уйдут.
 */

type AnalyticsEvent =
  | 'allocation_calculated'
  | 'report_link_copied'
  | 'sprint_created'
  | 'team_created'
  | 'data_imported'
  | 'data_exported'
  | 'demo_loaded'
  | 'workspace_cleared'

type EventParams = Record<string, string | number | boolean | undefined>

export function useAnalytics() {
  const track = (event: AnalyticsEvent, params?: EventParams) => {
    // Google Tag Manager
    window.dataLayer = window.dataLayer || []
    window.dataLayer.push({ event, ...params })

    // Yandex.Metrika — reachGoal
    if (typeof window.ym === 'function') {
      window.ym(109847069, 'reachGoal', event, params)
    }
  }

  return { track }
}

