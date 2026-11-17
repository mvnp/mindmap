import './globals.css';
export const metadata = { title: 'Mindmap', description: 'Mapas mentais por projeto' };
export default function RootLayout({ children }) {
  return (<html lang="pt-BR"><body>{children}</body></html>);
}
