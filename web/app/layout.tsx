import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShennongDB · Biomedical Data Infrastructure",
  description: "Discover, govern, and access trusted biomedical data resources."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
