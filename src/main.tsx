import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  registerSW({immediate: true});
}

if (typeof window !== 'undefined' && window.localStorage) {
  try {
    const legacyPrefix = ['creatyxo', '_'].join('');
    const nextPrefix = 'klick_';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(legacyPrefix)) {
        const nextKey = nextPrefix + key.slice(legacyPrefix.length);
        if (localStorage.getItem(nextKey) === null) {
          const val = localStorage.getItem(key);
          if (val !== null) localStorage.setItem(nextKey, val);
        }
      }
    }
  } catch {
    // ignore storage access issues
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
