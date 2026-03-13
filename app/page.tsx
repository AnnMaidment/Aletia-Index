import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'AI Medical Device Index',
  description: 'Searchable index of AI and ML medical devices with regulatory clearance status across FDA, MHRA, CE Mark and SAHPRA.',
  alternates: {
    canonical: 'https://www.aletia-index.com',
  },
}

export default function Page() {
  return <HomeClient />
}
