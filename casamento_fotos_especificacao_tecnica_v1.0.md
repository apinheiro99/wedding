# Especificação Técnica v1.0 — Portal Privado de Fotos e Vídeos do Casamento

**Status:** baseline funcional para implementação
**Data:** 27/09/2026
**Objetivo:** servir como referência de arquitetura, UX, comportamento e testes para uma primeira implementação funcional, especialmente para execução assistida por Claude Code.

---

## 1. Visão do produto

Construir um site privado, temporário e simples para a família compartilhar **todas as fotos e vídeos originais do casamento**, independentemente de terem sido produzidos em iPhone, Android, câmera, computador ou outra origem.

O sistema deve priorizar quatro coisas:

1. **Facilidade extrema para enviar muitos arquivos.**
2. **Preservação absoluta dos arquivos originais.**
3. **Organização por pessoa que enviou os arquivos.**
4. **Facilidade para todos baixarem o material enviado por todos.**

O produto não é rede social, não é Google Photos, não é Immich e não é ferramenta de edição. Ele é um **ponto privado e temporário de troca de arquivos de mídia entre familiares**.

### Mote recomendado

> **As fotos de todo mundo, em um só lugar.**

Subtítulo sugerido:

> Envie as suas. Baixe as de todo mundo. Sem perder o original.

O nome final do site e o domínio **não fazem parte desta especificação** e serão escolhidos depois.

---

## 2. Princípios não negociáveis

### 2.1 Arquivo original é sagrado

O arquivo recebido deve ser persistido **byte a byte como foi enviado**.

O sistema nunca deve:

- recomprimir o original;
- converter o original;
- remover EXIF;
- remover geolocalização;
- alterar timestamps internos;
- modificar orientação;
- alterar codec;
- alterar extensão;
- sobrescrever um original por causa de colisão de nome.

Thumbnails, previews e derivados são arquivos separados e descartáveis.

### 2.2 Formato não deve impedir upload

O sistema deve aceitar e armazenar qualquer arquivo selecionado pelo usuário, sem impor uma lista rígida de formatos suportados.

Formatos conhecidos de imagem e vídeo recebem processamento adicional quando possível.

HEIC/HEIF é **formato de primeira classe** e deve ter tentativa explícita de geração de thumbnail.

Se o servidor não conseguir gerar thumbnail ou preview para um formato raro:

- o upload continua válido;
- o original continua armazenado;
- o arquivo aparece na interface com um placeholder apropriado;
- o usuário continua podendo baixá-lo.

### 2.3 Sem limite funcional arbitrário

Não criar limite funcional artificial de:

- quantidade de arquivos por usuário;
- quantidade total de arquivos;
- tamanho total do álbum;
- tamanho de um arquivo individual.

A arquitetura deve suportar como caso de estresse **seleções da ordem de 50.000 arquivos**.

Isso não significa enviar 50.000 requisições simultâneas. O cliente deve manter uma fila controlada.

### 2.4 Um usuário, um e-mail

O e-mail pessoal é o identificador humano único de cada usuário.

Nomes podem se repetir.

Exemplo válido:

- Maria — maria1@example.com
- Maria — maria2@example.com

Internamente, toda entidade importante deve usar UUID e não display name como chave.

---

## 3. Stack recomendada

### 3.1 Aplicação

- **Next.js** com App Router
- **TypeScript** em todo código novo
- **Node.js** como runtime
- React no frontend
- CSS responsivo; Tailwind CSS é aceitável e recomendado para velocidade de implementação, desde que o design não fique dependente de hacks locais

Next.js será executado como aplicação Node.js self-hosted dentro de container.

### 3.2 Persistência

- **PostgreSQL** existente na infraestrutura do usuário
- camada de acesso a dados centralizada
- preferência: Drizzle ORM + migrations SQL versionadas, ou solução equivalente desde que mantenha migrations explícitas e não espalhe SQL de negócio pela aplicação

O PostgreSQL armazena **metadados e estado**, nunca os blobs originais das fotos/vídeos.

### 3.3 Storage

- TrueNAS montado no host/container
- diretórios separados para:
  - originais
  - uploads temporários/incompletos
  - thumbnails/previews
  - ZIPs gerados
  - arquivos temporários de processamento

### 3.4 Processamento de mídia

Preferência:

- `libvips` / `sharp` para imagens
- `libheif` habilitado para HEIC/HEIF
- FFmpeg/ffprobe para vídeos e metadados de vídeo

O processamento de derivados **nunca modifica o original**.

### 3.5 Upload resumível

Usar protocolo ou implementação de upload resumível compatível com arquivos muito grandes e interrupções, preferencialmente baseado em **tus**.

O protocolo deve permitir:

- criação de upload;
- envio em chunks;
- consulta do offset já persistido;
- retomada após perda de rede;
- cancelamento;
- validação final.

O tamanho de chunk deve ser configurável.

### 3.6 Background jobs

Não adicionar Redis apenas para este projeto.

Implementar inicialmente uma **fila persistida em PostgreSQL** com worker separado.

O worker deve usar claim transacional seguro, por exemplo `FOR UPDATE SKIP LOCKED`, para impedir execução duplicada de um mesmo job.

Tipos iniciais de job:

- finalização de upload;
- SHA-256 autoritativo;
- geração de thumbnail;
- geração de preview de vídeo quando aplicável;
- extração de metadados;
- criação/reconstrução de ZIP;
- digest de notificação;
- relatório diário de administração;
- limpeza de temporários e versões antigas.

### 3.7 Processos/containers

Preferência inicial:

1. `web`: Next.js UI + API de aplicação
2. `upload`: serviço Node dedicado a upload resumível, se necessário para manter o caminho de upload fora do ciclo normal do Next.js
3. `worker`: jobs de background

Todos podem viver no mesmo repositório e compartilhar tipos/pacotes internos.

