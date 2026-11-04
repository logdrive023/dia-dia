# Backend e banco de dados — estimativa e decisão

> Data: 04/11/2026 · Base: o app atual (offline, IndexedDB/Dexie, 15 tabelas, versão 1.8) e o backup real
> (`dia-dia_passar-para-outro-celular_2026-11-04.json`, 3 dias, 396 KB).
> Nada foi construído: este arquivo é só a estimativa e a recomendação.

---

## 1. Resposta curta

- **Banco:** relacional. **Entre MySQL e MongoDB, MySQL.** Se puder escolher livremente, **PostgreSQL** é ainda melhor
  (mesma ideia do MySQL, com recursos que este sistema usa bem).
- **Custo para construir com IA:** **cerca de 4 a 8 milhões de tokens** para um backend de sincronização + backup na nuvem
  (o mais útil para ela). **8 a 15 milhões** se as regras de venda/estoque/caixa também passarem a rodar no servidor.
  Só a **modelagem do banco**: **0,3 a 0,6 milhão**.
- **Antes de construir:** o app já funciona sem internet e sem servidor. O backend vale pelo que ele resolve:
  dois celulares sempre iguais (sem “Juntar” manual) e backup automático fora do celular.

---

## 2. MySQL ou MongoDB para este sistema?

O que o sistema é, olhando o código e os dados:

| Característica real do Dia a Dia | Favorece |
|---|---|
| 15 tabelas **ligadas entre si**: venda → peças → movimento de estoque → lançamento de caixa → vale | Relacional |
| Regras que **não podem quebrar**: estoque = começou + movimentos; venda = peças = caixa; vale/fiado fechando | Relacional (transação + chave estrangeira + restrição) |
| Dinheiro em **centavos inteiros**, somas por dia/forma de pagamento, relatórios (mais vendidas, lucro, caixa) | Relacional (SQL soma e agrupa direto) |
| Uma operação mexe em **várias tabelas de uma vez** (vender = venda + peças + estoque + caixa + reserva) | Relacional (transação nativa) |
| Esquema **estável** (campos novos são opcionais) | Qualquer um |
| Volume **pequeno** (~130 KB por dia de uso → ~50 MB/ano) | Qualquer um |
| Funciona **offline** e sincroniza depois | Qualquer um (o trabalho está no protocolo de sincronização, não no banco) |

**Conclusão:** o Dia a Dia é, por natureza, um **livro contábil** (estoque e caixa). Livro contábil pede banco relacional.
No MongoDB, as mesmas garantias (venda e caixa sempre batendo) teriam que ser escritas à mão no código — exatamente o tipo
de lugar onde já tivemos bugs (ver `AUDITORIA-ESTOQUE.md`). O MongoDB só ganharia se os dados fossem documentos soltos
e de formato variável, o que não é o caso.

| | MySQL | PostgreSQL | MongoDB |
|---|---|---|---|
| Transação em várias tabelas | ✅ | ✅ | ✅ (mais custosa, menos natural) |
| Chave estrangeira / restrição (`CHECK`) | ✅ (CHECK desde 8.0.16) | ✅ | ❌ (só no código) |
| Somas e relatórios | ✅ | ✅ | 🟡 (aggregation pipeline) |
| JSON quando precisar (ex.: texto da importação, auditoria) | 🟡 | ✅ `jsonb` | ✅ |
| Hospedagem barata/gerenciada | ✅ | ✅ (Supabase, Neon) | ✅ (Atlas) |
| **Indicado aqui** | **Sim** | **Melhor** | Não |

---

## 3. Modelagem do banco (relacional)

Princípios (vindos do que já aprendemos):

1. **IDs UUID** gerados no celular (o app cria registros offline). `CHAR(36)` no MySQL (ou `BINARY(16)`), `uuid` no Postgres.
2. **Dinheiro em centavos** (`BIGINT`), nunca decimal.
3. **Só acrescenta** onde é fato: movimentos de estoque, lançamentos de caixa, vales, auditoria. Correção = registro novo.
4. **Toda linha tem** `store_id` (loja), `updated_at`, `device_id` (qual celular) e `deleted_at` (exclusão “soft”, igual ao app).
5. **Versão de sincronização:** `row_version BIGINT` crescente no servidor → o celular pede “o que mudou depois da versão X”.

### Tabelas novas (só existem por causa do servidor)

