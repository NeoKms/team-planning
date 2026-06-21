# AI-facing change log

## 2026-06-21 — Защита форм и единый QA для test cases/testing

- **`src/views/SprintPlanningView.vue`**: формы задачи и epic теперь спрашивают подтверждение при закрытии, если есть несохраненные изменения. Проверка учитывает в том числе незаблюренные поля длительности. Duration-поля с текущим значением `0 мин` очищаются при фокусе, чтобы можно было сразу вводить новую оценку.
- **`src/components/AppConfirmDialog.vue`**: confirm-dialog поднят на слой `z-[70]`, чтобы предупреждение о несохраненных изменениях отображалось поверх `AppModal` (`z-50`), а не блокировалось формой.
- **`src/domain/scheduling.ts`**: `qa-testing` без ручного исполнителя наследует автоназначенного исполнителя `qa-test-case-writing` той же задачи; simulation-ветка scheduler-а использует то же правило.
- **`src/domain/__tests__/scheduling.test.ts`**: добавлен regression-тест, что автоназначенный QA для testing совпадает с QA, который пишет test cases.
- Проверки: `npm run test`, `npm run build`, `npm run lint`.

## 2026-06-14 — Клонирование спринта

- **`src/stores/planning.ts`**: добавлен action `cloneSprintWithWorkItems(sourceSprintId, input)` — создаёт новый спринт с полной копией всех work items и epics из исходного, перемапливает зависимости и epic-принадлежность, allocation results не копируются. Экспортируется из стора.
- **`src/views/SprintsView.vue`**: кнопка «Скопировать» для каждого спринта (активные — в `hover-actions`, архивные — рядом с остальными). Открывает модалку с предзаполненной формой (название «…(копия)», та же команда/длительность, дата старта = сегодня).

## 2026-06-14 — Навигатор задач в Gantt Timeline

- **`src/composables/useAllocationReport.ts`**: добавлен интерфейс `WorkItemNavItem` и вычисляемое `navItems` (задачи спринта с типом, приоритетом, epicId, epicTitle); экспортируется из хука.
- **`src/components/AllocationTimeline.vue`**: новый опциональный проп `navItems?`; кнопка «≡» в шапке открывает dropdown-список задач, сгруппированных по epic; клик — выделяет бары по `selectedEpicId` или `selectedWorkItemId`; закрытие по click-outside и Escape.
- **`src/views/AllocationView.vue`**, **`src/views/AllocationReportView.vue`**: передают `navItems` из composable в AllocationTimeline.

- **`src/stores/planning.ts`**: `mergeTeamSnapshot` и `mergeSprintSnapshot` больше не затирают существующие сущности при совпадении ID/названия. Импортируемые team/sprint добавляются как копии с новыми ID и суффиксом `(импорт)`, а зависимости внутри sprint/allocation snapshot перепривязываются: work items, epics, assignments, vacations, allocation stages, slots, overflow, warnings и assignment recommendations.
- **`src/composables/useDataExchange.ts`**: импорт разделён на подготовку без записи в стор (`prepareImportFromText`/`prepareImportFromFile`) и применение (`applyImportDraft`). Подготовка определяет destructive full import и совпадения по названиям, чтобы UI мог запросить подтверждение до изменения данных.
- **`src/components/AppConfirmDialog.vue`** и **`src/composables/useConfirmDialog.ts`**: общий confirm-dialog поддерживает multi-choice сценарий через `choose()`; старый `confirm()` сохранён для boolean-подтверждений.
- **`src/App.vue`** и **`src/views/DataExchangeView.vue`**: импорт через `/data`, drag-and-drop и `#import=` на обычных страницах показывает предупреждение при full import или совпадениях. Пользователь может скачать резервную копию текущей рабочей области и импортировать, импортировать без копии или отменить. Shareable report view по-прежнему декодирует данные изолированно без записи в стор.
- Проверки: `npm run build`, `npm run lint`.

## 2026-06-14 — Оптимизация планировщика и advisory-рекомендации