Se durante a implementação ficar comprovado que `web` consegue servir upload resumível de forma robusta sem comprometer o restante, `upload` pode ser incorporado ao `web`. A robustez tem prioridade sobre reduzir um container.

---

## 4. Topologia de produção

Fluxo esperado:

**Internet → Cloudflare → Tunnel/reverse proxy → containers locais → PostgreSQL + TrueNAS**

Regras:

- não expor diretamente o servidor doméstico;
- TLS termina na borda/proxy apropriado;
- upload grande deve usar chunks suficientemente pequenos para atravessar a infraestrutura intermediária;
- originais não devem passar por cache CDN público;
- downloads exigem sessão autenticada;
- thumbnails podem ter cache privado/controlado.

---

## 5. Inicialização do banco de dados

A aplicação deve partir do pressuposto de que, no primeiro boot, **não existe banco da aplicação**.

### 5.1 Bootstrap

Configuração deve fornecer credenciais de bootstrap com permissão suficiente para verificar/criar o banco.

Sequência no startup:

1. conectar ao PostgreSQL de manutenção;
2. verificar se o database da aplicação existe;
3. se não existir, criar;
4. conectar ao database da aplicação;
5. obter lock de migration/bootstrap;
6. executar migrations pendentes em ordem;
7. validar schema version;
8. criar/validar configurações iniciais necessárias;
9. iniciar serviço somente se o estado estiver consistente.

Startup deve ser **idempotente**.

Executar o serviço duas, dez ou cem vezes não pode recriar tabelas nem destruir dados existentes.

### 5.2 Falhas de migration

Se migration falhar:

- o serviço deve falhar de forma explícita;
- não deve tentar “seguir em frente” silenciosamente;
- health/readiness deve indicar indisponibilidade;
- erro deve ser registrado claramente.

---

## 6. Estrutura lógica de storage

Exemplo conceitual:

```text
/storage/
  originals/
    users/
      <user_uuid>/
        <arquivos originais>
  staging/
    <upload_uuid>/
  thumbnails/
    <media_uuid>/
  previews/
    <media_uuid>/
  packages/
    <user_uuid>/
      <package files/version files>
  temp/
```

### 6.1 Pasta de usuário

Não usar apenas o nome como caminho físico porque nomes podem se repetir e mudar.

Internamente usar UUID.

Para inspeção humana, é aceitável uma pasta física com formato:

```text
Maria-da-Silva__a1b2c3d4/
```

O UUID continua sendo a identidade real.

### 6.2 Nome do arquivo original

Preservar o nome original sempre que não houver colisão dentro da pasta física do uploader.

Se dois arquivos diferentes tiverem o mesmo nome:

```text
IMG_1001.HEIC
IMG_1001 (1).HEIC
IMG_1001 (2).HEIC
```

A extensão deve ser preservada.

Se os bytes forem idênticos, SHA-256 detectará duplicata e nenhuma nova cópia deve ser armazenada.

No banco guardar sempre:

- nome originalmente recebido;
- nome físico final;
- caminho relativo;
- hash;
- tamanho;
- MIME informado;
- MIME detectado quando disponível.

---

## 7. Autenticação e onboarding

O sistema tem dois conceitos separados:

1. **credencial compartilhada da família**, usada somente para autorizar um novo cadastro;
2. **identidade pessoal por e-mail + OTP**, usada depois do cadastro.

### 7.1 Primeiro acesso

Fluxo recomendado:

1. usuário escolhe “Primeiro acesso”;
2. informa e-mail/usuário compartilhado da família + senha compartilhada;
3. servidor valida a credencial compartilhada;
4. abre formulário com:
   - nome de exibição;
   - e-mail pessoal;
5. servidor verifica se e-mail pessoal já existe;
6. envia OTP de seis dígitos;
7. usuário digita OTP;
8. OTP correto cria/ativa o usuário;
9. sessão autenticada é criada;
10. usuário entra no site.

### 7.2 Retorno ao site

1. usuário escolhe “Já tenho acesso”;
2. informa e-mail pessoal;
3. se e-mail existe e está ativo, envia OTP;
4. usuário informa código;
5. sessão autenticada é criada.

Não há senha individual persistente para o usuário comum.

### 7.3 OTP

- 6 dígitos
- validade: **10 minutos**
- máximo: **5 tentativas**
- armazenar somente representação segura/hashed, nunca plaintext permanente
- um OTP usado não pode ser reutilizado
- solicitar novo OTP invalida ou supersede o anterior de maneira clara

### 7.4 Sessão

- duração desejada: **30 dias por dispositivo**
- cookie HTTP-only
- Secure em produção
- SameSite apropriado
- rotação/renovação segura
- logout manual disponível

### 7.5 Nome do usuário

Usuário comum pode alterar seu próprio display name.

Alterar display name não muda:

- UUID;
- e-mail;
- autoria histórica;
- pastas físicas já existentes, salvo rotina explícita futura.

### 7.6 Admin

Admin tem autenticação separada.

Admin não usa a credencial compartilhada da família como credencial administrativa.

Admin inicialmente possui:

- usuário/e-mail administrativo configurado;
- senha própria forte;
- sessão separada;
- autorização por role.

Admin pode usar o site comum como qualquer usuário para testes.

---

## 8. E-mail e entregabilidade

Não é necessário hospedar um servidor de e-mail nem ter mailbox local no domínio do site.

Usar provedor externo de e-mail transacional.

O domínio de envio deve ser autenticado por DNS com:

- SPF;
- DKIM;
- DMARC.

MX só é necessário se futuramente houver intenção de receber e-mail naquele domínio.

### 8.1 Tipos de e-mail

1. OTP de login/cadastro
2. notificação de novas fotos/vídeos
3. relatório diário do administrador

### 8.2 Adapter

Implementar interface de provider para não prender o projeto a um único fornecedor.

Exemplo conceitual:

- `sendOtp(...)`
- `sendNewMediaDigest(...)`
- `sendAdminDailyReport(...)`