| Tabela | Para quê |
|---|---|
| `stores` | a loja |
| `users` | quem usa (o “Seu nome” vira login simples) |
| `devices` | cada celular (substitui o código do “Juntar”) |
| `sync_cursor` | até onde cada celular já recebeu |

### Tabelas do app (mesmas de hoje, com chaves)

| Tabela | Chave única / estrangeira principal | Observação |
|---|---|---|
| `groups` | `(store_id, nome)` entre ativos | |
| `variants` | `group_id → groups` · `(group_id, nome, tamanho)` entre ativas | `cost_cents`, `price_cents` opcionais |
| `daily_records` | `(store_id, date)` **única** | status aberto/encerrado |
| `daily_stock_items` | `(daily_record_id, variant_id)` **única** | `initial_qty`, `current_qty` |
| `stock_movements` | `daily_record_id`, `variant_id`, `order_id?`, `reversed_movement_id?` | só acrescenta |
| `orders` | `daily_record_id` | `total_cents`, `fiado`, `vale_cents`, `status` |
| `sales` (itens) | `order_id → orders` | `qty`, `unit_price_cents`, `returned_qty`, `cost_cents` |
| `reservations` | `variant_id`, `order_id?` | `kind` (reserva/condicional), `due_date` |
| `cash_records` | `daily_record_id` **única** | |
| `cash_movements` | `daily_record_id`, `order_id?` | só acrescenta; `amount_cents > 0` (`CHECK`) |
| `credits` (vales) | `order_id?` | só acrescenta; saldo = soma por cliente |
| `imports` | | texto colado em `JSON`/`TEXT` |
| `audit_logs` | | `old_value`/`new_value` em `JSON` |
| `settings` | `(store_id, key)` **única** | |

**Regras que o banco passa a garantir sozinho** (hoje só o diagnóstico confere):
- uma linha de estoque por dia e cor; um caixa por dia; uma data por loja;
- `qty >= 0` e `amount_cents > 0` onde valem;
- venda, peças, estoque e caixa gravados **na mesma transação** (ou nada).

---

## 4. Estimativa de tokens para construir

Base de cálculo: o app tem ~740 KB de código (≈ 200 mil tokens), dos quais ~216 KB são regras (`services/`, ≈ 60 mil tokens),
e ~320 KB de testes. Em trabalho com agente, **a maior parte do gasto é leitura** (o código é relido a cada passo);
a parte escrita é 5–10 % do total. Os números são **faixas**, não preço fechado.

| Etapa | O que inclui | Tokens (total consumido) | Escrito (saída) |
|---|---|---|---|
| **1. Modelagem do banco** | schema das 19 tabelas, chaves, restrições, migração inicial, dados de teste a partir do backup real | **0,3 – 0,6 M** | 20 – 40 mil |
| **2. API de sincronização** | login simples, enviar/receber mudanças por versão, apagados (tombstones), backup na nuvem, idempotência | **1,5 – 3 M** | 60 – 120 mil |
| **3. Adaptar o app** | sincronizar sozinho quando tiver internet, tela de login/celulares, conflitos (mesma peça vendida nos dois) | **1,5 – 3 M** | 50 – 100 mil |
| **4. Testes e publicação** | testes de sincronização com os dados reais, deploy (servidor + banco), monitoramento básico | **1 – 2 M** | 30 – 60 mil |
| **Total — sincronização + backup** | etapas 1 a 4 | **≈ 4 – 8 M** | |
| *Opcional:* regras no servidor | vender/estoque/caixa/vale/fiado validados também no servidor (dois celulares ao vivo, sem vender a mesma última peça) | **+ 4 – 7 M** | + 150 – 250 mil |
| **Total — backend completo** | | **≈ 8 – 15 M** | |

O que faz o número subir: mudar de ideia no meio (modelo, tecnologia), muitas idas e vindas de tela, pedir “tudo de uma vez”.
O que faz cair: decidir antes as dúvidas de negócio (`AUDITORIA-ESTOQUE.md`, seção 12) e fazer por etapas, com teste ao fim de cada uma.

---

## 5. Recomendação de caminho

1. **AWS:** API em Go numa **EC2** e banco no **RDS** (PostgreSQL, ou MySQL) — ver seção 9.
2. Começar pela **etapa 1 + backup automático na nuvem** (menor custo, maior proteção: hoje “tudo fica só neste celular”).
3. Depois, **sincronização** entre os dois celulares (substitui o “Juntar”).
4. Regras no servidor **só se** os dois celulares venderem ao mesmo tempo com frequência (dúvida nº 8 da auditoria).

