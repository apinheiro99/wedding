# As fotos de todo mundo — portal privado de fotos do casamento

v1.0.0 · André Pinheiro

Site privado e temporário para a família enviar e baixar **todas as fotos e vídeos originais** do casamento.
Especificação completa: [`casamento_fotos_especificacao_tecnica_v1.0.md`](casamento_fotos_especificacao_tecnica_v1.0.md).

## Arquitetura

```
Browser (Next.js/React — só renderiza e envia intenção)
  → API HTTP (src/app/api/**, route handlers)            ← SSE em /api/events
    → Services / Domain (src/server/services, src/server/domain)
      → PostgreSQL (metadados, estado, fila de jobs)
      → Storage em filesystem/TrueNAS (originais, thumbnails, ZIPs)
  Worker (src/worker/main.ts) — fila no PostgreSQL com FOR UPDATE SKIP LOCKED
```

- **Backend é a verdade**: dedupe, permissões, soft delete, composição de ZIP e estados são decididos no servidor.
- **Upload resumível** estilo tus: `POST /api/uploads` → `PATCH /api/uploads/:id` (header `Upload-Offset`, corpo = chunk) → worker finaliza.
  O tamanho do arquivo em staging é o offset autoritativo. Nada é carregado inteiro em memória.
- **SHA-256 global**: cliente calcula em Web Worker (≤ 1 GiB) e consulta `/api/uploads/check`; o servidor sempre recalcula na finalização.
- **Finalização atômica**: `link()` do staging para `originals/users/<Nome>__<uuid8>/<nome>` (nunca sobrescreve) + commit no banco na mesma transação lógica.
- **ZIPs por pessoa** (~2 GiB, STORE, ZIP64 automático), versões imutáveis `NN_<pkg>_vN.zip`; troca de ponteiro em transação; versões antigas removidas após 12 h.
- **Notificações**: digest após 15 min sem atividade, cada destinatário só recebe uploads dos outros; relatório diário ao admin.

## Rodando em desenvolvimento

Requisitos: Node 20+, PostgreSQL acessível, `ffmpeg`, `libheif-examples` (heif-convert) e `libvips-tools`.

```bash
cp .env.example .env        # preencha PG_*, SESSION_SECRET, senhas de bootstrap
npm install
npm run dev                  # web em http://0.0.0.0:3000 (cria banco + migrations no primeiro boot)
npm run worker:dev           # worker de jobs (outro terminal)
```

- Health: `/health` (processo) · Readiness: `/ready` (banco, migrations, storage)
- E-mails em dev (`EMAIL_PROVIDER=dev`) aparecem em `/dev/mail` — desabilitado em produção.
- Admin: `/admin/login` com `ADMIN_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (criado no primeiro boot).

### Variáveis de ambiente

Veja [`.env.example`](.env.example). Configuração é validada no startup (falha rápido). Principais:
`PG_HOST PG_PORT PG_USER PG_PASSWORD PG_MAINTENANCE_DB PG_APP_DB STORAGE_ROOT SESSION_SECRET FAMILY_BOOTSTRAP_LOGIN FAMILY_BOOTSTRAP_PASSWORD ADMIN_EMAIL ADMIN_BOOTSTRAP_PASSWORD EMAIL_PROVIDER EMAIL_FROM RESEND_API_KEY PACKAGE_TARGET_BYTES UPLOAD_CHUNK_BYTES DIGEST_QUIET_MINUTES SESSION_TTL_DAYS OTP_TTL_MINUTES OTP_MAX_ATTEMPTS APP_BASE_URL`.

Credenciais de bootstrap (família e admin) só são usadas se ainda não existirem no banco; depois são alteradas pelo painel admin.

### Migrations

SQL versionado em `src/server/db/migrations/NNN_nome.sql`, aplicado em ordem no boot sob `pg_advisory_lock`, registrado em `schema_migrations`. Idempotente. Falha de migration impede o serviço e aparece em `/ready`.

## Testes

```bash
npm run typecheck
npm run test:unit
npm run test:int     # PostgreSQL real: cria wedding_test_<hex>, migra, testa e dropa. Exige NODE_ENV=test.
```

Integração usa `PG_TEST_HOST`/`PG_TEST_USER`/`PG_TEST_PASSWORD` e um diretório temporário de storage — nunca o banco ou a pasta de produção.

## Produção (containers atrás do Cloudflare Tunnel)

```bash
docker compose build
STORAGE_HOST_PATH=/mnt/truenas/wedding docker compose up -d
```

- `web` (Next.js UI + API + upload) e `worker` usam a mesma imagem.
- `APP_BASE_URL=https://seu-dominio`, `NODE_ENV=production` → cookies `Secure`.
- `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` (domínio de envio com SPF/DKIM/DMARC).
- Cloudflare: não cachear `/api/*` (as respostas já saem `private, no-store`). O limite de corpo por requisição do Cloudflare é contornado pelos chunks (`UPLOAD_CHUNK_BYTES`, padrão 8 MiB).
- Rate limit usa `CF-Connecting-IP`.

## Storage

```
STORAGE_ROOT/
  originals/users/<Nome>__<uuid8>/   ← originais byte a byte (nunca alterados)
  staging/<upload_id>/data           ← uploads em andamento
  thumbnails/<media_id>/{sm,lg}.webp ← derivados descartáveis
  packages/<user_id>/NN_<pkg>_vN.zip ← ZIPs versionados
  temp/
```

### Recuperação

- Thumbnails/ZIPs podem ser apagados e regenerados (admin → ZIPs → Reconstruir; jobs `MEDIA_PROCESS`).
- Uploads presos em `VERIFYING` são re-enfileirados automaticamente pelo worker.
- Jobs travados em `RUNNING` por mais de 30 min voltam para a fila.
- Originais são a fonte de verdade; o banco guarda `sha256`, nome original e caminho relativo de cada um.

## Segurança

- `.env`, `storage/`, `temp/` e arquivos de VM nunca vão para o git (`.gitignore`); CI roda gitleaks.
- OTP e tokens de sessão só existem como hash no banco; senhas com argon2id.
- Toda rota de mídia/download exige sessão; caminhos físicos nunca são expostos; `abs()` bloqueia path traversal.
- Mutations exigem mesma origem (CSRF) e cookies `HttpOnly; SameSite=Lax`.
