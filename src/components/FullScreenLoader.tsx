'use client';

export default function FullScreenLoader({ message = 'Aguarde enquanto processamos sua solicitação...' }: { message?: string }) {
  return (
    <div className="fullscreen-loader" role="status" aria-live="polite" aria-label={message}>
      <div className="fullscreen-loader-card">
        <div className="loader-orbit"><span /><span /><span /></div>
        <strong>Futurador</strong>
        <p>{message}</p>
        <small>Isso pode levar alguns instantes. Não feche esta página.</small>
      </div>
    </div>
  );
}
