import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Amplify } from 'aws-amplify';
import App from './App.vue';
import router from './router';
import './assets/main.css';
import outputs from '../amplify_outputs.json';

// Amplify設定
// amplify_outputs.jsonはnpx ampx sandboxまたはCI/CDで生成される
// プレースホルダーファイルが存在する場合でも設定を試みる
try {
  if (outputs && outputs.version) {
    Amplify.configure(outputs);
    console.log('Amplify設定を読み込みました');
  }
} catch (error) {
  console.warn('Amplify設定をスキップしました:', error);
}

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount('#app');