Provider real pode ser Resend/Postmark/SendGrid/Mailgun ou equivalente.

---

## 9. Upload

### 9.1 Seleção de arquivos

Suportar:

- múltiplos arquivos;
- seleção em massa;
- drag and drop em desktop;
- seleção de diretório onde o navegador permitir;
- file picker normal como fallback;
- fotos e vídeos vindos da biblioteca do celular.

Seleção de diretório não é garantida igualmente por todos os browsers. Isso deve ser progressive enhancement, não requisito que bloqueie celular.

### 9.2 50.000 arquivos

A UI não pode criar 50.000 componentes pesados simultaneamente.

Requisitos:

- fila virtualizada;
- processamento incremental;
- paginação/virtual scrolling;
- sem gerar thumbnail local de todos os 50.000 de uma vez;
- concorrência configurável;
- backpressure;
- estado persistente da fila.

### 9.3 Concorrência

Default recomendado inicial:

- 4 uploads simultâneos em dispositivos móveis;
- 6 a 8 em desktop, ajustável conforme testes.

Nunca iniciar milhares de uploads simultâneos.

### 9.4 Estados visíveis

Cada arquivo na fila deve possuir estado claro:

- aguardando hash;
- verificando duplicata;
- na fila;
- enviando;
- pausado;
- concluído;
- duplicado;
- restaurado de soft delete;
- erro;
- cancelado.

Painel resumo:

- total selecionado;
- concluídos;
- duplicados;
- restaurados;
- erros;
- pendentes;
- bytes enviados / total;
- velocidade atual;
- estimativa apenas se suficientemente estável; não exibir ETA enganosa.

### 9.5 Pausar e retomar

Usuário pode:

- pausar a fila;
- retomar;
- pausar arquivo individual, se viável;
- repetir erros;
- cancelar pendentes.

Perda de rede deve pausar/repetir automaticamente com backoff.

### 9.6 Fechamento do navegador

Persistir manifest e estado de uploads em IndexedDB/local storage adequado.

A retomada após refresh deve ser suportada.

Após fechamento completo do browser/dispositivo, a aplicação deve recuperar o estado conhecido. Contudo, browsers móveis podem exigir que o usuário selecione novamente o arquivo por limitações de acesso ao filesystem. Ao reselecionar o mesmo arquivo, o sistema deve reconhecer fingerprint/upload incompleto e retomar a partir do offset quando possível.

Não prometer background upload depois que o browser foi encerrado em plataformas que não permitem isso.

---

## 10. Deduplicação SHA-256

### 10.1 Escopo

Deduplicação é **global**, não apenas por uploader.

Se um arquivo byte-identical já existe no sistema, uma segunda cópia não é persistida.

### 10.2 Hash

Usar SHA-256 do arquivo completo como identidade de conteúdo.

O hash armazenado no servidor é autoritativo.

### 10.3 Otimização no cliente

Quando viável, calcular SHA-256 incremental no navegador usando Web Worker para não travar a UI.

Fluxo:

1. cliente calcula hash em chunks;
2. consulta servidor antes de subir bytes;
3. servidor responde:
   - `NEW`
   - `DUPLICATE_ACTIVE`
   - `DUPLICATE_SOFT_DELETED`

Se o cliente não conseguir calcular o hash antecipadamente, o upload ainda é permitido e o servidor calcula o SHA-256 durante/finalizando a transferência.

### 10.4 Duplicata ativa

Se SHA-256 já existe ativo:

- não armazenar nova cópia;
- marcar item como “Duplicado — já existe no álbum”;
- não alterar autoria original automaticamente;
- opcionalmente registrar evento de tentativa de duplicata apenas para auditoria leve.

### 10.5 Duplicata soft-deleted

Se SHA-256 existe, mas o registro está soft-deleted:

- cancelar/evitar nova persistência do conteúdo quando possível;
- restaurar o registro existente;
- limpar `deleted_at`;
- tornar o arquivo visível novamente;
- reagendar thumbnail/package se necessário;
- mostrar ao usuário “Arquivo restaurado — já existia no servidor”.

---

## 11. Finalização de upload

Um upload só vira mídia ativa depois de:

1. todos os bytes chegarem;
2. tamanho final bater;
3. SHA-256 final ser calculado/validado;
4. deduplicação final ser resolvida;
5. original ser movido do staging para posição final;
6. registro de mídia ser commitado no banco.

Preferir operação de filesystem atômica na finalização quando o staging e originals estiverem no mesmo filesystem/dataset.

Se uma etapa falhar, nunca publicar registro apontando para arquivo incompleto.

---

## 12. Metadados

Extrair metadados sem alterar arquivo original.

Campos desejados quando disponíveis:

- capture date/time;
- timezone/original offset se disponível;
- GPS latitude/longitude;
- fabricante;
- modelo da câmera/celular;
- orientação;
- dimensões;
- duração;
- codec;
- resolução de vídeo;
- frame rate;
- creation time de container;
- MIME detectado.

### 12.1 Data canônica para ordenação

Ordem padrão da galeria:

1. data/hora de captura original quando confiável;
2. creation timestamp de mídia/container quando disponível;
3. filesystem/file metadata enviado, se necessário;
4. timestamp de upload como fallback final.

Guardar também qual fonte determinou a data canônica.

---

## 13. Thumbnails e previews

### 13.1 Imagens

Gerar thumbnail separado.

HEIC/HEIF deve ser tentado por libvips/libheif.

Nunca salvar thumbnail por cima do original.

### 13.2 Vídeos

Gerar thumbnail com FFmpeg quando o formato puder ser decodificado.

Reprodução inline é best-effort:

- se o navegador reproduz diretamente, usar original ou rota autorizada adequada;
- se não reproduz, não converter automaticamente o original;
- uma future preview transcode pode ser criada como derivado, se realmente necessário;
- falha de preview nunca invalida upload.

