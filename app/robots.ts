import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
      {
        userAgent: ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'CCBot'],
        allow: '/',  // or allow — your call, see below
      },
    ],
    sitemap: 'https://www.aletia-index.com/sitemap.xml',
  }
}