- **`src/domain/planning.ts`**: добавлены типы `SchedulingPolicy`, `SchedulingPolicyPreset` и `AssignmentReplacementRecommendation`. `AllocationResult` теперь может сохранять использованную policy и список advisory-рекомендаций по замене исполнителей.
- **`src/domain/scheduling.ts`**:
  - веса beam search вынесены в `schedulingPolicies` (`release-first`, `balanced`, `critical-path`, `no-overflow`), дефолт — `balanced`;
  - beam search теперь генерирует кандидатов порядка scheduling units, а финальный порядок выбирается через лёгкую симуляцию allocation и objective-score;
  - objective учитывает overflow minutes, late high/critical work, QA/release-sensitive overlaps, release finish, makespan и underload gap;
  - автоназначение незаполненных этапов выбирает исполнителя по earliest completion с учётом текущих занятых окон, отпусков, встреч и capacity;
  - ручные назначения не меняются автоматически: scheduler пробует одиночные замены внутри той же роли и возвращает только advisory-рекомендации с достаточной выгодой (`assignmentRecommendations`);
  - рекомендации по замене ограничены policy-порогами и максимумом рекомендаций за расчёт.
- **`src/composables/useAllocationReport.ts`**: добавлена подготовка `assignmentRecommendations` для отчёта с названиями задач, этапов и исполнителей.
- **`src/views/AllocationReportView.vue`**: вкладка «Рекомендации» показывает блок «Рекомендации по исполнителям». Если такие рекомендации есть, сам таб подсвечивается зелёным actionable-акцентом и получает отдельный бейдж `N замен`; warning/info бейдж остаётся отдельным.
- Блок «Почему этапы стоят так» не добавлен в итоговый UI и не сохраняется в `AllocationResult`: текущие объяснения оказались низкосигнальными и дублировали правила зависимостей/release. Решение — показывать только actionable-рекомендации и warnings.
- Проверки: `npm run lint`, `npm test` (8/8), `npm run build`, локальная проверка report view в браузере.

## 2026-06-14 — Кнопка «Сообщить об ошибке»

- **`src/App.vue`**: добавлена ненавязчивая ссылка «Сообщить об ошибке» в строке навигации (справа, мелкий мутный текст). При клике открывает mailto на `upachko@gmail.com` с автозаполненными темой и телом письма (текущий URL страницы). Вычисляется через `bugReportMailto` computed.
- **`src/views/AllocationReportView.vue`**: в самом низу отчёта добавлен блок «Нашли ошибку или неоптимальный план?» с кнопкой «Скачать экспорт спринта» (видна только для собственных данных, не для shareable-ссылок) и кнопкой «✉️ Сообщить об ошибке». Mailto автозаполняется именем спринта, командой, датой расчёта и URL. `exportAllocationResult` теперь тоже деструктурируется из `useDataExchange`.

## 2026-06-14 (качество расписания — критический путь и fan-out)

Улучшено качество расписания, которое строит scheduler:

**Что добавлено:**
1. **Critical path scoring**: перед beam search строится граф обратных зависимостей и вычисляется `criticalPath(stage) = estimateMinutes + max(criticalPath(downstream))`. Stages с длинной downstream-цепочкой (backend → frontend → QA → release) получают более высокий score → планируются раньше → уменьшается makespan.
2. **Downstream fan-out scoring**: этапы, которые после завершения разблокируют сразу нескольких участников параллельно, получают бонус.
3. Добавлены константы `CRITICAL_PATH_SCORE_FACTOR = 0.1` и `DOWNSTREAM_FAN_SCORE_PER_STAGE = 6`.

**Что убрано (архитектурное решение):**
- `SAME_WORK_ITEM_SCORE_BONUS`, `SAME_ASSIGNEE_SCORE_BONUS`, `CONTEXT_SWITCH_SCORE_PENALTY` — удалены.
- Доказано алгебраически: при отсутствии контекстных бонусов любой вариант расстановки N этапов даёт **одинаковый накопленный score** (сумма static_score - pos*penalty не зависит от порядка). Тогда `serial` тайбрейкер гарантирует победу варианта, где более важные этапы идут первыми. Контекстные бонусы ломали это свойство: они поощряли "сгруппировать этапы одной задачи" в ущерб "запустить длинную цепочку как можно раньше" — что увеличивало makespan при конкуренции за ресурс.

**Добавлены тесты:**
- `schedules the stage with the longer downstream chain before an independent stage` — backend с QA-цепочкой (critPath=240) планируется раньше standalone backend (critPath=120).
- `schedules the stage with more downstream fan-out before one that unblocks nobody` — backend, разблокирующий frontend+QA (fan-out=2), идёт раньше независимого backend (fan-out=0).
- `npm run test` — 8/8. `npm run lint` — чисто. `npm run build` — прошло.