### 13.3 Formato não renderizável

Mostrar card com:

- nome do arquivo;
- tipo/extensão;
- tamanho;
- uploader;
- ícone genérico;
- botão de download.

---

## 14. Galeria

### 14.1 Visão principal

Ordenação padrão: **data da foto/vídeo**.

Controles simples:

- mais antigas → mais novas;
- mais novas → mais antigas;
- por uploader;
- por nome de uploader.

### 14.2 Álbuns por pessoa

Cada usuário possui álbum lógico próprio.

A UI deve permitir navegar por uploader.

Exemplo:

```text
Maria
João
André (você)
Juliana
```

Nomes repetidos são permitidos.

Se for necessário desambiguar, mostrar informação secundária discreta sem expor mais dados do que necessário.

### 14.3 Card de mídia

Exibir somente informação útil:

- thumbnail/placeholder;
- uploader;
- data de captura;
- duração se vídeo.

Nome do arquivo pode aparecer em detalhe/modal, não precisa poluir o grid.

### 14.4 Visualização

Imagem:

- abrir grande;
- próximo/anterior;
- swipe no mobile;
- download;
- soft delete para proprietário;

Vídeo:

- player quando suportado;
- download;
- soft delete para proprietário.

Não implementar:

- comentários;
- curtidas;
- compartilhamento público de item;
- edição de foto;
- renomear arquivo pelo usuário.

---

## 15. Soft delete

Usuário pode excluir mídia que ele enviou.

Comportamento:

- `deleted_at` recebe timestamp;
- mídia desaparece imediatamente para usuários normais;
- original permanece fisicamente no TrueNAS;
- admin ainda consegue visualizar item marcado como deletado;
- package ZIP que contém o item é marcado dirty e precisa ser regenerado;
- thumbnails podem permanecer para administração/cleanup posterior.

Usuário comum não possui hard delete.

Admin pode futuramente ter hard delete explícito, mas isso não deve ser operação acidental nem default.

---

## 16. ZIPs de download

### 16.1 Conceito

Cada uploader tem uma sequência de ZIPs **independentes**.

Exemplo visual:

```text
Maria
  01.zip  1.96 GB
  02.zip  1.92 GB
  03.zip  841 MB
```

`03.zip` pode ser baixado e aberto sem possuir `01.zip` ou `02.zip`.

Não usar multipart ZIP dependente.

### 16.2 Tamanho-alvo

Alvo de package: **aproximadamente 2 GiB**.

É alvo, não limite rígido.

Nunca dividir um arquivo original em partes.

Se um vídeo individual possui 8 GiB, ele pode resultar em um ZIP maior que 8 GiB contendo esse arquivo.

Usar ZIP64 quando necessário.

### 16.3 Compressão

Arquivos de mídia normalmente já são comprimidos.

Default recomendado: armazenar entradas com método de compressão mínimo/STORE quando isso acelerar significativamente a geração e não houver ganho relevante de tamanho.

O objetivo do ZIP é principalmente **agrupamento conveniente**, não recompressão agressiva.

### 16.4 Alocação de arquivo para package

Cada mídia ativa possui `package_id` lógico.

Quando novos arquivos chegam:

1. olhar o último package ativo do uploader;
2. inserir novos arquivos nele enquanto couber razoavelmente no alvo;
3. se exceder, criar próximo package;
4. arquivos maiores que alvo podem receber package dedicado.

Não rebalancear packages antigos só para aproximar todos exatamente de 2 GiB.

### 16.5 Upload adicional

Não criar `update-001.zip`, `update-002.zip` visíveis ao usuário.

Após novos uploads:

- último package afetado é reconstruído;
- novos packages são criados conforme necessário;
- interface continua exibindo somente `01`, `02`, `03` etc.

### 16.6 Exclusão

Quando arquivo sofre soft delete:

- identificar package que contém a mídia;
- marcar somente aquele package como dirty;
- reconstruir somente aquele package;
- não mover arquivos de packages seguintes apenas para preencher espaço liberado.

Isso evita regeneração em cascata.

### 16.7 Concorrência e versão atômica

Nunca substituir um ZIP que está sendo lido por usuários de maneira destrutiva.

Implementação preferida:

1. package atual aponta no DB para uma versão imutável, por exemplo `package_<uuid>_v17.zip`;
2. worker gera `v18` separadamente;
3. valida tamanho, integridade e manifesto;
4. em transação, troca o ponteiro `current_version_id` para v18;
5. novos downloads recebem v18;
6. downloads que já começaram em v17 continuam em v17;
7. v17 vira versão antiga e pode ser removida depois de período seguro.

Isso é preferível a derrubar download em andamento.

### 16.8 Estado do package

Estados possíveis:

- READY
- DIRTY
- BUILDING
- FAILED

Na página de Downloads:

- READY: botão disponível;
- DIRTY/BUILDING sem versão anterior: mostrar “Preparando…”;
- DIRTY/BUILDING com versão anterior ainda válida: pode manter versão anterior disponível com aviso curto ou aguardar a nova, conforme consistência desejada;
- FAILED: não expor arquivo parcial; mostrar falha amigável e permitir retry automático/admin.

Para exclusões, preferir não oferecer versão antiga que ainda contém mídia que o usuário removeu. Nesse caso o package afetado deve ficar temporariamente indisponível até nova versão ficar READY.

Para apenas adições, versão anterior pode continuar disponível enquanto a nova é construída.

---

## 17. Página Downloads

Página autenticada própria.

Lista todos os uploaders, inclusive o usuário atual.

Exemplo:

```text
Maria
[Baixar 01] [Baixar 02] [Baixar 03]

João
[Baixar 01] [Baixar 02]

André (você)
[Baixar 01]
```

Sem opção de ocultar os próprios arquivos.

O usuário pode baixar:

- arquivo individual pela galeria;
- seleção múltipla, quando implementada;
- packages completos por uploader.

