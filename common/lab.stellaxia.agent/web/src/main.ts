import './styles/index.css';
import { boot } from './app/boot';

const root = typeof document === 'undefined' ? null : document.getElementById('app');
if (root) boot(root);
