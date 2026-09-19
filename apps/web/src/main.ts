import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import { enableViaQuery } from './composables/useFeatureFlag'
import './styles/main.css'

// 在创建 app 之前扫描 URL query 启用调试 flag
// 例：`?feature=selection_batch_generate` 启用本特性灰度
enableViaQuery()

createApp(App).use(createPinia()).use(router).use(ElementPlus).mount('#app')
