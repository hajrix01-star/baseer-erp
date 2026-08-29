import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Attendance stays server-verified and online-only; installation is best-effort.
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/service-worker.js');
