declare module 'pdfjs-dist/legacy/build/pdf.js' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(options: any): { promise: Promise<any> };
}
