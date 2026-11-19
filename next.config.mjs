/** @type {import('next').NextConfig} */
export default {
  // o proxy.js (verificação de sessão) vê todas as requisições; sem isto o Next guardaria só os primeiros 10 MB do corpo, o que cortaria uploads de arquivos grandes
  experimental: { proxyClientMaxBodySize: '120mb' },
};