Проведён полный анализ и оптимизация `getOptimizedStageOrder` в `scheduling.ts`:

1. **[Критично] O(n²) → O(1) поиск в beam loop**: добавлено поле `orderedUnitIdSet: Set<string>` в `ScheduleOrderCandidate`; замена `Array.includes()` на `Set.has()` — с ~O(beam × n³) до O(beam × n²).
2. **[Значимо] Предвычисление статичных свойств unit**: добавлен интерфейс `UnitStaticProps` и `unitStaticPropsById: Map<string, UnitStaticProps>`. Все тяжёлые вычисления (`getUnitStages`, sort по `fallbackCompareStages`, new Set построение) вынесены в одноразовый цикл перед beam search — из горячего пути `scoreUnit` убраны повторные `map/filter/sort`.
3. **[Значимо] Кеш scoreUnit в `.sort()`**: `Map<unitId, number>` накапливает баллы в рамках одного `readyUnits.sort()`; score одного unit не пересчитывается более одного раза на позицию.
4. **[Умеренно] Array spread → `.push()`**: исправлены `addStage`, `addReleaseStageToGroup`, `addOccupiedSlot`, `slotsByDate` в `addCoordinationOverlapWarnings`.
5. **[Незначимо] Дешёвый тайбрейкер beam**: `orderedUnitIds.join('|').localeCompare()` заменён на монотонный `serial: number` — O(1) без создания строк.
6. Добавлен `serial: number` в `ScheduleOrderCandidate` и счётчик `candidateSerial` для стабильного тайбрейкера.
- `npm run test` — 6/6. `npm run lint` — чисто. `npm run build` — прошло.

## 2026-06-14 (беклог — корректировка документации в scheduling engine)

- `scheduling.ts`: `documentationStage` убрана из `developmentStageIds` → documentation не блокирует QA testing.
- Документация становится terminal-этапом → `getStageTerminals()` включает её в `releaseDependencyStageIds`, блокируя release support.
- `stageTypeScheduleWeight['documentation']` поднят с 24 до 55 (выше qa-testing=50, ниже release-support=60) для корректной fallback-сортировки.
- Добавлена константа `DOCUMENTATION_DEPRIORITIZE_PENALTY = 40` и применяется в `scoreUnit` для documentation-only units.
- Добавлены 3 теста в `src/domain/__tests__/scheduling.test.ts`: docs не блокирует QA; docs блокирует release support; docs депривиоризирован относительно QA.
- `npm run test` — 6/6. `npm run lint` — чисто. `npm run build` — прошло.

## 2026-06-14 (беклог — индикатор устаревшего расчёта)

- `Sprint` получил необязательное поле `lastDataChangedAt?: string` — ISO-метка последнего изменения данных спринта после расчёта.
- В `stores/planning.ts` добавлены `markSprintDataChanged(sprintId)` и `isSprintAllocationStale(sprintId)` (возвращает `true`, если `lastDataChangedAt > allocationResult.generatedAt`); экспортирован из стора.
- `createWorkItem`, `updateWorkItem`, `deleteWorkItem`, `createEpic`, `updateEpic`, `deleteEpic`, `createVacation`, `updateVacation`, `deleteVacation` теперь вызывают `markSprintDataChanged` вместо `clearAllocationForSprint` — устаревший результат остаётся видимым с баннером-предупреждением.
- `updateTeamMember`: профильные изменения в той же команде помечают все спринты команды как устаревшие; при смене команды — спринты предыдущей команды.
- `SprintPlanningView`: бейдж «Устарел» на кнопке «Открыть расчет» + жёлтый баннер с кнопкой «Пересчитать».
- `AllocationView`: жёлтый баннер ниже заголовка.
- `AllocationReportView`: жёлтый баннер в начале страницы (только собственные данные, не shareable-ссылка).
- `npm run build` — прошло. `npm run lint` — прошло.

## 2026-06-14 о пересечении слотов (`addCoordinationOverlapWarnings`) дата теперь форматируется через `formatDate()` вместо сырой ISO-строки.
- Исправлено: текст совета в предупреждении о пересечении теперь зависит от типов этапов: только `qa-testing` → «Проверьте разграничение тестовых окружений и приоритизацию тестов.»; только `release-support` → «Проверьте окружения, handoff и релизное окно.»; смешанный → «Проверьте разграничение тестовых окружений, handoff и релизное окно.»
- `formatDate` добавлена в импорты `src/domain/scheduling.ts` из `./planning`.

