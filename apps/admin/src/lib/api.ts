/**
 * Session-aware API client — the implementation lives in @restaurant/api-client
 * (shared by web/dashboard/admin). This module wires the app-specific base URL
 * and re-exports the client so existing `../lib/api.js` imports keep working.
 *
 * Session-expiry handling moved out of the fetch layer: AuthContext registers
 * onSessionExpired with the shared client (replacing the old window event).
 */
import { configureApiClient } from '@restaurant/api-client';

configureApiClient({ baseUrl: import.meta.env.VITE_API_URL ?? '/api' });

export { api, ApiError } from '@restaurant/api-client';
