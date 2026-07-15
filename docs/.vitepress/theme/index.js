import DefaultTheme from 'vitepress/theme'
import BrowserFrame from './BrowserFrame.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BrowserFrame', BrowserFrame)
  }
}