## 2026-06-13

- Исправлено: при первом открытии приложения (пустой localStorage) `loadState()` теперь возвращает пустое состояние вместо seed-данных — демо-данные больше не загружаются автоматически.
- Исправлено: кнопка «Загрузить демо» в онбординге отображается только на последнем слайде (4/4) как основное действие вместо «Закрыть»; «Пропустить» позволяет закрыть без загрузки демо.
- Онбординг: добавлена постоянная подпись «Все данные хранятся только в вашем браузере — без сервера и регистрации».
- Дата старта спринта в демо-данных теперь вычисляется динамически (`nextMondayIso()`), а даты отпусков — от даты спринта через `isoDateAddDays`.
- Расширены демо-данные: две команды (Product Platform — 9 чел., Growth — 3 чел.), два спринта (Sprint 16 — 1 неделя, Growth Sprint 1 — архивный), эпик «Релиз мобильного 2.4» с прод-багами, 5 work items в активном спринте, два отпуска (Кирилл Степанов — весь спринт, Иван Козлов — первый день).
- Рефакторинг: демо-данные вынесены в `src/stores/planning.seed.ts`; `priorityLabelByOrder` перенесена в `src/domain/planning.ts` как чистая доменная функция.

## 2026-06-11

- Добавлен `AGENTS.md` с базовыми правилами работы агента.
- Добавлена директория `tools/ai/memory` для хранения проектного контекста, правил, решений и важных изменений.
- Зафиксированы продуктовая цель, основные сущности планирования, ограничения scheduling engine и живой черновой план реализации приложения.
- Добавлен `implementation-plan.md` с пошаговой очередью реализации для последовательной работы агента.
- Выполнен шаг 1 плана: добавлены доменные типы и константы в `src/domain/planning.ts`, Pinia store `src/stores/planning.ts`, localStorage persistence, seed-данные и минимальный summary в `src/views/HomeView.vue`.
- Добавлен базовый маршрут `/`, чтобы приложение открывалось без Vue Router warnings.
- Удален scaffold store `src/stores/counter.ts`.
- Исправлены npm lint-скрипты с несуществующего пути `team-planning` на реальные пути проекта.
- Подключен Tailwind CSS v4 через `tailwindcss` и `@tailwindcss/vite`; добавлен `src/assets/main.css`, Vite plugin и Tailwind-верстка текущего `HomeView`.
- Выполнен шаг 2 плана: добавлен root layout с навигацией, основные маршруты, рабочий overview и read-only страницы команд, спринтов, конкретного спринта и распределения.

## 2026-06-12

