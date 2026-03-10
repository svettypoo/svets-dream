import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    // Enable 1M token context window (max available) for all API calls
    'anthropic-beta': 'context-1m-2025-08-07',
  },
})
