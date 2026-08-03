import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

/*
 * Design typography, self-hosted.
 *
 * The Card Catalog design calls for Spectral (bookish), Archivo (interface) and
 * Courier Prime (typed catalog metadata). These are pulled from @fontsource and
 * bundled by Vite as local woff2, so a self-hosted instance still needs no
 * network access — the previous system-face stacks stay in place as fallbacks.
 */
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/600.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