Não é necessário “ZIP geral do admin”.

Admin segue a mesma experiência de download dos usuários normais.

---

## 18. Seleção múltipla para download

A galeria deve permitir selecionar vários itens.

Duas opções aceitáveis de implementação:

1. gerar um ZIP temporário ad hoc;
2. quando seleção coincidir com packages completos, reutilizar packages existentes.

Para MVP, pode-se priorizar:

- download individual;
- package por uploader;

Seleção múltipla pode entrar imediatamente depois se aumentar demais a complexidade inicial, mas o modelo de API deve permitir sua inclusão sem reescrever o storage.

---

## 19. Notificações de novas fotos

### 19.1 Regra de consolidação

Usar janela de inatividade de **15 minutos**.

Uploads próximos são consolidados em digest para evitar spam.

### 19.2 Regra por destinatário

Cada destinatário recebe apenas conteúdo enviado por outras pessoas.

Exemplo:

- Maria envia 300 fotos.
- João envia 100 fotos dentro da mesma janela.

André recebe:

- Maria adicionou 300 arquivos.
- João adicionou 100 arquivos.

Maria recebe somente:

- João adicionou 100 arquivos.

João recebe somente:

- Maria adicionou 300 arquivos.

Se, depois de remover a atividade do próprio destinatário, não sobrar novidade de terceiros, aquele destinatário não recebe digest.

### 19.3 Conteúdo do e-mail

Manter curto:

- quem enviou;
- quantidade de fotos;
- quantidade de vídeos;
- volume aproximado;
- link para abrir o site.

Não anexar arquivos.

### 19.4 Desligamento

Admin pode desligar globalmente notificações de novas mídias.

---

## 20. Relatório diário do administrador

Enviar uma vez por dia para o e-mail administrativo configurado.

Conteúdo:

- novos usuários nas últimas 24h;
- usuários totais;
- uploads concluídos;
- fotos novas;
- vídeos novos;
- outros arquivos;
- volume recebido;
- duplicatas detectadas;
- itens restaurados de soft delete;
- erros de upload;
- total acumulado de mídia;
- armazenamento total de originais;
- tamanho de thumbnails/previews;
- tamanho total de packages;
- downloads realizados;
- jobs falhos/retry;
- saúde geral dos serviços.

O relatório é observabilidade humana, não sistema de monitoramento crítico.

---

## 21. Painel administrativo

Manter mínimo.

### 21.1 Necessário

- login separado;
- lista de usuários;
- alterar/corrigir display name;
- visualizar e-mail;
- ver quantidade/volume enviado;
- visualizar mídias ativas e soft-deleted;
- soft delete/restaurar;
- hard delete somente com confirmação explícita e proteção adicional, se implementado;
- ver jobs falhos;
- retry de jobs;
- ligar/desligar notificações de novas mídias;
- alterar credencial compartilhada da família;
- visão básica de armazenamento;
- estado dos ZIPs.

### 21.2 Não necessário

- analytics sofisticado;
- gráficos decorativos;
- RBAC complexo;
- múltiplos níveis administrativos;
- gestão de eventos múltiplos.

---

## 22. Modelo de dados inicial

Nomes exatos podem variar, mas o domínio deve cobrir no mínimo:

### `users`

- id UUID PK
- email unique
- display_name
- email_verified_at
- role (`USER`, `ADMIN`)
- status
- created_at
- updated_at

### `otp_challenges`

- id
- email
- purpose
- code_hash
- attempts
- expires_at
- consumed_at
- created_at

### `sessions`

- id/token hash
- user_id
- expires_at
- created_at
- last_seen_at
- revoked_at

### `uploads`

- id
- user_id
- original_filename
- expected_size
- received_size
- resumable_upload_id/url/fingerprint
- state
- created_at
- completed_at
- failure_reason

### `media`

- id UUID
- uploader_user_id
- sha256 unique
- original_filename
- stored_filename
- relative_path
- byte_size
- mime_reported
- mime_detected
- media_kind
- capture_at
- capture_at_source
- width
- height
- duration_ms
- metadata_json
- thumbnail_state
- preview_state
- deleted_at
- created_at
- updated_at

### `packages`

- id UUID
- user_id
- sequence_no
- target_bytes
- state
- current_version_id
- created_at
- updated_at

Unique recomendado em `(user_id, sequence_no)`.

### `package_items`

- package_id
- media_id
- ordinal

### `package_versions`

- id
- package_id
- version_no
- relative_path
- byte_size
- checksum
- state
- created_at
- retired_at

### `jobs`

- id
- type
- payload JSONB
- state
- priority
- attempts
- available_at
- locked_at
- locked_by
- last_error
- created_at
- completed_at

### `notification_activity`

Registra atividade agregável para digest.

### `download_events`

- id
- user_id
- media_id/package_version_id
- started_at
- completed/bytes quando tecnicamente observável

### `settings`

Configuração persistente simples, validada por schema.

---

## 23. Máquina de estados do upload

Fluxo conceitual:

```text
SELECTED
  -> HASHING
  -> CHECKING_DUPLICATE
      -> DUPLICATE_ACTIVE
      -> RESTORE_EXISTING
      -> QUEUED
  -> UPLOADING
  -> PAUSED
  -> UPLOADING
  -> VERIFYING
  -> FINALIZING
  -> COMPLETE
```

Erros recuperáveis:

```text
UPLOADING -> RETRY_WAIT -> UPLOADING
```

Erro permanente:

```text
* -> FAILED
```

Cancelamento:

```text
QUEUED/UPLOADING/PAUSED -> CANCELLED
```

O backend deve ser a fonte de verdade do estado persistente final.

---

## 24. Concorrência e idempotência

Operações críticas devem ser idempotentes.

Exemplos:

- finalizar upload duas vezes não cria duas mídias;
- job de thumbnail repetido sobrescreve somente derivado correspondente de forma segura;
- job de package repetido gera nova versão, mas só publica versão válida;
- digest não pode ser enviado duas vezes para a mesma janela/destinatário por retry simples;
- criação de usuário deve respeitar unique email;
- SHA-256 unique impede race de duplicatas simultâneas.

Usar constraints no PostgreSQL como última linha de defesa, não apenas checks na aplicação.

---

## 25. Segurança

### 25.1 Requisitos

- todas as páginas de mídia exigem autenticação;
- download exige autorização;
- nenhuma URL de arquivo físico do TrueNAS deve ser pública;
- path traversal bloqueado;
- nome de arquivo sanitizado somente para filesystem/header, preservando original em metadado;
- nunca confiar em MIME informado pelo browser;
- anti-CSRF onde aplicável;
- cookies seguros;
- secrets somente por environment/secret store;
- logs nunca contêm OTP plaintext nem credenciais;
- credencial compartilhada armazenada com password hash forte;
- senha de admin armazenada com password hash forte;
- rate limiting razoável em OTP/login.

### 25.2 “Sem limite de arquivo” não significa “sem defesa”

O produto não impõe limite lógico de tamanho, porém o transporte deve usar chunks configurados e bounded memory.

Nenhum endpoint deve carregar arquivo inteiro em RAM.

---

## 26. Observabilidade

Mínimo necessário:

- `/health` — processo vivo
- `/ready` — DB/storage/migrations disponíveis
- logs estruturados
- request/job correlation id
- métricas simples:
  - uploads ativos
  - bytes recebidos
  - jobs por estado
  - tempo de thumbnail
  - tempo de package
  - falhas de e-mail
  - espaço disponível no storage quando possível

Logs são diagnósticos, não estado canônico.

---

## 27. UX e direção visual

### 27.1 Conceito

O site deve parecer **álbum privado de família**, não dashboard corporativo e não “site de casamento açucarado”.

Palavras-chave:

- quente;
- limpo;
- íntimo;
- simples;
- fotográfico;
- moderno;
- discreto.

### 27.2 Paleta sugerida

Base:

- **Ivory quente:** `#F7F3EE` — fundo principal
- **Branco:** `#FFFFFF` — cards/modais
- **Carvão:** `#24211F` — texto principal
- **Cinza quente:** `#6F6964` — texto secundário
- **Terracota suave:** `#B86F59` — ação primária/destaque
- **Verde sálvia:** `#7E8B78` — sucesso/concluído
- **Âmbar discreto:** `#B9853B` — processamento/atenção
- **Vermelho contido:** `#A84E46` — erro/delete

Evitar gradientes chamativos, neon, azul SaaS genérico e excesso de dourado de casamento.

### 27.3 Tipografia

Preferência:

- UI: Inter, Geist ou system sans moderna;
- título/evento pode usar uma serif discreta apenas se não prejudicar legibilidade;
- máximo duas famílias tipográficas.

### 27.4 Layout mobile first

Mobile:

- header compacto;
- navegação inferior com 4 destinos:
  - Fotos
  - Enviar
  - Downloads
  - Conta
- botão de upload muito evidente;
- grid adaptável;
- ações de seleção acessíveis ao polegar.

Desktop:

- header superior;
- conteúdo central com largura confortável;
- gallery grid mais denso;
- painel de upload com mais detalhes.

### 27.5 Landing/login

Visual extremamente simples:

- título do evento configurável;
- mote;
- “Já tenho acesso”;
- “Primeiro acesso”.

Sem marketing, carrossel ou textos longos.

### 27.6 Página Fotos

Topo:

- título curto;
- contador de fotos/vídeos;
- ordenar;
- filtrar por pessoa;

Corpo:

- masonry/grid estável;
- lazy loading;
- infinite scroll ou paginação transparente;
- sem carregar originals para thumbnails.

### 27.7 Página Enviar

É uma das telas mais importantes.

Deve parecer um gerenciador de transferência, não um formulário.

Elementos:

- grande área “Selecionar arquivos / pasta”;
- resumo da fila;
- progresso global;
- velocidade;
- controles pausar/retomar;
- lista virtualizada;
- status por arquivo;
- filtro rápido: Todos / Enviando / Concluídos / Duplicados / Erros.

### 27.8 Página Downloads

Cards por pessoa.

Cada card:

- nome;
- quantidade de fotos/vídeos;
- volume total;
- botões `01`, `02`, `03` etc.;
- estado “Preparando” quando necessário.

O usuário atual recebe badge discreto “você”.

### 27.9 Acessibilidade

- contraste WCAG razoável;
- foco visível;
- buttons com labels claros;
- navegação por teclado em desktop;
- alt/aria apropriados;
- não depender apenas de cor para estados.

---

## 28. Responsividade e performance

### 28.1 Galeria

- thumbnails otimizados;
- lazy loading;
- dimension metadata para evitar layout shift;
- paginação cursor-based;
- não buscar metadados gigantes no grid.

### 28.2 Upload

- hashing e trabalho pesado em Web Worker quando possível;
- streaming/chunks;
- bounded memory;
- lista virtualizada;
- IndexedDB para fila.

### 28.3 API

- paginação;
- índices de DB adequados;
- queries sem N+1;
- endpoints de bulk status quando útil.

---

## 29. Testes — regra de desenvolvimento

**Nenhuma feature é considerada concluída sem teste de regressão adequado.**

O objetivo não é perseguir cobertura artificial de 100%, mas impedir regressões nos comportamentos centrais.

### 29.1 Unit tests

Cobrir lógica pura:

- filename collision;
- package allocation;
- digest recipient filtering;
- OTP expiration/attempts;
- state transitions;
- ordering date fallback;
- soft-delete restore decision;
- hash/dedupe decision logic.

### 29.2 Integration tests com PostgreSQL real

O nome que estava sendo procurado é **teste de integração**.

Esses testes não usam mock do banco.

Devem usar um PostgreSQL isolado e descartável.

