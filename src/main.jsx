import React from 'react';
import ReactDOM from 'react-dom/client';
import DealerTradeApp from './App';

// Polyfill window.storage using localStorage for standalone dev/preview
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const value = localStorage.getItem(key);
      return value !== null ? { value } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
    },
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DealerTradeApp />
  </React.StrictMode>
);
