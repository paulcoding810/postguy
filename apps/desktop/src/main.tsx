import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './lib/monaco';
import { App } from './App';
import { disableAutocorrect } from './lib/noAutocorrect';

disableAutocorrect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
