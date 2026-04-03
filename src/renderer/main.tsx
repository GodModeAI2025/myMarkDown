import React from 'react';
import { createRoot } from 'react-dom/client';
import '@toast-ui/editor/dist/toastui-editor.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
