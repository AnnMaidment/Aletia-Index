import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://www.aletia-index.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://www.aletia-index.com/methodology',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://www.aletia-index.com/insights',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: 'https://www.aletia-index.com/clinicians',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://www.aletia-index.com/request-review',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ]

  const { data: devices, error } = await supabase
    .from('device_master')
    .select('aletia_id, last_automated_sync')
    .eq('excluded', false)

  console.log('[sitemap] device count:', devices?.length ?? 0)
  if (error) {
    console.error('[sitemap] Supabase error:', error)
  }

  const devicePages: MetadataRoute.Sitemap = (devices ?? []).map((device) => ({
    url: `https://www.aletia-index.com/device/${device.aletia_id}`,
    lastModified: device.last_automated_sync
      ? new Date(device.last_automated_sync)
      : new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  return [...staticPages, ...devicePages]
}
