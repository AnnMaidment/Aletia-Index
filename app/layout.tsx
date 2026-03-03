import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aletia Index — Assessment Listings",
  description: "Independent clinical assurance for AI/ML medical devices. Transparent, data-driven verification for clinicians, NGOs, and manufacturers.",
  openGraph: {
    title: "Aletia Index — Assessment Listings",
    description: "Independent clinical assurance for AI/ML medical devices.",
    url: "https://www.aletia-index.com",
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
    title: "Aletia Index — Assessment Listings",
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