**O que não muda:** o app continua funcionando sem internet; o servidor é cópia e ponte entre celulares, não dependência.

---

## 6. Sincronização offline (sem internet → salva no celular → sincroniza quando voltar)

**Complexidade: média.** Metade já existe no app; o cuidado maior é a conexão ruim.

### Já existe hoje
| Parte | Situação |
|---|---|
| Salvar tudo no celular sem internet | ✅ banco local (IndexedDB/Dexie) |
| Cada registro com identificador criado no próprio celular | ✅ |
| Juntar dois lados sem duplicar e repetir sem estragar | ✅ é o “Juntar celulares” (`mergeBackup`), com teste |
| Fatos que só acrescentam (movimentos, caixa, vales) | ✅ evita a maioria dos conflitos |

### Falta construir
1. **Fila de envio (outbox):** toda mudança local entra numa fila; só sai quando o servidor confirmar.
2. **Enviar (push):** pacotes pequenos; se cair no meio, reenvia. O servidor ignora o que já tem (pelo id) → nunca duplica.
3. **Receber (pull):** “o que mudou depois da versão X?”; guarda a versão nova. Caiu no meio: continua de onde parou.
4. **Quando:** ao abrir o app, ao voltar a internet, a cada poucos minutos com o app aberto e no botão “Sincronizar agora”.
5. **Na tela:** “✅ Sincronizado às 14:32” ou “⏳ 5 mudanças esperando internet”.

### Conexão ruim de celular
| Problema | Solução |
|---|---|
| Celular diz “online”, mas não tem internet de verdade | Não confiar em `navigator.onLine`: tentar de verdade, esperar cada vez mais entre tentativas |
| Cai no meio do envio | Pacotes pequenos + envio repetível (idempotente) |
| O mesmo pacote chega duas vezes | Servidor ignora pelo id |
| Relógio do celular errado | Ordem vem da versão do servidor (`row_version`), nunca da hora do celular |
| Celular com versão velha do app | Servidor recusa e pede “atualize o app” |
| iPhone não sincroniza em segundo plano | Sincroniza com o app aberto (limite do iPhone) |
| Os dois celulares vendem a última peça offline | Impossível impedir sem internet; ao sincronizar o app avisa (como o “Juntar” já faz) |

**Atalho possível:** Dexie Cloud (serviço pago, pronto, para apps que já usam Dexie). Economiza o trabalho de sincronização,
mas o banco fica com eles, não num MySQL/Postgres próprio.

---

## 7. Um backend para duas aplicações ou dois?

**Recomendação: um backend só (monólito modular)**, desde que as duas aplicações sejam do mesmo dono/equipe e tenham essência
parecida. É exatamente o que você descreveu: um `root.go` registrando dois grupos de rota.

### Por que um
- Login, sincronização offline, backup, logs e deploy são escritos **uma vez** e servem às duas.
- Um servidor, um deploy, um custo de hospedagem, um lugar para monitorar.
- A sincronização (seção 6) é a parte mais cara: fazer duas vezes seria pagar duas vezes.

### O cuidado que faz funcionar: separar por dentro
```
cmd/server/root.go          → sobe o servidor e registra: diadia.Routes(r) e app2.Routes(r)
internal/shared/auth        → login, lojas, celulares
internal/shared/sync        → fila, push/pull por versão, apagados (igual para as duas)
internal/shared/db          → conexão, transação, migrações
internal/diadia/...         → regras e tabelas do Dia a Dia (estoque, vendas, caixa)
internal/app2/...           → regras e tabelas da outra aplicação
```
- **Rotas com prefixo:** `/api/diadia/...` e `/api/app2/...`.
- **Banco:** um servidor de banco, mas **um schema (ou database) por aplicação** + migrações separadas. Tabela de uma nunca
  é lida direto pela outra; se precisar, passa por uma função do módulo.
- **Toda linha com `store_id`** (e o token diz de qual aplicação é) → um cliente nunca vê dado do outro.
- **Testes por módulo:** mexeu no `app2`, os testes do `diadia` têm que continuar passando antes do deploy.

### Quando valeria separar em dois
| Sinal | Por quê |
|---|---|
| Equipes ou donos diferentes | cada um publica no seu ritmo |
| Uma aplicação com muito mais uso | escalar uma sem pagar pela outra |
| Exigências diferentes (dados sensíveis, contrato, cliente pediu isolamento) | isolamento físico |
| Um deploy de uma está derrubando a outra com frequência | sinal de acoplamento |

