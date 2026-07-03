import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest'
import http from 'node:http'
import { createApp } from '../src/http.js'

/** Start Express app on a random port, return base URL + close fn + internals */
function startServer() {
  const { app, transports, lastSeen } = createApp()
  const server = http.createServer(app)

  return new Promise<{
    baseUrl: string
    close: () => Promise<void>
    transports: typeof transports
    lastSeen: typeof lastSeen
  }>((resolve) => {
    server.listen(0, () => {
      const addr = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        transports,
        lastSeen,
      })
    })
  })
}

const INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
}

describe('HTTP transport', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) {
      await close()
      close = undefined
    }
  })

  // --- SESSION_TTL_MS ---

  test('SESSION_TTL_MS is exported from constants', async () => {
    const { SESSION_TTL_MS } = await import('../src/constants.js')
    expect(SESSION_TTL_MS).toBeGreaterThan(0)
  })

  // --- createApp shape ---

  test('createApp returns app, transports, and lastSeen', () => {
    const result = createApp()
    expect(result.app).toBeDefined()
    expect(result.transports).toBeInstanceOf(Map)
    expect(result.lastSeen).toBeInstanceOf(Map)
    expect(result.transports.size).toBe(0)
  })

  // --- GET /health ---

  test('GET /health returns 200 with status ok', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'eurlex-mcp-server', activeSessions: 0 })
  })

  // --- POST /mcp errors ---

  test('POST /mcp without initialize request returns 400', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/initialize/i)
  })

  // --- POST /mcp initialize ---

  test('POST /mcp with initialize returns 200 and session ID', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(INIT_BODY),
    })
    expect(res.status).toBe(200)

    const sessionId = res.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()
    expect(srv.transports.size).toBe(1)
    expect(srv.lastSeen.size).toBe(1)
  })

  // --- POST /mcp session reuse ---

  test('POST /mcp reuses existing session and updates lastSeen', async () => {
    const srv = await startServer()
    close = srv.close

    // Initialize
    const initRes = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(INIT_BODY),
    })
    const sessionId = initRes.headers.get('mcp-session-id')!

    // Send initialized notification
    await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    const firstSeen = srv.lastSeen.get(sessionId)
    expect(firstSeen).toBeDefined()

    // Reuse session
    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': sessionId,
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    })
    expect(res.status).toBe(200)
    expect(srv.lastSeen.get(sessionId)).toBeGreaterThanOrEqual(firstSeen!)
  })

  // --- GET /mcp errors ---

  test('GET /mcp without session ID returns 400', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/session/i)
  })

  test('GET /mcp with invalid session ID returns 400', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      headers: { 'mcp-session-id': 'nonexistent' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/session/i)
  })

  // --- DELETE /mcp errors ---

  test('DELETE /mcp without session ID returns 400', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/session/i)
  })

  test('DELETE /mcp with invalid session ID returns 400', async () => {
    const srv = await startServer()
    close = srv.close

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': 'nonexistent' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/session/i)
  })

  // --- DNS rebinding protection (MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS) ---

  describe('DNS rebinding protection', () => {
    let originalAllowedHosts: string | undefined
    let originalAllowedOrigins: string | undefined
    let warnSpy: ReturnType<typeof vi.spyOn> | undefined

    beforeEach(() => {
      originalAllowedHosts = process.env.MCP_ALLOWED_HOSTS
      originalAllowedOrigins = process.env.MCP_ALLOWED_ORIGINS
      delete process.env.MCP_ALLOWED_HOSTS
      delete process.env.MCP_ALLOWED_ORIGINS
    })

    afterEach(() => {
      if (originalAllowedHosts === undefined) delete process.env.MCP_ALLOWED_HOSTS
      else process.env.MCP_ALLOWED_HOSTS = originalAllowedHosts
      if (originalAllowedOrigins === undefined) delete process.env.MCP_ALLOWED_ORIGINS
      else process.env.MCP_ALLOWED_ORIGINS = originalAllowedOrigins
      warnSpy?.mockRestore()
      warnSpy = undefined
    })

    /**
     * Discovers a free port first, then builds the app with MCP_ALLOWED_HOSTS derived
     * from that port — needed because the allowed host list must match the real
     * host:port the test server ends up listening on.
     */
    function startServerWithAllowedHost(computeAllowedHosts: (port: number) => string) {
      return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
        let handler: ReturnType<typeof createApp>['app'] | undefined
        const server = http.createServer((req, res) => handler!(req, res))
        server.listen(0, () => {
          const addr = server.address() as { port: number }
          process.env.MCP_ALLOWED_HOSTS = computeAllowedHosts(addr.port)
          const built = createApp()
          handler = built.app
          resolve({
            baseUrl: `http://127.0.0.1:${addr.port}`,
            close: () => new Promise<void>((r) => server.close(() => r())),
          })
        })
      })
    }

    test('logs a one-line startup warning when MCP_ALLOWED_HOSTS is not set', () => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      createApp()

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]?.[0]).toMatch(/MCP_ALLOWED_HOSTS not set/i)
    })

    test('does not log a warning when MCP_ALLOWED_HOSTS is set', () => {
      process.env.MCP_ALLOWED_HOSTS = 'mcp.honeyfield.at'
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      createApp()

      expect(warnSpy).not.toHaveBeenCalled()
    })

    test('unset MCP_ALLOWED_HOSTS: initialize still works (unchanged behavior)', async () => {
      const srv = await startServer()
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INIT_BODY),
      })
      expect(res.status).toBe(200)
    })

    test('rejects POST /mcp init with a non-allowed Host header', async () => {
      process.env.MCP_ALLOWED_HOSTS = 'mcp.honeyfield.at'
      const srv = await startServer()
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.message).toMatch(/host/i)
      expect(srv.transports.size).toBe(0)
    })

    test('accepts POST /mcp init with an allowed Host header (exact host:port match)', async () => {
      const srv = await startServerWithAllowedHost((port) => `127.0.0.1:${port}`)
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('mcp-session-id')).toBeTruthy()
    })

    test('rejects when the allowed host omits the port the server listens on (exact match required)', async () => {
      // Pins down that allowedHosts must match the Host header verbatim, including
      // the port — this is what makes the README's MCP_ALLOWED_HOSTS=mcp.honeyfield.at
      // example correct only because production runs on the default HTTPS port (443),
      // which browsers omit from the Host header.
      const srv = await startServerWithAllowedHost(() => '127.0.0.1')
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(403)
    })

    test('parses comma-separated MCP_ALLOWED_HOSTS entries and trims whitespace', async () => {
      const srv = await startServerWithAllowedHost((port) => `  example.com , 127.0.0.1:${port}  `)
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(200)
    })

    test('rejects a non-allowed Origin header when MCP_ALLOWED_ORIGINS is set', async () => {
      process.env.MCP_ALLOWED_ORIGINS = 'https://allowed.example'
      const srv = await startServerWithAllowedHost((port) => `127.0.0.1:${port}`)
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.message).toMatch(/origin/i)
    })

    test('accepts a matching Origin header when MCP_ALLOWED_ORIGINS is set', async () => {
      process.env.MCP_ALLOWED_ORIGINS = 'https://allowed.example'
      const srv = await startServerWithAllowedHost((port) => `127.0.0.1:${port}`)
      close = srv.close

      const res = await fetch(`${srv.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Origin: 'https://allowed.example',
        },
        body: JSON.stringify(INIT_BODY),
      })

      expect(res.status).toBe(200)
    })
  })
})
