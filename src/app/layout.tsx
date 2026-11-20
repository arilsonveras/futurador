import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Futurador — Seu futuro começa no planejamento', description: 'Transforme editais em planos de estudo inteligentes e acompanhe sua evolução.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