Se um dia precisar separar, a estrutura acima permite: `internal/app2` + `shared` viram outro serviço sem reescrever regras.

### Risco principal de um backend só
Um erro num deploy derruba as duas. Mitigação: testes dos dois módulos no CI antes de publicar e, no app, o modo offline —
se o servidor cair, as vendas continuam no celular e sincronizam depois.

---

## 8. Autenticação — o mais forte e simples possível

### Resposta curta
- **JWT combina?** Sim, **como token de acesso curto** (15 min). Não como única peça: JWT não dá para “desligar” antes de vencer.
- **Refresh token?** Sim, e é ele que dá segurança: **opaco** (não é JWT), **guardado com hash no banco**, **um por celular**,
  **trocado a cada uso** (rotação). Dura 60 dias para combinar com o modo offline.
- **Senha:** e-mail + senha com **argon2id**. Mais tarde, se quiser, **passkey** (entrar com a digital/rosto do celular).

### Como funciona
```
1. Login (e-mail + senha)  → servidor confere (argon2id) → registra o celular
   devolve: access JWT (15 min) + refresh opaco (60 dias, só deste celular)
2. Cada chamada            → Authorization: Bearer <access JWT>   (o Go confere a assinatura; não vai ao banco)
3. Access venceu           → POST /auth/refresh com o refresh → novo access + NOVO refresh (o antigo morre)
4. Refresh antigo usado de novo → sinal de roubo → derruba todos os tokens daquele celular (família) e pede login
5. Sair / perdeu o celular → revoga o refresh daquele celular (ou “sair de todos”)
```

### Conteúdo do JWT (pequeno, sem dado sensível)
| Campo | Exemplo | Para quê |
|---|---|---|
| `sub` | id do usuário | quem é |
| `store_id` | id da loja | toda consulta filtra por ele |
| `aud` | `diadia` ou `app2` | **separa as duas aplicações**: o middleware de `/api/diadia` só aceita `aud=diadia` |
| `device_id` | id do celular | sincronização e revogação |
| `exp`, `iat`, `jti`, `iss` | — | validade e rastreio |

Assinatura: **HS256** com segredo forte (um backend só verifica). Se um dia outro serviço precisar verificar, trocar para **EdDSA (Ed25519)**.
No Go: `github.com/golang-jwt/jwt/v5`, **fixando o algoritmo esperado** (recusar `none` e qualquer outro) e conferindo `exp`, `aud` e `iss`.

### Combina com offline?
Sim, porque **vender não depende de token**: o app grava tudo no celular. O token só é usado para sincronizar.
- Sem internet por dias: nada trava; ao voltar, o refresh (60 dias) renova o acesso e sincroniza.
- Refresh vencido (mais de 60 dias sem internet): pede login **sem perder nada** — a fila de envio espera.

### Onde guardar no celular
| Opção | Quando |
|---|---|
| **Cookie HttpOnly + Secure + SameSite** para o refresh | **Escolhido.** Com a AWS (seção 9), app e API ficam no **mesmo domínio próprio** (`app.minhaloja.com` e `api.minhaloja.com`), então o cookie funciona também no iPhone. (No GitHub Pages `*.github.io` com API em outro domínio, o iPhone bloquearia) |
| Refresh no IndexedDB | Se não der o mesmo site. Funciona, mas um script malicioso na página conseguiria ler → manter o app sem scripts de terceiros e com CSP |
| Access JWT | Só na memória (variável); some ao fechar e é renovado pelo refresh |

### Tabelas
| Tabela | Campos principais |
|---|---|
| `users` | `id`, `email` (única), `password_hash` (argon2id), `created_at` |
| `memberships` | `user_id`, `store_id`, `app` (`diadia`/`app2`), `role` (dona/vendedora) |
| `devices` | `id`, `user_id`, `name` (“Samsung da Ana”), `last_seen_at`, `revoked_at` |
| `refresh_tokens` | `id`, `device_id`, `family_id`, `token_hash` (SHA-256), `expires_at`, `used_at`, `revoked_at` |

### O mínimo de proteção (barato e importante)
- **HTTPS** sempre; **CORS** só para a origem do app.
- **Limite de tentativas** no login (por e-mail e por IP) e espera crescente.
- Mensagem de erro igual para “e-mail não existe” e “senha errada”.
- Senha mínima de 10 caracteres; checar contra lista de senhas vazadas se quiser.
- Trocar senha → revoga todos os refresh.
- Tela “Celulares conectados” com “Sair deste celular”.

