'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function Cadastro() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/painel`,
      },
    });
    if (error) {
      setMsg(error.message);
      setBusy(false);
      return;
    }
    setMsg(data.session
      ? 'Conta criada! Redirecionando...'
      : 'Conta criada. Confira seu e-mail para confirmar o cadastro.');
    setBusy(false);
    if (data.session) window.location.href = '/painel';
  }

  return (
    <main className="wrap">
      <form className="form" onSubmit={submit}>
        <Link className="brand" href="/">futurador.</Link>
        <h1>Criar conta</h1>
        <p className="muted">Comece gratuitamente sua organização de estudos.</p>
        <div className="field">
          <label htmlFor="name">Nome</label>
          <input id="name" required value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Senha (mínimo 6 caracteres)</label>
          <input id="password" type="password" minLength={6} required value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        {msg && <p className="message">{msg}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Criando conta...' : 'Criar conta'}</button>
        <p className="muted">Já tem uma conta? <Link href="/login">Entrar</Link></p>
      </form>
    </main>
  );
}
