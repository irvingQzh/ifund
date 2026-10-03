import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const configSource = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8')
const requestSource = readFileSync(new URL('../src/api/request.ts', import.meta.url), 'utf8')

function evaluate(source, globals = {}) {
  const exports = {}
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  vm.runInNewContext(outputText, { exports, ...globals })
  return exports
}

function getConfig(base, extra = {}) {
  const env = { BASE_URL: base, DEV: false, ...extra }
  return evaluate(configSource.replaceAll('import.meta.env', JSON.stringify(env)))
}

for (const base of ['/', '/qfund/', '/private/qfund/']) {
  const config = getConfig(base)
  assert.equal(config.APP_BASE_URL, base)
  assert.equal(config.ROUTER_BASENAME, base.replace(/\/$/, '') || '/')
  assert.equal(config.API_BASE_URL, `${base}api`)
  assert.equal(config.LOGIN_URL, `${base}login`)
  assert.equal(config.apiUrl('/fund/123456/ai-analyze'), `${base}api/fund/123456/ai-analyze`)
  assert.equal(config.apiUrl('fund/123456'), `${base}api/fund/123456`)
  assert.equal(config.ALLOW_REGISTRATION, false)
  assert.equal(config.ALLOW_AI_ANALYSIS, false)
  assert.match(config.AUTH_TOKEN_KEY, /^qfund:/)

  const storage = new Map([
    ['token', 'legacy-token-must-not-be-used'],
    [config.AUTH_TOKEN_KEY, 'qfund-token'],
  ])
  const redirects = []
  let axiosOptions
  let beforeRequest
  let onFailure
  const location = {
    pathname: `${base}holdings`,
    replace: (url) => redirects.push(url),
  }
  evaluate(requestSource, {
    require: (name) => {
      if (name === '../config') return config
      assert.equal(name, 'axios')
      return { default: { create: (options) => {
        axiosOptions = options
        return { interceptors: {
          request: { use: (callback) => { beforeRequest = callback } },
          response: { use: (_success, failure) => { onFailure = failure } },
        } }
      } } }
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      removeItem: (key) => storage.delete(key),
    },
    window: { location },
  })
  assert.equal(axiosOptions.baseURL, `${base}api`)
  assert.equal(beforeRequest({ headers: {} }).headers.Authorization, 'Bearer qfund-token')

  const unauthenticated = { response: { status: 401 } }
  await assert.rejects(onFailure(unauthenticated), (error) => error === unauthenticated)
  assert.equal(storage.has(config.AUTH_TOKEN_KEY), false)
  assert.equal(storage.get('token'), 'legacy-token-must-not-be-used')
  assert.equal(beforeRequest({ headers: {} }).headers.Authorization, undefined)
  assert.deepEqual(redirects, [`${base}login`])

  // Failed login must not cause a redirect/reload loop, including trailing slash.
  for (const loginPath of [`${base}login`, `${base}login/`]) {
    location.pathname = loginPath
    await assert.rejects(onFailure(unauthenticated), (error) => error === unauthenticated)
    assert.equal(redirects.length, 1)
  }
  const serverError = { response: { status: 500 } }
  await assert.rejects(onFailure(serverError), (error) => error === serverError)
  assert.equal(redirects.length, 1)
}

assert.equal(getConfig('/qfund/', { VITE_ALLOW_REGISTRATION: 'false' }).ALLOW_REGISTRATION, false)
assert.equal(getConfig('/qfund/', { VITE_ALLOW_REGISTRATION: 'true' }).ALLOW_REGISTRATION, true)
assert.equal(getConfig('/qfund/', { DEV: true }).ALLOW_REGISTRATION, true)
assert.equal(getConfig('/qfund/', { DEV: true, VITE_ALLOW_REGISTRATION: 'false' }).ALLOW_REGISTRATION, false)
assert.notEqual(getConfig('/').AUTH_TOKEN_KEY, getConfig('/qfund/').AUTH_TOKEN_KEY)
assert.equal(getConfig('/qfund/', { VITE_ALLOW_AI_ANALYSIS: 'true' }).ALLOW_AI_ANALYSIS, true)
assert.equal(getConfig('/qfund/', { DEV: true }).ALLOW_AI_ANALYSIS, true)
assert.equal(getConfig('/qfund/', { DEV: true, VITE_ALLOW_AI_ANALYSIS: 'false' }).ALLOW_AI_ANALYSIS, false)

console.log('Qfund deployment checks passed: paths, registration, token isolation, API and 401 redirects.')
