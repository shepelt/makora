import { createRoot } from 'react-dom/client';
// Order matters: Muya's core.css (imported via App → Editor) must come after
// our styles so its `html, body` font (Open Sans) wins, as on main.
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
