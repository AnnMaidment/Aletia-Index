import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'Request a Review',
  description: 'Submit an AI or ML medical device for independent clinical assurance assessment by the Aletia Index team.',
  alternates: { canonical: 'https://www.aletia-index.com/request-review' },
}

export default function RequestReviewLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
