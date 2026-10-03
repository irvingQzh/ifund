import axios from 'axios'
import { API_BASE_URL, AUTH_TOKEN_KEY, LOGIN_URL } from '../config'

// API and redirects stay under the deployment prefix, e.g. /qfund/.
const request = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export function redirectToLogin() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  if (window.location.pathname.replace(/\/$/, '') !== LOGIN_URL) {
    window.location.replace(LOGIN_URL)
  }
}

request.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401) {
      redirectToLogin()
    }
    return Promise.reject(error)
  },
)

export default request
