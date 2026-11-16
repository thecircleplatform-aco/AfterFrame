import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('standalone-agent-root');
if (!container) throw new Error('standalone-agent-root is missing from index.html');

createRoot(container).render(<App />);
