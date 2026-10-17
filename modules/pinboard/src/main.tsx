import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './application/App';
import './styles.css';
import './ui/theme.css';
import './ui/layout.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
