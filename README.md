# Futurador

Starter do produto Futurador — plataforma de planejamento de estudos para concursos.

## Stack
- Next.js App Router + React + TypeScript
- CSS responsivo (primeira versão visual)
- Supabase planejado para autenticação, banco PostgreSQL e armazenamento privado
- Vercel planejado para hospedagem

## Rodar localmente

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abra http://localhost:3000.

## Estado atual
Esta entrega contém a primeira página pública responsiva. Os caminhos `/login` e `/cadastro` estão reservados para a próxima etapa; autenticação, persistência, importação real de PDFs, geração de cronograma e cobrança ainda não estão implementadas.

## Próximas etapas
1. Conectar GitHub e criar o repositório privado `futurador`.
2. Criar o projeto Supabase, configurar Auth, tabelas e políticas RLS.
3. Implementar cadastro/login e dashboard do aluno.
4. Integrar processamento de edital e motor determinístico de cronograma.
5. Importar o repositório na Vercel e publicar o domínio `.vercel.app`.

Nunca versionar `.env.local` nem chaves secretas.
