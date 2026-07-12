import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { MockProvider } from "@/components/mock-provider";

export const metadata: Metadata = {
  title: "ShennongDB · Biomedical Data Infrastructure",
  description: "Discover, govern, and access trusted biomedical data resources."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><MockProvider><NuqsAdapter><QueryProvider>{children}</QueryProvider></NuqsAdapter></MockProvider></body>
    </html>
  );
}
