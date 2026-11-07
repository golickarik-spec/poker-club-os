import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(<App />);
