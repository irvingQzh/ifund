// Vite supplies BASE_URL for both VITE_BASE_PATH and the --base CLI option.
export const APP_BASE_URL = import.meta.env.BASE_URL
export const ROUTER_BASENAME = APP_BASE_URL.replace(/\/$/, '') || '/'
export const API_BASE_URL = `${APP_BASE_URL}api`
export const LOGIN_URL = `${APP_BASE_URL}login`

// Deliberately do not read or migrate the legacy generic "token" key.
export const AUTH_TOKEN_KEY = `qfund:${APP_BASE_URL}:access-token`

// Production is private by default. The backend must enforce the same policy.
export const ALLOW_REGISTRATION = import.meta.env.VITE_ALLOW_REGISTRATION === 'true'
  || (import.meta.env.DEV && import.meta.env.VITE_ALLOW_REGISTRATION !== 'false')
export const ALLOW_AI_ANALYSIS = import.meta.env.VITE_ALLOW_AI_ANALYSIS === 'true'
  || (import.meta.env.DEV && import.meta.env.VITE_ALLOW_AI_ANALYSIS !== 'false')

export function apiUrl(path: string): string {
  return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`
}