- Выполнен шаг 3 плана: добавлен CRUD команд и участников в `src/stores/planning.ts` и `src/views/TeamsView.vue`.
- Удаление команды теперь каскадно очищает связанные planning data, а удаление участника очищает назначения и результаты распределения.
- Добавлен общий Vue confirm-dialog: `src/components/AppConfirmDialog.vue` и `src/composables/useConfirmDialog.ts`; системные подтверждения удаления в `TeamsView` заменены на него.
- Выполнен шаг 4 плана: добавлен CRUD спринтов в `src/stores/planning.ts` и `src/views/SprintsView.vue`.
- Удаление спринта каскадно очищает задачи, epics и результаты распределения; изменение команды/дат/длительности очищает устаревшие результаты распределения.
- Выполнен шаг 5 плана: добавлен CRUD story/prod bug внутри спринта в `src/stores/planning.ts` и `src/views/SprintPlanningView.vue`.
- Work items теперь поддерживают оценки по направлениям, назначения сотрудников, зависимости, настройку параллельности разработки и релизное сопровождение; изменения задач очищают устаревшие результаты распределения.
- Порядок work items внутри спринта теперь нормализуется в store: вставка в занятое место сдвигает остальные задачи, удаление сжимает порядок.
- Выполнен шаг 6 плана: добавлен CRUD epics внутри `SprintPlanningView`, синхронизация `Epic.workItemIds` и `WorkItem.epicId`, а release support задач внутри epic учитывается на уровне epic.
- Выполнен шаг 7 плана: добавлен `src/domain/scheduling.ts` с первым deterministic scheduling engine и action `planningStore.calculateAllocationForSprint(sprintId)`.
- Выполнен шаг 8 плана: добавлен запуск распределения из `SprintPlanningView`, а `AllocationView` заменен на рабочий экран с Gantt по участникам/дням, summary загрузки, рекомендациями и overflow-блоком.
- Экран распределения можно пересчитать на месте; сохраненный `AllocationResult` отображается после перезагрузки через существующий localStorage persistence.
- Форма story/prod bug теперь разрешает release-only задачи вне epic: оценки могут быть пустыми, если включено релизное сопровождение и указаны минуты сопровождения; внутри epic сопровождение остается на уровне epic.
- Карточки загрузки сотрудников в `AllocationView` теперь показывают назначенную работу, недогруз/перегруз относительно capacity текущего спринта и не считают overflow нагрузкой следующего спринта.
- В `implementation-plan.md` добавлены новые требования: полноэкранный Gantt с timeline-барами, автоназначение исполнителей, рекомендации по переназначению, а также post-MVP пункты про ввод оценок в днях/часах, документацию для backend и учет отпусков.
- Scheduling engine теперь ограничивает один scheduled slot максимумом 1 рабочего дня (360 минут), чтобы большие оценки раскладывались дневными слотами, а невлезшая часть уходила в overflow после текущего спринта.
- Выполнен шаг 9 плана: добавлен общий `useAllocationReport`, переиспользуемый `AllocationTimeline`, полноэкранный report view `/reports/allocation/:sprintId` и ссылки на отчет из `AllocationView`.
- Report view скрывает глобальную навигацию, читает сохраненный расчет из localStorage по `sprintId`, показывает timeline Gantt, дневную детализацию, загрузку участников и рекомендации в формате для скриншота.
- В Post-MVP backlog добавлены пункты про первый запуск без команд, onboarding-инструкцию, переработку форм в UI, более цветной визуальный стиль, корректный header при нескольких командах и главный экран с несколькими актуальными спринтами.
- Timeline Gantt теперь раскладывает пересекающиеся слоты по вертикальным lanes; цветной бар остается строго равен фактическому времени внутри дня, а читаемый текст вынесен в подпись внутри колонки дня. Дни в timeline получили большую минимальную ширину и внутренний горизонтальный скролл.
- В `AllocationTimeline` добавлен переключатель подписей: по умолчанию подписи видны, но их можно скрыть и получить компактный timeline только с барами.
- В компактном режиме `AllocationTimeline` игнорирует вертикальные lanes, показывает бары участника в одну строку и оставляет детали слота в hover-title на самом баре.
- Для компактного режима `AllocationTimeline` добавлены прозрачные hit-зоны и кастомный tooltip по hover/focus/click, чтобы детали показывались надежнее даже на коротких барах.
- Начат шаг 10 плана: scheduling engine теперь учитывает календарь встреч по дням недели, но вычитает из доступности только превышение сверх процессного буфера 2 ч/день; `useAllocationReport` считает capacity карточек загрузки тем же способом.
- Выполнен шаг 10 плана: добавлен optional design review для задач, автоназначение незаполненных исполнителей внутри результата расчета, warnings о пересечениях QA testing/release support, подсказки по пустым оценкам/role mismatch и рекомендации по переназначению при перегрузе.
- `SprintPlanningView` получил блок настройки design review: флаг и оценка; исполнитель всегда показывается как обезличенный `Дизайнер`, а review блокирует только release этой задачи/epic.
- Auto-assignment не мутирует исходные `WorkItem.assignments`: выбранный исполнитель сохраняется только в `AllocationResult.stages` и сопровождается `info` warning.
- В Post-MVP backlog добавлены дизайн-доработки отчета/Gantt: выделять внешнего дизайнера отдельным цветом и визуально отделять release support от остальных типов работ.
- Реализован учёт отпусков участников: добавлен тип `VacationPeriod` в `domain/planning.ts`, поле `vacations: VacationPeriod[]` в `PlanningState`, CRUD в `stores/planning.ts` (actions `createVacation`, `updateVacation`, `deleteVacation`); изменение отпусков очищает результаты распределения затронутых спринтов; удаление участника каскадно удаляет его отпуска.
- Добавлена страница `VacationsView.vue` (`/vacations`) с управлением периодами отпуска: форма добавления/редактирования, список отпусков по участникам, бейджи пересечений со спринтами (полный/частичный отпуск). Добавлен пункт «Отпуска» в основную навигацию.
- Scheduling engine учитывает отпуска: ёмкость сотрудника на дни отпуска равна 0, работа переносится на незанятые отпуском дни. При полном отпуске на весь спринт сотрудник исключается из автоназначения, engine добавляет соответствующий warning. Функция `getSprintWorkingDates` экспортирована из `scheduling.ts`.
- `useAllocationReport` добавляет `vacationDatesByMemberId` (Map memberId → Set рабочих дней отпуска в спринте), фильтрует из рядов участников на полном спринтовом отпуске, пересчитывает `capacityMinutes` без отпускных дней.
- `AllocationTimeline.vue` принимает проп `vacationDatesByMemberId` и: серый фон колонки для дней отпуска, серый бар («Отпуск») с датой в labeled-режиме и tooltip в compact-режиме.
- `AllocationView` и `AllocationReportView` показывают серый блок «🏖 Отпуск» в дневных ячейках Gantt для отпускных дней; «Свободно» не отображается, если день является отпускным.
- `SprintPlanningView` исключает из списков назначений участников, у которых отпуск покрывает все рабочие дни спринта; такие участники выделяются красным с меткой в блоке «Состав команды».
- Добавлена утилита `formatDate(isoDate)` в `domain/planning.ts` — форматирует ISO-дату через `toLocaleDateString()` браузера. Все отображения дат в UI переведены на `formatDate`; хардкодный `DD.MM.YYYY` убран.