Duas estratégias aceitas:

**Preferida para CI/local automatizado:** Testcontainers sobe PostgreSQL temporário, aplica migrations, executa suite e destrói container.

**Modo compatível com o PostgreSQL existente:** criar database com nome aleatório, por exemplo:

```text
wedding_test_<uuid>
```

Fluxo:

1. conectar usando credencial de teste;
2. criar database isolado;
3. executar migrations exatamente como produção;
4. executar testes;
5. fechar conexões;
6. dropar database em `finally`;
7. falha no teste nunca pode apontar para database de produção.

### 29.3 Proteções obrigatórias de teste

Antes de qualquer suite destrutiva:

- exigir `NODE_ENV=test`;
- database name deve corresponder a padrão seguro (`*_test_*` etc.);
- recusar executar DROP/reset se URL aparentar produção;
- não reutilizar database de desenvolvimento normal.

### 29.4 Integration tests mínimos

- bootstrap de database vazio;
- migration em database vazio;
- migration idempotente;
- usuário único por e-mail;
- OTP lifecycle;
- sessão;
- upload metadata lifecycle;
- SHA-256 unique race;
- duplicate active;
- restore soft-deleted;
- jobs claim/retry;
- package allocation;
- package version switch;
- notification digest;
- download authorization.

### 29.5 Storage integration tests

Nunca testar contra pasta real de produção.

Criar temp directory isolado por teste/suite.

Testar:

- finalize atomic move;
- filename collision;
- no overwrite;
- soft delete não remove original;
- package build;
- package rebuild;
- versão antiga e nova coexistindo;
- cleanup seguro.

### 29.6 Media tests

Manter fixtures pequenas no repositório para:

- JPEG com EXIF;
- HEIC com EXIF/GPS quando legalmente possível criar fixture própria;
- PNG;
- MOV/MP4 curto;
- arquivo não suportado para preview.

Testar que:

- hash original não muda;
- original não é reescrito;
- metadata extraction não altera arquivo;
- thumbnail é derivado;
- falha de thumbnail não perde mídia.

### 29.7 End-to-end tests

Usar Playwright ou equivalente.

Fluxos críticos:

1. primeiro acesso → OTP fake/test → login;
2. retorno por e-mail → OTP → login;
3. upload de arquivo;
4. duplicata;
5. soft delete;
6. restore por novo upload;
7. download individual;
8. package pronto;
9. admin vê soft-deleted;
10. rename display name.

E-mail em teste deve usar provider fake/in-memory, nunca mandar e-mail real.

### 29.8 Regression rule

Todo bug corrigido deve receber teste que falhava antes da correção e passa depois.

---

## 30. CI / Definition of Done

Um commit/PR relevante só está pronto quando:

- TypeScript compila sem erro;
- lint passa;
- unit tests passam;
- integration tests passam;
- migrations aplicam em database vazio;
- migrations aplicam em database já atualizado sem efeito destrutivo;
- E2E crítico passa quando a alteração toca fluxo de usuário;
- build de produção do Next.js passa;
- Docker build passa;
- nenhum secret está no repositório;
- nenhuma mídia fixture privada/pessoal foi adicionada acidentalmente.

---

## 31. Seed e ambiente de desenvolvimento

Dev pode ter seed artificial com:

- admin fake;
- 3–4 usuários fake, inclusive dois com o mesmo primeiro nome;
- imagens geradas/fixtures livres;
- mídia ativa e soft-deleted;
- package ready/building.

Produção **não recebe seed de dados pessoais**.

Primeiro admin deve ser criado por variável segura/bootstrap explícito.

---

## 32. Configuração por environment

Exemplos de categorias de config:

- URL/credenciais bootstrap PostgreSQL
- nome do database da aplicação
- path do storage
- session secret
- credencial compartilhada da família (bootstrap/hashed depois)
- admin bootstrap identity
- e-mail provider credentials
- sender address
- admin report recipient
- package target size (default ~2 GiB)
- upload chunk size
- upload concurrency defaults
- notification digest quiet window (15 min)
- session TTL (30 dias)
- OTP TTL (10 min)
- OTP max attempts (5)
- feature flags simples

Validar config no startup e falhar rápido em config obrigatória inválida.

---

## 33. Rotas/telas funcionais sugeridas

Não é contrato rígido de URL, mas ajuda a implementação:

```text
/
/login
/onboarding
/verify
/photos
/photos/[mediaId]
/albums
/albums/[userId]
/upload
/downloads
/account
/admin
/admin/users
/admin/media
/admin/jobs
```

APIs devem ficar separadas por domínio e não virar um único endpoint genérico.

---

## 34. Critérios de aceite do MVP v1.0

O MVP é considerado funcional quando:

1. ambiente vazio sobe e cria banco/schema corretamente;
2. admin consegue entrar;
3. novo familiar consegue usar credencial compartilhada, cadastrar nome/e-mail e validar OTP;
4. familiar retornando consegue entrar por e-mail + OTP;
5. usuário consegue selecionar vários arquivos e iniciar upload;
6. upload grande é chunked/resumível;
7. interrupção de rede permite retomada;
8. original recebido é byte-identical ao enviado;
9. SHA-256 detecta duplicata global;
10. reenvio de mídia soft-deleted restaura mídia sem armazenar segunda cópia;
11. HEIC é armazenado e thumbnail é gerado quando pipeline suporta;
12. formatos sem preview continuam válidos;
13. galeria mostra mídia ordenada por data de captura/fallback;
14. álbum por uploader funciona;
15. usuário consegue soft-delete próprio arquivo;
16. soft-deleted desaparece para usuários comuns e continua visível para admin;
17. ZIPs independentes por uploader são produzidos;
18. packages têm alvo ~2 GiB e não quebram arquivos individuais;
19. upload adicional afeta somente último package necessário/cria próximos;
20. delete reconstrói somente package afetado;
21. package nunca é publicado parcialmente;
22. download em andamento não é destruído pela publicação de nova versão;
23. página Downloads mostra packages de todos, inclusive do usuário atual;
24. notificação de atividade é consolidada após 15 min e exclui conteúdo do próprio destinatário;
25. admin recebe relatório diário;
26. testes unitários, integração PostgreSQL isolada e E2E crítico passam;
27. aplicação roda self-hosted em containers atrás do proxy/tunnel.

