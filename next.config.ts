import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O PDF.js precisa resolver seu worker real em node_modules durante a
  // execução da função serverless. Sem externalização, o webpack do Next
  // empacota o build legado e o fake worker procura um arquivo ausente.
  serverExternalPackages: ['pdfjs-dist'],
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