## 2026-06-14 (продолжение)

- `AllocationView`: добавлены табы «Timeline Gantt» / «Детализация по дням» (по умолчанию — Gantt). Импортированы `scheduleRows`, `getSlots`, `slotTitle`, `slotDirectionLabel` из `useAllocationReport`; детализация по дням реализована аналогично `AllocationReportView`.
- `AllocationReportView`: «Рекомендации» перенесены из отдельной секции ниже в третий таб `GanttTab = 'gantt' | 'details' | 'recommendations'`. На вкладке «Рекомендации» бейдж с числом замечаний показывается прямо на кнопке таба. Отдельный блок `<section>` рекомендаций удалён — блоки «Прогноз» и «Задачи для трекера» теперь расположены сразу после секции с табами.
- Задачи для трекера уже группировались по сотрудникам (`ticketsByAssignee`) — реализация соответствует требованию.
- Удалён артефакт в начале файла `AllocationReportView.vue` (лишние строки `import type { PlanningState }` и `<placeholder>` перед `<script setup>`).
- В `implementation-plan.md` добавлен backlog-пункт «Индикатор Устаревшего Расчёта»: при изменении данных спринта после выполненного расчёта показывать пользователю предупреждение о необходимости пересчёта.



- Выполнен шаг 14 плана: в `useAllocationReport` добавлены вычисляемые `sprintTickets` и `workItemOutcomes`; экспортированы интерфейсы `SprintTicket`, `WorkItemOutcome`, `WorkItemOutcomeRow`, `WorkItemOutcomeGroup`.
- `sprintTickets`: для каждого этапа с работой только в текущем спринте строится список tracker-задач. QA-этапы (`qa-test-case-writing`, `qa-testing`) — 1 задача на всю оценку; остальные этапы режутся на задачи не более 1 рабочего дня (360 мин) каждая.
- `workItemOutcomes`: каждая задача спринта относится к категории по наивысшему завершённому в спринте этапу: «🚀 Релиз» → «✅ Полное тестирование» → «⚙️ Завершение разработки» → «🔄 В работе». Epic-level release stages учитываются для всех work items epic.
- `AllocationReportView` получил два новых блока внизу: «Прогноз по задачам спринта» (4 цветных колонки по категориям) и «Задачи для заведения в трекер» (список по work items с разбивкой на tracker-задачи по исполнителям и этапам).
- В `implementation-plan.md` добавлен backlog-пункт «Корректировка Документации В Scheduling Engine»: документация не блокирует QA testing, имеет наименьший приоритет для взятия в работу, но блокирует release support.

 добавлен отдельный раздел `/data` (`DataExchangeView.vue`) для полного импорта/экспорта, экспорта команд, спринтов и результатов распределения, загрузки демо-данных и очистки рабочей области.
