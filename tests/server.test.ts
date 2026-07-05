import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the SDK — avoid real McpServer initialization
// ---------------------------------------------------------------------------
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    tool: vi.fn(),
    prompt: vi.fn(),
  })),
}))

// ---------------------------------------------------------------------------
// Mock registration modules — spy on whether createServer calls them
// ---------------------------------------------------------------------------
vi.mock('../src/tools/search.js', () => ({
  registerSearchTool: vi.fn(),
}))

vi.mock('../src/tools/fetch.js', () => ({
  registerFetchTool: vi.fn(),
}))

vi.mock('../src/tools/metadata.js', () => ({
  registerMetadataTool: vi.fn(),
}))

vi.mock('../src/tools/citations.js', () => ({
  registerCitationsTool: vi.fn(),
}))

vi.mock('../src/tools/eurovoc.js', () => ({
  registerEurovocTool: vi.fn(),
}))

vi.mock('../src/tools/consolidated.js', () => ({
  registerConsolidatedTool: vi.fn(),
}))

vi.mock('../src/tools/caseLaw.js', () => ({
  registerCaseLawTool: vi.fn(),
}))

vi.mock('../src/tools/transposition.js', () => ({
  registerTranspositionTool: vi.fn(),
}))

vi.mock('../src/prompts/guide.js', () => ({
  registerGuidePrompt: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Reset mocks and module registry between tests for isolation
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ===========================================================================
// Tests S1-S8: createServer() factory function
// ===========================================================================
describe('createServer()', () => {
  it('S1 – createServer returns an McpServer instance', async () => {
    const { createServer } = await import('../src/server.js')
    const server = createServer()

    expect(server).toBeDefined()
    expect(typeof server.connect).toBe('function')
  })

  it('S2 – createServer calls registerSearchTool', async () => {
    const { registerSearchTool } = await import('../src/tools/search.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerSearchTool).toHaveBeenCalledOnce()
  })

  it('S3 – createServer calls registerFetchTool', async () => {
    const { registerFetchTool } = await import('../src/tools/fetch.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerFetchTool).toHaveBeenCalledOnce()
  })

  it('S4 – createServer calls registerGuidePrompt', async () => {
    const { registerGuidePrompt } = await import('../src/prompts/guide.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerGuidePrompt).toHaveBeenCalledOnce()
  })

  it('S5 – createServer calls registerMetadataTool', async () => {
    const { registerMetadataTool } = await import('../src/tools/metadata.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerMetadataTool).toHaveBeenCalledOnce()
  })

  it('S6 – createServer calls registerCitationsTool', async () => {
    const { registerCitationsTool } = await import('../src/tools/citations.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerCitationsTool).toHaveBeenCalledOnce()
  })

  it('S7 – createServer calls registerEurovocTool', async () => {
    const { registerEurovocTool } = await import('../src/tools/eurovoc.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerEurovocTool).toHaveBeenCalledOnce()
  })

  it('S8 – createServer calls registerConsolidatedTool', async () => {
    const { registerConsolidatedTool } = await import('../src/tools/consolidated.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerConsolidatedTool).toHaveBeenCalledOnce()
  })

  it('S9 – createServer calls registerCaseLawTool', async () => {
    const { registerCaseLawTool } = await import('../src/tools/caseLaw.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerCaseLawTool).toHaveBeenCalledOnce()
  })

  it('S10 – createServer calls registerTranspositionTool', async () => {
    const { registerTranspositionTool } = await import('../src/tools/transposition.js')
    const { createServer } = await import('../src/server.js')

    createServer()

    expect(registerTranspositionTool).toHaveBeenCalledOnce()
  })
})