### Alternativa ainda mais simples (também segura)
**Sessão opaca sem JWT:** um token aleatório por celular, guardado com hash no banco e conferido em toda chamada.
É mais simples e revogável na hora; custa uma consulta ao banco por requisição (irrelevante neste volume).
**JWT + refresh** só compensa por separar as duas aplicações pelo `aud` sem ir ao banco e por ser o padrão mais conhecido.
Qualquer um dos dois é seguro; **não usar** JWT de longa duração sem refresh.

### Custo estimado
Autenticação completa (login, refresh com rotação, celulares, limites, testes): **≈ 0,5 – 1 M tokens**, já dentro da etapa 2
da seção 4.

---

## 9. Hospedagem na AWS (EC2 + banco)

Decisão: quando a API existir de verdade, sai do GitHub Pages e vai para a **AWS**.

### Desenho
```
                  Route 53 (domínio minhaloja.com)
                 /                               \
 app.minhaloja.com                           api.minhaloja.com
 S3 + CloudFront (o app, arquivos)           EC2 (API em Go) ── HTTPS
                                                 │  (rede privada, security group)
                                                 ▼
                                           RDS PostgreSQL (ou MySQL)
                                           sem acesso pela internet
```

| Peça | Escolha | Por quê |
|---|---|---|
| **App (frontend)** | **S3 + CloudFront** em `app.minhaloja.com` | mesmo domínio da API → cookie HttpOnly do refresh funciona no iPhone; HTTPS grátis (ACM) |
| **API** | **EC2** pequena (família `t4g`, ARM, barata) com o binário Go | Go roda leve; um binário, um serviço `systemd` |
| **HTTPS da API** | **Caddy** na EC2 (certificado automático) — ou ALB + ACM quando tiver mais de uma EC2 | Caddy é o mais simples; ALB custa um valor fixo por mês |
| **Banco** | **RDS PostgreSQL** (ou MySQL), instância pequena, **subnet privada** | backup automático diário, restauração para um horário, atualizações de segurança; ninguém de fora acessa |
| **Segredos** | **SSM Parameter Store** (senha do banco, segredo do JWT) | nada de senha no código nem no servidor em texto |
| **Logs** | **CloudWatch** (logs da API + alarme de CPU/erro) | saber quando algo cai |
| **Arquivos/backups extras** | **S3** com versionamento | cópia do backup do app, exportações |

### Segurança mínima na AWS
- **Security group do RDS:** só aceita conexão da EC2 da API (porta 5432/3306). Nunca `0.0.0.0/0`.
- **Security group da EC2:** 443 (HTTPS) aberto; 22 (SSH) **fechado** — entrar pelo **SSM Session Manager**.
- **IAM:** a EC2 tem um papel com permissão só para ler os segredos dela e escrever logs.
- **Conta AWS:** MFA no usuário raiz, não usar o raiz no dia a dia, alerta de gasto (AWS Budgets).
- **RDS:** backup automático ligado (7+ dias) e **proteção contra exclusão**.

### Deploy simples (sem complicar)
1. GitHub Actions: testes do Go → compila o binário (ARM) → envia para a EC2 (SSM ou S3) → reinicia o serviço.
2. Migrações do banco rodam no início do deploy (uma ferramenta só, ex.: `goose` ou `golang-migrate`).
3. Frontend: o mesmo `npm run build` de hoje → envia para o S3 → limpa o cache do CloudFront.

### Custo (ordem de grandeza — conferir)
Para este volume (uma loja, ~50 MB/ano), a menor instância de EC2 e de RDS bastam por muito tempo.
O preço muda por região e tamanho, e **o Free Tier da AWS para contas novas mudou em 2025** (créditos em vez do “12 meses grátis”
de antes) — **confira na [Calculadora da AWS](https://calculator.aws/) antes de criar**. Os maiores custos fixos costumam ser o
RDS e o ALB; por isso Caddy na própria EC2 no começo.

### Ordem para colocar no ar
1. Domínio no Route 53 + certificado (ACM) + app no S3/CloudFront em `app.minhaloja.com` (só mudar de onde o app atual é servido).
2. RDS + migração inicial (seção 3).
3. EC2 com a API: login (seção 8) + backup na nuvem.
4. Sincronização entre celulares (seção 6).

Estimativa de tokens da infraestrutura (Terraform ou passo a passo + scripts de deploy): **≈ 0,5 – 1,5 M**, somar à seção 4.
