import DefaultTheme from 'vitepress/theme';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';
import './custom.css';

export default {
  ...DefaultTheme,
  enhanceApp({app}) {
    app.component('language-switcher', LanguageSwitcher)
  }
}