---

## 35. O que fica explicitamente fora do v1.0

- múltiplos casamentos/eventos;
- comentários;
- curtidas;
- rede social;
- link público por foto;
- QR code;
- edição de foto/vídeo;
- reconhecimento facial;
- busca por IA;
- sincronização com Immich;
- upload automático direto para Immich;
- backup externo adicional;
- app nativo Android/iOS;
- cobrança;
- assinatura;
- analytics sofisticado;
- permissões por grupo/família do noivo/noiva;
- renomear original pelo usuário;
- hard delete por usuário comum.

A integração com Immich é um processo posterior e externo ao portal. A principal obrigação deste sistema é deixar os **originais íntegros e organizados no TrueNAS** para que essa migração posterior seja simples.

---

## 36. Ordem de implementação recomendada

### Fase 0 — fundação

- monorepo/repo structure;
- Docker;
- config validation;
- PostgreSQL bootstrap + migrations;
- health/readiness;
- test harness e banco descartável.

### Fase 1 — autenticação

- shared family gate;
- onboarding;
- OTP provider fake + provider real;
- sessão;
- admin separado.

### Fase 2 — storage e upload

- staging;
- resumable protocol;
- fila frontend;
- SHA-256;
- dedupe;
- finalização atômica;
- filename collision.

### Fase 3 — mídia

- metadata;
- HEIC;
- thumbnails;
- vídeo thumbnail;
- gallery.

### Fase 4 — delete/restore

- soft delete;
- admin visibility;
- restore by hash.

### Fase 5 — packages/downloads

- package allocation;
- ZIP64;
- versioning atômico;
- downloads page.

### Fase 6 — notificações

- digest 15 min;
- lógica por destinatário;
- admin daily report.

### Fase 7 — endurecimento

- 50k queue stress;
- large-file tests;
- failure injection;
- storage interruption;
- email failure/retry;
- accessibility;
- production deployment.

Cada fase deve deixar o repositório verde e funcional. Não acumular dezenas de features quebradas esperando uma correção final.

---

## 37. Regras para Claude Code / agente implementador

1. **Não inventar funcionalidades fora desta especificação.**
2. Quando houver ambiguidade técnica, escolher a solução mais simples que preserve dados e permita evolução.
3. Arquivo original nunca pode ser alterado.
4. PostgreSQL é a fonte de verdade de metadados/estado; TrueNAS é a fonte de verdade dos blobs originais.
5. Nenhum job de background pode depender de memória do processo para estado canônico.
6. Todo job importante deve ser idempotente/retry-safe.
7. Toda alteração de schema entra por migration.
8. Nenhum teste destrutivo toca database/storage de produção.
9. Toda feature relevante vem com teste de regressão.
10. Todo bug corrigido ganha teste reproduzindo o bug.
11. Não “resolver” arquivo grande carregando tudo em RAM.
12. Não “resolver” 50.000 arquivos renderizando 50.000 linhas pesadas no DOM.
13. Não converter originais para facilitar thumbnail.
14. Não apagar fisicamente arquivo em soft delete.
15. Não criar cópia física para SHA-256 duplicado.
16. Não expor paths físicos do TrueNAS ao cliente.
17. Não publicar ZIP parcial.
18. Não invalidar download já iniciado ao atualizar package.
19. Se um formato não puder ser previewed, degradar graciosamente.
20. Manter README operacional atualizado: setup, env, migrations, testes, containers, storage e recuperação.

---

## 38. Decisões arquiteturais congeladas nesta v1.0

- Next.js + TypeScript + Node.js.
- Web responsiva única, sem app nativo.
- PostgreSQL para estado/metadados.
- TrueNAS para originals/derivados/packages.
- originais imutáveis.
- HEIC suportado como prioridade.
- formatos não renderizáveis continuam armazenados.
- upload resumível.
- capacidade de lidar com seleção de ~50k arquivos.
- SHA-256 global.
- soft delete preserva arquivo físico.
- reupload de soft-deleted restaura arquivo existente.
- um e-mail por usuário.
- nomes podem repetir.
- shared family credential somente para onboarding.
- login recorrente por e-mail + OTP.
- OTP 6 dígitos / 10 min / 5 tentativas.
- sessão 30 dias.
- admin separado.
- ZIPs independentes por uploader.
- alvo ~2 GiB por package.
- arquivo individual nunca é dividido.
- package afetado por delete é reconstruído isoladamente.
- sem `update-001` visível.
- troca de versões de package sem quebrar download em andamento.
- página Downloads mostra todos os uploaders e o próprio usuário.
- digest de novidades após 15 min de inatividade.
- destinatário não recebe notificação sobre seus próprios uploads.
- relatório diário do admin.
- sem comentários, likes, QR code, link público de foto ou social features.
- testes unitários + integração PostgreSQL isolada + E2E.

---

# Resultado esperado

Ao final, um familiar deve conseguir abrir o site no celular, autenticar-se em poucos passos, selecionar uma quantidade enorme de fotos/vídeos, deixar o upload trabalhando com progresso claro e retomada, e depois encontrar todo o material de todos os familiares em uma galeria simples e numa área de downloads pronta.

O servidor deve fazer a parte complicada sem que o usuário perceba: deduplicar, preservar originais, extrair metadados, gerar thumbnails, organizar packages, reconstruir apenas o necessário, enviar notificações e manter consistência mesmo com interrupções.

A experiência precisa transmitir uma ideia simples:

> **As fotos de todo mundo, em um só lugar.**