- Импорт `.tpdata`/JSON вынесен из главного экрана, команд и спринтов в `/data`; в рабочих разделах оставлены экспорты и ссылки на раздел данных.
- В `App.vue` добавлен глобальный drag-and-drop импорт файла в окно приложения, кроме report view.
- Добавлен общий `formatDuration(minutes)` в `domain/planning.ts`; длительности в отчетах, карточках загрузки, рабочем месте спринта, командах и scheduling warnings показываются в днях/часах/минутах.
- Полный импорт legacy state теперь проходит через `migrateState`, а merge sprint snapshot устойчив к snapshot без `vacations`.
- Исправлена Vue lint-ошибка в `AllocationTimeline.vue`: `v-if` для отпускных подписей перенесен на wrapper template.
- В Post-MVP backlog закрыты пункты про ввод оценок в днях/часах/минутах, backend-документацию, первый запуск без команд, onboarding, удаление общей вкладки распределения и автоочистку старых allocation results.
- Оценки задач, design review и release support теперь вводятся одним текстовым полем, которое принимает `2д`, `12ч`, `45м`, смешанный формат `2д 3ч 15м` или число минут; данные по-прежнему сохраняются в минутах.
- В `WorkEstimates` добавлено поле `documentation`; scheduling engine создает отдельный backend-stage `documentation`, а UI показывает документацию отдельным бейджем без смешивания с dev/QA.
- `App.vue` показывает dismissible onboarding walkthrough из 4 слайдов с примерами команды, задачи, распределения и отчета; отдельный prompt создания только первой команды удален.
- Общая вкладка «Распределение» удалена из основной навигации, `/allocation` редиректит на `/sprints`, а `AllocationView` больше не выбирает первый спринт неявно.
- `migrateState` дополняет legacy work item/epic структуры дефолтами и очищает сохраненные `allocationResults` для спринтов, архивных более 14 дней.
- Формы создания команд, участников, спринтов, epics и задач вынесены из правых панелей в общий `AppModal`; кнопки создания находятся в заголовках рабочих экранов, редактирование по-прежнему открывается по действию.
- Визуальный стиль усилен цветной иерархией: шапка получила цветные summary-карточки и teal active nav, а быстрые действия главного экрана — разноцветные рабочие карточки.
- Из разделов «Команды» и «Спринты» убраны правые блоки «Обмен данными»; рабочие списки теперь занимают всю ширину, а статус экспорта показывается inline.
- Из рабочего места конкретного спринта убрана правая колонка «Состав команды»; список задач и epics занимает всю ширину, при этом учет полных отпусков в назначениях сохранен.
- `AppModal` теперь закрывается по Escape и клику по затемненному фону.
- Порядок навигации изменен на «Обзор», «Спринты», «Команды», «Отпуска», «Импорт/экспорт».
- В `TeamsView` добавлен компактный переключатель команд при наличии нескольких команд, чтобы не прокручивать состав первой команды ради перехода ко второй.
- С главной страницы убраны карточка быстрого доступа и правый блок «Импорт/экспорт»; раздел остается доступен через верхнюю навигацию.
- Выполнен шаг 12 плана: summary "В спринте" и загрузка сотрудников теперь считают только рабочие дни текущего спринта, а overflow показывается отдельно как прогноз "После спринта".
- Scheduler заменил модель "занято до конца дня" на занятые интервалы внутри дня: обычные задачи могут занимать окна до/между релизными слотами и продолжаться в следующем свободном окне того же дня.
- Перегрузочные рекомендации убраны; вместо них engine добавляет warning, если загрузка сотрудника в текущем спринте ниже 80% capacity.
- Timeline, дневная детализация, overflow-блок и coordination warnings больше не показывают конкретные интервалы времени, только длительность отрезка.
- Цвета iOS/Android разведены от Release/Frontend; в полноэкранный отчет добавлена легенда, а блок загрузки поднят над timeline.
- Внешний `Дизайнер` исключен из блока "Загрузка сотрудников" и summary загрузки, но остается в timeline/day Gantt как внешняя зависимость для design review.
- Выполнен шаг 13 плана: scheduler получил scored beam-search порядок scheduling units вместо простого сортированного greedy; release-группы планируются синхронно как единый unit, а scoring учитывает приоритет, release urgency, раннее завершение, контекстные переключения и продолжение того же work item/assignee.
- Добавлен Vitest и `npm run test`; fixture tests покрывают preemption релиза перед bulk-work того же приоритета, синхронный старт release-группы с разными длительностями ролей и зависимость downstream-задачи от upstream QA terminal stage.
- Убраны предупреждения «Этап X выходит за границы спринта» из scheduling engine: overflow-нагрузка уже отражается отдельным блоком «После спринта» и такие warnings не несут дополнительной ценности в секции рекомендаций.
- Показ онбординга привязан к мажорной версии приложения: вместо булева флага `team-planning:onboarding-dismissed` в localStorage хранится мажорная версия под ключом `team-planning:onboarding-seen-version`. При смене мажорной версии онбординг автоматически показывается заново. Версия `package.json` поднята до `1.0.0`.
- В `vite.config.ts` добавлен `define: { 'import.meta.env.APP_VERSION': JSON.stringify(pkg.version) }` для инъекции версии в код фронтенда; `env.d.ts` расширен интерфейсом `ImportMetaEnv.APP_VERSION`.
- Кнопка «Скопировать ссылку на отчёт» добавлена в заголовок `AllocationReportView` (рядом со summary-карточками). Из `AllocationView` убраны все ref/функции, связанные с копированием ссылки; там остался только «Открыть полный отчет».
- `getAllocationShareableLink` генерирует URL вида `/reports/allocation/:sprintId#import=...` — получатель попадает сразу на страницу полного отчёта.
- Открытие отчёта по shareable-ссылке полностью изолировано от рабочего пространства: `useAllocationReport` получил опциональный параметр `stateOverride: Ref<PlanningState | null>` — все данные (allocationResults, teams, members, workItems, epics, vacations) берутся из него, а не из глобального стора. `AllocationReportView` декодирует `#import=` в `localState` через `decodeAllocationState` и никогда не вызывает `importFromText` / `mergeSprintSnapshot`; localStorage остаётся нетронутым.
- `useDataExchange` получил две новые функции: `decodeAllocationState(encoded)` — декодировать base64 payload в `PlanningState` без импорта в стор; `createShareableLinkFromState(sprintId, state)` — сгенерировать shareable link из произвольного `PlanningState`.
- Флеш онбординга при открытии по ссылке устранён: `App.vue` вычисляет `startsOnReportPath` из `window.location.pathname` синхронно во время setup (до асинхронного разрешения ленивого маршрута), и `shouldShowOnboarding` учитывает этот флаг.
- `App.vue.onMounted` пропускает обработку `#import=` если `startsOnReportPath` — с этим занимается сам `AllocationReportView`.
- Добавлен composable `src/composables/useReviewPrompt.ts` и тост в `App.vue`: через 2 минуты просмотра страниц `allocation-report` или `sprint-allocation` показывается ненавязчивый тост «Как вам инструмент?» со ссылкой на Google-форму `https://forms.gle/AxddU7u4oGxsDNeq7`. Тост показывается не чаще одного раза в 5 дней (localStorage-ключ `team-planning:review-last-shown`). Тост появляется и при просмотре отчёта, открытого по shareable-ссылке.
- `SprintPlanningView`: кнопка «Распределить нагрузку» скрывается, если для спринта уже есть сохранённый `AllocationResult`; вместо неё «Открыть расчет» подсвечивается как primary-action. Если результата нет — «Распределить нагрузку» виден как primary, «Открыть расчет» в нейтральном стиле.
- `AllocationReportView`: в шапке полного отчёта добавлена кнопка «← Вернуться к распределению» (ссылка на `sprint-allocation`), которая отображается только если отчёт открыт из собственных данных пользователя (не по shareable-ссылке, т.е. `localState === null`).
- `AllocationTimeline`: добавлено выделение задач по клику. Клик по label-карточке (режим с подписями) или hit-зоне бара (компактный режим) выделяет задачу или epic — все остальные бары тускнеют (opacity-20/25). Повторный клик или клик по фону снимает выделение. Индикатор выделения с именем задачи и кнопкой «✕ Снять выделение» появляется над таймлайном. Для эпических этапов выделяются все бары принадлежащего epic. Поле `epicId` добавлено в `AllocationTimelineBar`.
