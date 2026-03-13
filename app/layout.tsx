import type { Metadata } from "next";
import "./globals.css";

const BASE_URL = 'https://www.aletia-index.com'

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Aletia Index',
    template: '%s | Aletia Index',
  },
  description: "Independent clinical assurance for AI/ML medical devices. Transparent, data-driven verification for clinicians, NGOs, and manufacturers.",
  verification: {
    google: 'WxzYXPM6Sgp39A7XH2Tgo-RANlWRUJ08Vw7JNfiA9qI',
  },
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    title: "Aletia Index — Clinical Assurance for Digital Health",
    description: "Independent clinical assurance for AI/ML medical devices.",
    url: BASE_URL,
    siteName: "Aletia Index",
    images: [
      {
        url: "/assets/og-cover.png",
        width: 1200,
        height: 630,
        alt: "Aletia Index — Independent verification for clinical AI systems",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aletia Index",
    description: "Independent clinical assurance for AI/ML medical devices.",
    images: ["/assets/og-cover.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/assets/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
