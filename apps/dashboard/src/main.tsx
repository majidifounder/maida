import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext.js';
import { router } from './router.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        {/* Toasts: monochrome surface, semantic color only in the state icon.
            Short-lived — a toast is an acknowledgement, not a task. */}
        <Toaster
          position="top-right"
          gutter={8}
          toastOptions={{
            duration: 2500,
            style: {
              background: '#FFFFFF',
              color: '#0F0F0E',
              border: '1px solid #D8D6D0',
              borderRadius: '8px',
              boxShadow:
                '0 4px 12px rgba(15,15,14,0.08), 0 2px 4px rgba(15,15,14,0.05)',
              fontSize: '13px',
              maxWidth: '360px',
            },
            success: { iconTheme: { primary: '#2E7D48', secondary: '#EAF6EE' } },
            error: {
              duration: 5000,
              iconTheme: { primary: '#C6403E', secondary: '#FBEBEA' },
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
