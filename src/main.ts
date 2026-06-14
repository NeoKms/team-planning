import { createApp } from 'vue'
import { createPinia } from 'pinia'

import '@fontsource-variable/inter'
import './assets/main.css'
import App from './App.vue'
import router from './router'
import { installPlanningPersistence } from './stores/planning'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

installPlanningPersistence(pinia)

app.mount('#app')
