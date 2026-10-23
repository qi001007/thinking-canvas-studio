import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '@/app/StudioApp';
import '../core/presentation/tokens.css';
import './styles/app.css';
import './styles/canvas.css';
import './styles/editor.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<StudioApp />
	</StrictMode>
);