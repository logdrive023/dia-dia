# Melhorias de lógica — Dia a Dia

Histórico das revisões e correções, da primeira revisão (31/10/2026, commit `0c5243d`, 61 testes) até o uso real no celular
(03/11/2026: **199 testes** passando, inclusive com os dados reais do celular). ✅ = corrigido no código.
As rodadas estão em ordem; a mais nova é a **Rodada 5** no fim. Como o sistema funciona hoje: `SISTEMA.md`.

Prioridade: 🔴 corrigir já · 🟠 importante · 🟡 melhoria · ⚪ manutenção

| # | Prioridade | Assunto | Esforço |
|---|---|---|---|
| 1 | ✅ 🔴 | Valor "1.230" é lido como 1,23 | pequeno |
| 2 | ✅ 🔴 | Conferência do caixa mistura Pix/Cartão com dinheiro vivo | médio |
| 3 | ✅ 🟠 | Saída/perda/ajuste pode "comer" peças reservadas | pequeno |
| 4 | ✅ 🟠 | App aberto depois da meia-noite continua no dia anterior | pequeno |
| 5 | ✅ 🟠 | iPhone pode apagar os dados se o app não for instalado | só orientação |
| 6 | ✅ 🟠 | Backup em texto vai ficar grande demais para o WhatsApp | médio |
| 7 | ✅ 🟡 | Transferir variações não checa nomes repetidos | pequeno |
| 8 | ✅ 🟡 | Não dá para pagar uma venda metade Pix, metade dinheiro | médio |
| 9 | ✅ 🟡 | Corrigir preço de venda exige cancelar e refazer | médio |
| 10 | ✅ 🟡 | Cancelar venda que veio de reserva não devolve a reserva | pequeno |
| 11 | ✅ 🟡 | Serviço de cadastro aceita lançar em dia encerrado | pequeno |
| 12 | ✅ 🟡 | Erro de restauração com mensagem técnica | pequeno |
| 13 | ✅ ⚪ | Histórico recalcula todos os dias a cada abertura | médio |
| 14 | ✅ ⚪ | `tsconfig.tsbuildinfo` está versionado | trivial |
| 15 | ✅ ⚪ | Sem testes de tela (ponta a ponta) | médio |

---

## 🔴 1. Valor "1.230" é lido como 1,23

**Onde:** `src/lib/util.ts` → `toCents()`

Sem vírgula, o texto vai direto para `Number()`, que entende o ponto como decimal.

| Digitado | Esperado | Hoje |
|---|---|---|
| `70` | 70 | 70 ✅ |
| `70,50` | 70,50 | 70,50 ✅ |
| `1.230,00` | 1.230 | 1.230 ✅ |
| `1.230` | 1.230 | **1,23** ❌ |
| `12.5` | 12,50 | 12,50 ✅ |

**Impacto:** afeta preço, "Dei dinheiro", retirada, "Ontem" e valor contado. Quem digita "1.230" ao conferir
o caixa grava 1,23 e cria uma diferença falsa.

**Correção:** sem vírgula, tratar o ponto seguido de exatamente 3 dígitos como separador de milhar
(`/^\d{1,3}(\.\d{3})+$/`). Nos outros casos, o ponto continua sendo decimal. Incluir os casos da tabela nos testes.

---

## 🔴 2. Conferência do caixa mistura Pix/Cartão com dinheiro vivo

**Onde:** `src/services/summary.ts` → `cashChain()` · `src/screens/Cash.tsx` → `CountedCard`

O "saldo esperado" é o acumulado de **todas** as formas (Dinheiro + Pix + Cartão), e a conferência compara
esse valor com o que foi **contado na mão**. Com qualquer venda no Pix, a diferença nunca fecha.

Exemplo: Ontem 100 em espécie + venda de 70 em dinheiro + venda de 85 no Pix.
Esperado hoje = 255. Na gaveta há 170. O app mostra diferença de **−85**, que não existe.

**Correção sugerida** (a conta do caderno continua igual):
- Manter o acumulado geral como está (é o "Ontem 645 + 885 = 1530 − 300 = 1230").
- Calcular também o **saldo por forma**: `dinheiro em mãos`, `Pix na conta`, `Cartão a receber`. Cada
  lançamento já guarda `paymentMethod`, então o dado existe.
- A conferência ("valor contado") passa a comparar só com o **dinheiro em mãos**.
- Encadear o saldo de dinheiro vivo dia a dia, igual ao acumulado (`openingCash`).
- Opcional: um lançamento "Depositei / transferi" que tira do dinheiro e põe no Pix, sem mudar o total.

---

## 🟠 3. Saída/perda/ajuste pode "comer" peças reservadas

**Onde:** `src/services/days.ts` → `moveStock()` e `setStock()`

A venda respeita as reservas (`físico − reservado`), mas saída, perda e ajuste olham só o físico.
Exemplo: Lila Rosa tem 5 peças e 3 reservadas para a Ana. Dar "−" quatro vezes deixa 1 física com 3 reservadas,
e o disponível fica **−2**.

**Correção:** antes de reduzir, se `novoSaldo < reservado`, avisar ("3 peças estão reservadas para Ana") e
pedir confirmação. Ou oferecer cancelar a reserva junto.

---

## 🟠 4. App aberto depois da meia-noite continua no dia anterior

**Onde:** `src/state.tsx` → `useState(todayStr())`

A data selecionada é definida uma única vez, quando o app abre. Se o celular deixou o app aberto de um dia
para o outro, a tela continua no dia anterior e não aparece o "▶ Iniciar o dia". Isso convida a vender no
dia errado.

**Correção:** ouvir `visibilitychange`/`focus`. Se a usuária estava em "hoje" e a data mudou, ir para a nova data
(ou mostrar "Já é 01/11 — ir para hoje?").

---

## 🟠 5. iPhone pode apagar os dados se o app não for instalado

No Safari, sites **não instalados** podem ter o IndexedDB apagado após ~7 dias sem visita (política ITP).
Instalado pela tela inicial, isso não acontece. `navigator.storage.persist()` já é pedido, mas o Safari pode ignorar.

**Correção:**
- No iPhone, mostrar um aviso fixo enquanto o app não estiver instalado
  (`!matchMedia('(display-mode: standalone)').matches`): "Toque em Compartilhar › Adicionar à Tela de Início
  para não perder os dados".
- Reforçar o lembrete de backup no iPhone.

---

## 🟠 6. Backup em texto vai ficar grande demais para o WhatsApp

**Onde:** `src/services/backup.ts` → `encodeTextBackup()`

Hoje é JSON em base64, e com **1 dia** de uso já dá 2 partes de 30 mil caracteres. Em alguns meses
serão dezenas de partes, o que fica inviável para copiar e colar.

**Correção:** comprimir com `CompressionStream('gzip')` antes do base64 (o tamanho cai ~8–10×). Marcar no
cabeçalho (`ESTOQUE_BACKUP_V1 … gz`) e continuar lendo o formato atual sem compressão. Funciona em Chrome,
Safari 16.4+ e Node 18+ (testes).
Alternativa complementar: não incluir `auditLogs` no texto (fica só no arquivo JSON).

---

## 🟡 7. Transferir variações não checa nomes repetidos

**Onde:** `src/services/catalog.ts` → `transferVariants()`

`moveVariant()` bloqueia quando o destino já tem uma variação com o mesmo nome, mas `transferVariants()`
(mover todas de um grupo) não. Pode ficar com dois "Branco" no mesmo grupo.

**Correção:** aplicar a mesma checagem e listar os conflitos antes de confirmar.

---

## 🟡 8. Não dá para pagar uma venda metade Pix, metade dinheiro

Cada venda tem uma única forma de pagamento. Pagamento dividido é comum. Hoje a saída é registrar
duas vendas separadas.

**Correção:** na tela "Fechar venda", permitir "Dividir pagamento" (ex.: 100 Pix + 55 Dinheiro). Isso gera
um lançamento de caixa por forma, todos ligados à mesma venda. O verificador passa a conferir a soma.

---

## 🟡 9. Corrigir preço de venda exige cancelar e refazer

Venda feita sem preço (ou com preço errado) só se corrige cancelando e lançando de novo.

**Correção:** "Corrigir valor" na lista de vendas do Caixa. Isso atualiza as peças e lança a diferença no caixa
como ajuste (sem apagar o lançamento original) e registra na auditoria.

---

## 🟡 10. Cancelar venda que veio de reserva não devolve a reserva

**Onde:** `src/services/sales.ts` → `cancelOrder()`

A reserva fica como "convertida" e as peças voltam como livres. Se o cancelamento foi por engano, a cliente
perde a reserva.

**Correção:** ao cancelar, perguntar "Voltar a reservar para Ana?" e, se sim, reativar a reserva.

---

## 🟡 11. Serviço de cadastro aceita lançar em dia encerrado

**Onde:** `src/services/catalog.ts` → `createVariant({ dailyRecordId })`

A tela só passa o dia quando ele está aberto, mas o serviço em si não confere. Chamado de outro lugar, poderia
mexer em um dia encerrado.

**Correção:** usar `assertOpen()` quando `dailyRecordId` for informado (regra no serviço, não só na tela).

---

## 🟡 12. Erro de restauração com mensagem técnica

**Onde:** `src/services/backup.ts` → `validateBackup()` / `restoreBackup()`

A validação não confere unicidade de `[dia + variação]` nem de `settings.key`. O banco recusa (e nada é
alterado, porque está em transação), mas a usuária vê "ConstraintError".

**Correção:** validar esses dois casos antes e mostrar uma mensagem clara.

---

## ⚪ 13. Histórico recalcula todos os dias a cada abertura

**Onde:** `src/screens/History.tsx`

Para cada dia são 3 consultas, e o caixa encadeado percorre todos os dias. Com 1 ano de uso, a tela pode
ficar lenta em celular simples.

**Correção:** carregar só o mês exibido (o calendário já é mensal) e/ou guardar um resumo no fechamento do dia.

## ⚪ 14. `tsconfig.tsbuildinfo` está versionado

É arquivo gerado pelo `tsc -b`. Adicionar `*.tsbuildinfo` ao `.gitignore` e remover do repositório
(`git rm --cached tsconfig.tsbuildinfo`).

## ⚪ 15. Sem testes de tela (ponta a ponta)

Os 24 testes cobrem as regras (serviços), mas não os cliques. Um teste com Playwright do fluxo
"Iniciar o dia → vender 2 peças no Pix → dei dinheiro → encerrar → relatório" pegaria regressões de tela.

---

## Já conferido e OK

- Venda baixa o estoque exatamente uma vez, mesmo com toque repetido (`orderId` do carrinho).
- Cancelar venda devolve as peças e estorna o caixa; nada é apagado.
- Reserva reduz o disponível, não o físico.
- Dias independentes. Se o dia anterior for corrigido depois, aparece o aviso "Atualizar".
- "Ontem" acompanha correções do dia anterior (ou fica manual, com ✎).
- Renomear/mover/arquivar não perde histórico (IDs estáveis).
- Excluir só sem histórico; senão, oferece arquivar.
- Backup JSON/texto valida estrutura, vínculos e checksum, e restaura em transação.
- Venda sem preço não gera receita fictícia; valores em centavos inteiros.

## Ordem sugerida

1. Itens **1** e **3** (pequenos, evitam número errado).
2. Item **2** (conferência por forma de pagamento).
3. Itens **4**, **5** e **6** (proteção dos dados e do uso diário).
4. Demais conforme necessidade.

---

## Rodada de usabilidade (uso real do dia a dia) — ✅ feito

Teste simulando um dia de trabalho no celular (abrir, iniciar o dia, vender várias peças, Pix, sem preço,
menu, histórico, falha do banco). O que mudou:

| Problema encontrado | Correção |
|---|---|
| **Ficar preso em "Carregando"** | Se abrir demorar mais de 8 s, aparece uma tela com **Tentar de novo** e **Atualizar o app** (limpa só os arquivos do app, nunca os dados). Se o código nem carregar, o `index.html` mostra o mesmo socorro depois de 12 s. Erro de tela vira a mesma tela de socorro em vez de página branca. Outra aba com versão nova não trava mais (`versionchange`). |
| Preço digitado a cada venda | O preço já vem preenchido: preço da variação, ou o **último preço vendido no mesmo grupo**. Venda repetida fica sem digitação. |
| Venda “por 0” sem querer | Sem preço, o cursor já vai para o campo de preço e confirmar pergunta “Vender sem preço?”. |
| “Começar em branco” fácil de tocar por engano (zera tudo) | Pede confirmação explicando que o normal é “Iniciar o dia”. |
| Seleção de dia confusa (seta ‹ parecia “voltar”) | **Faixa com os 7 dias** (Dom 25 … Hoje 31): um toque troca o dia; bolinha verde = aberto, roxa = encerrado, sem bolinha = não iniciado. Embaixo: “Ontem, 30 de outubro · ○ não iniciado · ir para hoje”. 📅 para qualquer outra data. |
| App aberto de um dia para o outro | Vai sozinho para o novo dia (item 4). |
| iPhone pode perder dados sem instalar | Aviso “Instale o app para não perder os dados” só no iPhone fora da tela de início (item 5). |
| Navegação com muitos botões | **4 abas embaixo** (Início · **Vender** em destaque · Estoque · Caixa) e **um único ☰ Menu** no topo: Produtos e grupos, Histórico, Backup, Configurações — cada um com uma linha explicando. |
| Botão ⚙️ sem nome em Vender | Agora “⚙️ Grupos”. |

---

## Rodada 2 — tentar quebrar o app — ✅ feito

**Itens 6 a 15 da tabela:** todos corrigidos.
- **Backup em texto (6):** agora vai comprimido, cerca de 3× menor.
- **Cadastro e vendas:**
  - Transferir variações checa nomes repetidos (7).
  - Pagamento dividido (8).
  - Corrigir o valor de uma venda (9).
  - Cancelar uma venda pode devolver a reserva (10).
- **Proteções:**
  - Dia encerrado é recusado também pelo serviço (11).
  - Restauração confere duplicados e mostra mensagem clara (12).
- **Desempenho (13):** o Histórico carrega só o mês exibido.
- **Repositório (14):** `tsbuildinfo` fora do git. Ainda falta rodar `git rm --cached tsconfig.tsbuildinfo`.
- **Teste de tela (15):** `src/__tests__/tela.test.tsx` usa o app de ponta a ponta.

### Ataques testados (`src/__tests__/quebrar.test.ts`)
- **Valores absurdos:** preço negativo, fracionado ou gigante; "1e5", "+70", "0x10"; quantidade 0, negativa, fracionada ou 1 bilhão.
- **Dados inválidos:** datas impossíveis (30/02, 13º mês); nomes vazios, gigantes ou repetidos com acento diferente.
- **Dia encerrado ou inexistente:** vender, lançar no caixa, reservar ou cadastrar com quantidade.
- **Toques repetidos e corridas:**
  - Toque triplo em Confirmar.
  - Duas vendas ao mesmo tempo da última peça.
  - Cancelar ou desfazer duas vezes.
  - Converter a mesma reserva duas vezes.
  - Venda forjada dizendo que vem de reserva de outra peça.
- **Pagamento e correções:** dividido que não soma o total; correção de valor para mais e para menos (inclusive em venda dividida, sem deixar nenhuma forma negativa).
- **Cadastro bagunçado:** reativar com nome que já existe; transferir para grupo com nomes iguais.
- **Dias fora de ordem:** registrar um dia antes do primeiro; registrar um dia no meio de dois existentes.
- **Restauração com lixo:** 13 arquivos inválidos diferentes, e nada muda no celular.
- **Backup em texto:** colado fora de ordem, com quebras de linha do WhatsApp e mensagens no meio; partes de dois backups misturadas.
- **Texto malicioso:** CSV com fórmula do Excel (`=HYPERLINK`); nomes com `<b>`.

**Bugs reais encontrados e corrigidos:**
- Saída maior que o estoque mostrava “0 peças estão reservadas” → agora diz que o estoque não pode ficar negativo.
- Botão voltar do celular não fechava o ⓘ nem a pergunta de confirmação.
- Dia lançado antes do primeiro dia começava zerado.
- Preço negativo e valores gigantes eram aceitos.
- Data inválida criava dia.
- CSV podia virar fórmula no Excel.

### 10 dias seguidos (`src/__tests__/dez-dias.test.ts`)
Simula 10 dias com 6 a 15 vendas por dia, mais:
- toques duplos, pagamento dividido, correção de preço e cancelamentos;
- entradas, perdas e ajustes;
- reservas convertidas em dias seguintes;
- "Dei dinheiro", despesas e retiradas;
- peça nova no dia 5 e arquivada com estoque no dia 7;
- **correção do dia anterior no dia 6**;
- **passagem para outro celular no dia 10**, continuando o dia 11 lá.

Um modelo independente confere todo dia: estoque peça por peça, reservas, saldo, dinheiro na mão, vendas por forma, linhas do caderno e diagnóstico. **Tudo bateu.**

### Usabilidade e visual (pedidos durante a rodada)
- **Navegação e Início:**
  - Barra de baixo: só a aba atual fica azul; “Início” sempre volta para hoje.
  - Seleção de dia: aviso amarelo forte com **Voltar para hoje**; o dia novo mostra dois cartões (**Continuar** recomendado × **Do zero**) com ⓘ.
  - Números do Início com nomes claros e ⓘ (o ⓘ do “Para repor” explica o estoque ideal).
- **Vender e reservar:**
  - Repor = estoque ideal (a quantidade cadastrada) − o que tem. Ex.: cadastrou 15, vendeu 1 → repor 1.
  - Vender: passo a passo no topo, “à venda” no lugar de “disp.”, botão **+ Vender**, − e + na linha, total na barra do carrinho.
  - Reservar: “Guardar para uma cliente”, mostra quanto fica à venda, ⓘ com exemplo.
- **Caixa:**
  - Saldo com **Na mão** × **No banco**.
  - Conta do dia em **Normal** ou **Caderno**.
  - Linha do tempo única, com **Corrigir valor** e **Cancelar venda**.
- **Movimentos do dia:** frases (“Vendeu 2”, “Entrou 5”), resumo e filtros; aviso de que tudo já está salvo; ⓘ de como corrigir erros.
- **Relatório:** **Editar mensagem** antes de enviar (desligado por padrão) com ⓘ.
- **Salvamento e transferência:**
  - **✓ Salvo 15:05** no topo, com o horário do último registro gravado no banco.
  - **Passar para outro celular** (Menu): Enviar tudo → Receber (escolher arquivo) → confirmar.
- **Voltar atrás:** “Desfazer o início do dia” enquanto não houver lançamentos; cópia automática antes de receber ou restaurar, com **Voltar como estava** (e refazer).
- **Desempenho:**
  - Telas pouco usadas carregam sob demanda.
  - Sem desfoque de fundo (pesado em Android simples).
  - Uma consulta só para os cartões de grupo.
  - Toque sem atraso.
- **ⓘ:** todos com o mesmo padrão (cartão por cima da tela e “💡 Por exemplo”), sem herdar maiúsculas do título.

### Toque, responsivo e acabamento (pedidos finais) — ✅ feito
- **Fim do toque errado:**
  - Os cartões de números do Início abrem a explicação ao tocar em qualquer parte; “Ver no Estoque ›” fica dentro dela.
  - Todos os “i” têm área de toque de 44px.
- **Alvos de toque de 44px** (padrão Apple/Google): − e + do carrinho, Reservar, + Vender, Desfazer, Corrigir valor, Cancelar venda, ✕ do caixa, ↑↓ do cadastro, filtros e seletores.
- **iPhone e Android:**
  - Campos com 16px de letra, então o iPhone não dá zoom sozinho ao digitar.
  - O texto não cresce ao girar a tela.
  - Na tela pequena (iPhone SE, 320px) a faixa de dias mostra 5 dias; nada vaza para o lado.
- **ⓘ:** todos os exemplos viraram lista curta com emoji, uma ideia por linha (“💡 Por exemplo”).
- **Estoque:** a legenda cinza ilegível virou o cartão “Como usar esta tela” (+ Entrou · − Saiu · número = ajustar) com ⓘ.
- **Topo:** ícone do app, nome da tela e “✓ Tudo salvo · 15:05” (a linha toda abre a explicação); Menu em botão maior.
- **Desfazer:**
  - Movimentos do dia: aviso de desfazer em destaque, com ⓘ.
  - Início do dia: enquanto nada for lançado, aparece “Desfazer”.
  - Dados recebidos de outro celular: o app guarda uma cópia antes, com “Voltar como estava” (e refazer).

---

## Rodada 3 — diagnóstico, teste extremo e revisão de UI/UX — ✅ feito

### Testes novos
- **`extremo.test.ts`:**
  - **20.000 ações aleatórias** (5 sorteios × 4.000), misturando ações válidas e inválidas: venda, venda dividida, cancelar, corrigir valor, +/−/perda/definir, desfazer, reservar/cancelar/converter, caixa, contado, “Ontem” à mão, encerrar/reabrir, virar o dia, datas lixo, cadastro (criar, renomear, arquivar, excluir, mover, transferir).
  - A cada 200 ações confere: diagnóstico sem erro, estoque nunca negativo, caixa encadeado certo, nenhuma data repetida.
  - No fim de cada sorteio: relatórios, planilhas, backup em texto e restauração.
- **Tempestade:** 60 operações simultâneas no mesmo dia.
- **Escala:** 180 dias × 15 vendas.
- **Relógio do celular errado:** dias “no futuro”.
- **Voltar atrás em sequência:** receber, desfazer e refazer várias vezes.
- **`abas.test.tsx`:** teste de tela por aba (Início, Vender, Estoque, Caixa, Menu e janelas, Histórico), tentando errar de propósito em cada uma.

### Bugs e gaps encontrados e corrigidos
- **Peça cadastrada com quantidade inválida (NaN):** contaminava os dias seguintes. Agora quantidade inicial, estoque ideal e preço são validados no serviço.
- **Lentidão com meses de uso:** o resumo do dia levava ~1,9 s com 6 meses; agora leva ~12 ms (a conta do caixa lê cada tabela uma vez só).
- **Backup em texto com muitos meses:** partes de 60 mil caracteres (cabe no WhatsApp) e aviso para preferir o arquivo.
- **Compatibilidade com celulares mais antigos:**
  - Ler o arquivo recebido agora funciona mesmo sem `File.text()`.
  - O backup em texto cai para o formato sem compressão se faltar `Blob.stream`.
  - Erros aparecem como mensagem, não em silêncio.
- **Lógica que não fazia mais sentido:**
  - “Estoque baixo (padrão)” removido (o repor usa o estoque ideal).
  - Cancelar reserva agora aparece nos Movimentos do dia.
  - Encerrar o dia limpa o carrinho.
  - A troca de aba é instantânea, para nunca parecer que duas estão selecionadas.

### UI/UX
- **Vender:**
  - Os passo a passos viraram dois botões compactos (“Como vender” · “Como reservar”) com os passos e exemplos dentro.
  - “Para vender | Todos” virou filtro; busca e filtros ficam fixos ao rolar.
  - A lista começa bem mais alto.
- **Estoque:**
  - Resumo no topo (total, repor e esgotados, que filtram ao tocar), Movimentos do dia e “Como usar” com ⓘ.
  - Grupos com cor, selos e “peças”; linhas com selos e número com cara de botão (toque para ajustar).
- **Caixa:** as vendas por forma viraram barra de proporção; “Lançar dinheiro” ganhou ⓘ com exemplo de cada botão.
- **Início:**
  - Cartão de vendas com média por venda, barra de proporção e porcentagens; saldo do caixa num botão claro.
  - Grupos com barra de estoque ideal e selos (“9 cores”, “repor 3”, “✓ completo”).
- **Abas de trabalho:** o cartão “Hoje” só aparece quando há algo a avisar (outro dia, encerrado, não iniciado).
- **“Hoje, 31 de outubro”** virou uma faixa com a data por extenso, o selo colorido da situação e a legenda visual das bolinhas.
- **Menu:**
  - Separado em seções (Dia a dia · Seus dados · App), com ícones coloridos.
  - Ganhou **Sobre** (“Feito com amor, pelo seu amor 🥰”).
- **Configurações:**
  - Salvam sozinhas; seções em cartões com ⓘ e exemplo.
  - Pagamentos com “⭐ padrão” na mesma linha; prévia da moeda; lembrete de backup em botões (3/7/15/30 dias).
- **Relatório do WhatsApp:** seções em lista (Vendas · Outros lançamentos · Caixa · O que saiu · Entrou · Precisa repor · Esgotados · Estoque do fim do dia).

---

## Rodada final — validação para sinal verde (MVP) — ✅

### Lista oficial aplicada
- Estoque igual à lista oficial (8 grupos, 51 cores, 238 peças; Rojo → Vermelho, Blanco → Branco).
- **À venda:** Azul, Plomo, Lila (e Broche Rey, que já nasce à venda quando for cadastrado).
- **Guardados no estoque (fora da venda):** Broche, Camisa, Broche Médio, Naranja, Dorado.
- Peça “guardada”:
  - fica no estoque e no relatório, mas não aparece em Vender e não pode ser vendida nem reservada;
  - liga e desliga no Estoque (peça ou grupo inteiro);
  - colocar um grupo em “Para vender” já o põe à venda.
- Aparelhos que já tinham dados recebem esse padrão uma única vez, sem desfazer o que a pessoa mudou.

### Teste final supremo (bancos temporários, sem tocar nos dados reais)
- **Macaco nos serviços:** 40.000 ações aleatórias (5 × 8.000), sem erro técnico e sem dado inconsistente.
- **Macaco na tela:** 4.000 toques aleatórios no app inteiro (4 × 1.000), sem cair na tela de erro e com os dados íntegros.
- **85 testes automáticos:**
  - regras, ataques e 10 dias seguidos;
  - escala de 6 meses (resumo do dia em ~14 ms);
  - teste por aba;
  - lista oficial.
- **Verificação de tipos e build de produção:** ok.
- **Responsividade:** nenhum vazamento nos 7 tamanhos (280, 320, 360, 375, 390, 412 e 430 px), em todas as abas e janelas.

### Bug importante encontrado e corrigido nesta rodada
- Depois de uma atualização do app, abrir uma tela carregada sob demanda (ex.: Encerrar o dia) derrubava o app com a mensagem errada “Não foi possível abrir os dados”.
- Agora o app recarrega sozinho na versão nova; se ainda falhar, avisa “O app foi atualizado” com o botão Atualizar.

### Últimos ajustes visuais
- **Início:** filtro dos grupos (Todos · À venda · Guardados) com contagem e selo em cada cartão.
- **Estoque e Vender:** “começou → agora” num componente único (com ▼/▲, repor, esgotado e reservadas); a legenda do Estoque ficou mais visível.
- **Movimentos do dia:** toques repetidos agrupados (“Saiu 4 · 4 toques”), Desfazer compacto, números do topo como filtro e busca por peça.
- **Caixa:**
  - títulos padronizados (Lançar dinheiro · Conta do dia · Movimentado hoje);
  - formas de pagamento em blocos com porcentagem;
  - selos “Veio de ontem + Hoje”;
  - venda mostrando grupo › cor de cada peça.
- **Relatório do WhatsApp:** agrupado por grupo, com as cores embaixo (“🎀 *Plomo* · • Cor Vermelho: 2”); botão “📋 Copiar texto” com confirmação.
- **Cadastro:** posição de cada grupo na fila (1º, 2º…) com ⓘ; nova tela de “Nova cor” em 3 passos (grupo, nome e cor, quantidade).
- **Histórico:**
  - resumo do mês (vendido, peças, dias com venda, média e melhor dia);
  - cartões de dia com barra por forma de pagamento.

### O que faltava para ir para o celular (fora do código) — ✅ feito
1. `git rm --cached tsconfig.tsbuildinfo` e fazer o commit/push.
2. No GitHub: Settings › Pages › Source: **GitHub Actions** (o workflow publica sozinho).
3. Abrir o link no celular, **Adicionar à tela de início**, e fazer um teste rápido real (vender, encerrar, mandar no WhatsApp e testar sem internet).

---

## Rodada 4 — uso real no celular (01 e 02/11/2026) — ✅

O app passou a ser usado de verdade (iPhone e Samsung, dois celulares). Cada pedido e cada problema encontrado no uso virou
correção com teste. Tudo também aparece para a usuária em **Menu › Atualizações**.

### Pix, caixa e diária
- **Pix na tela**: QR code na venda (com o valor) e botão “⚡ Mostrar Pix” sem venda; QR regenerado limpo a partir do código
  conferido pelo CRC (PNG em base64 dentro do app).
- **iPhone × Android**: o app diz onde conferir (Neon no Samsung). Ler notificação do banco é impossível em app de navegador,
  então a conferência é um toque: **“✅ Caiu”**. Pix conferido e depois corrigido → **“⚠️ Pix mudou”** (guarda o valor conferido).
- **Caixa em forma de conta**: ontem separado (💵 dinheiro · 🏦 banco), hoje linha por linha (uma por forma de venda e por
  saída), = Hoje, ✅ Total; “na mão” e “no banco” em linhas separadas.
- **Diária de 150 automática** só no dia de hoje (dia antigo esquecido aberto não recebe; tirou no ✕, não volta).
- **Dinheiro contado** muda a mensagem na hora (faltam / sobram / bateu).

### Dois celulares e segurança dos dados
- **Juntar com outro celular**: código em texto (base64) que **soma** os dois; produtos casam por nome, dias por data,
  apagados não voltam (`tombstones`), importar de novo não muda nada. Teste maluco com rodadas aleatórias.
- **Dados protegidos**: o app pede ao navegador para nunca apagar (`storage.persist`) e mostra o status; teste de gravação.
  Conferido no Samsung.
- **Testes presos à data → relógio fixo**: a suíte roda como se fosse 01/11/2026 (e em qualquer data com `HOJE=`).

### Atualizações
- O app procura versão nova sozinho (de hora em hora e ao voltar para a tela, no máximo a cada 10 min, ~1 KB).
- **Menu › Atualizações** (o que mudou, selo “Novo”) e selo no cabeçalho “✓ Atualizado / 🆕 Atualizar”.
- 🐛 **“Atualizar” sem efeito no computador**: o recarregar do plugin dependia de um evento que não chega quando a página
  não está sob o service worker (Ctrl+Shift+R) ou quando outra aba ativou a versão. Agora `applyUpdate` **recarrega sempre**
  (testado no navegador no caso exato que travava).

### Bugs do uso real
| Bug | Causa | Correção |
|---|---|---|
| Teclado abrindo sozinho no “Fechar venda” | foco automático | removido |
| “2” no carrinho depois de zerar tudo | o reset não recarregava | recarrega + carrinho se limpa sozinho |
| “Invalid argument to Table.get()” | cor salva sem grupo | exige grupo; cria o grupo ali mesmo; erros em português |
| Cor arquivada sem como excluir | faltava o botão | “🗑️ Excluir” na lista de arquivadas (vendas antigas ficam no histórico) |
| Meta 15 → 18 virava “repor” e travava o uso | meta e estoque misturados | “📦 No estoque hoje” (ajuste) separado da “🎯 Meta” |
| “Entrou no estoque: 664” | quantidade do cadastro lançada como entrada | cadastro = estoque inicial; dados antigos convertidos sozinhos (112 lançamentos nos dados reais) |
| Cores arquivadas na mensagem (grave) | relatório sem filtro | arquivadas/excluídas fora de Entrou, Repor, Estoque e totais (46 cores nos dados reais) |
| “Cor Azul: 2 🚫 esgotado” | esgotado olhava o livre (2 reservadas para Kelly) | esgotado = 0 peças; “🔒 2 reservadas” |
| Início com 9 esgotados, mensagem com 1 (grave) | duas regras diferentes | uma regra só; “Esgotados (N)” = número do Início (7 nos dados reais); teste compara |
| WhatsApp abria uma página e não chegava na conversa (iPhone) | link `wa.me` com o texto (emoji quebrado) | **Enviar = copiar + abrir o WhatsApp**, a pessoa cola |
| Testes de tela falhando às vezes | `await import()` dentro de transação do banco | import normal no topo |

### Mensagem do WhatsApp
- **Estoque agora**, cor por cor, com “⚠️ repor N” / “🚫 esgotado” / “🔒 N reservadas” ao lado (chave).
- **Começou → terminou** em cada cor (chave), **Totais** no final (estoque, repor, começo → final) (chave),
  **divisão** entre os grupos `- - - - - - - -` (chave), **repor com “tem X de Y”** (chave, desligada).
- **Repor configurado em cada produto**: “🔁 Precisa repor?” e “📏 Tem estoque mínimo?”; “Precisa repor” só com o número.
- **Tamanho da mensagem**: “atual / máximo” na tela. Primeiro contra o limite do link (7.000); com copiar + abrir, o limite é o
  de uma mensagem do WhatsApp (65.536 letras). Dados reais com tudo ligado: ~5.700 → **uma mensagem só**.
- **Mandar em partes** (chave, segurança para mensagens gigantes): parte 1 copiada, “💬 Mandar parte 2” ao voltar; nunca corta
  linha, título repetido com “↪️ (continua)”, teste garante todas as linhas na ordem.
- **Recado em cima do botão**: “Ao clicar em Enviar no WhatsApp vai copiar e abrir o WhatsApp.”

### Dia
- **Virou a data: o dia de ontem encerra sozinho** (ao abrir e à meia-noite com o app aberto); reaberto de propósito não fecha.
- **“Bom dia”** mostra o **último backup (data e hora)** e pergunta se quer fazer outro agora.
- Dias do caderno separados (30/10 e 31/10).

### Conferências com os dados reais do celular (02/11, sem tocar no celular)
- Arquivo do celular restaurado só em banco de teste (`DADOS_REAIS=arquivo.json npm test`; o arquivo não vai para o repositório).
- **A conta do estoque fecha cor por cor**: começou 426 − saiu 41 = terminou 385; o que a mensagem diz que saiu = o que saiu do
  estoque (venda cancelada devolve a peça e não conta).
- Excluir as 46 arquivadas não muda estoque nem dinheiro; diagnóstico sem erro.
- Exemplo pedido: **começou 15, vendeu 3** → “O que saiu: 3”, “começou 15 → terminou 12 ⚠️ repor 3”, totais −3, dia seguinte
  começa com 12 (teste `conta-estoque.test.ts`).
- Sem vazamento de memória (tela estável ~300 elementos, 8–19 MB); internet: ~1 KB por conferência de versão.

### Diagnóstico lendo o SISTEMA.md (02/11) — gaps tratados
| # | Gap | Decisão | O que ficou |
|---|---|---|---|
| 1 | “Enviar no WhatsApp” não testado no celular | já testado pela usuária: funciona | — |
| 2 | Venda no meio à meia-noite | preparar | o dia espera a venda terminar; ela fica no dia em que começou; faixa “🌙 Já é…” |
| 3 | Totais × vendas do caderno (30 e 31/10) | ok: era só histórico (recomeçou do zero no celular dela) | — |
| 4 | Dois celulares: situação do dia e chaves não juntavam | preparar | vale a ação mais recente; chaves seguem o celular que mudou por último |
| 5 | Mínimo maior que a meta aceito | corrigir | recusado no cadastro; dado antigo conta como a meta |
| 6 | “Outros apps” com o link antigo | corrigir | sem compartilhar: copia o texto |
| 7 | “Último backup” mais antigo que o real | corrigir | gerar o código do Juntar conta como backup |
| 8 | Partes só na memória | corrigir | guardadas no aparelho por até 12 h |
| 9 | Dia reaberto esquecido aberto | corrigir | aviso no Início com Ver / Encerrar |

### Testes
- **177 testes** (175 + 2 com dados reais), também rodando em outra data (`HOJE=2027-03-01`). Lista completa em `SISTEMA.md`,
  seção 10.

---

## Rodada 5 — estoque × vendas, histórico, importação e cadastro (03/11/2026) — ✅

Pedido: evoluir o app a partir do uso real (prints e 3 arquivos “Passar para outro celular” de 03/11, às 02:18, 03:11 e 03:28),
sem reconstruir nada, sem inventar movimentação e sem mexer em dia fechado.

### Fase 1 — investigação com os dados reais (antes de corrigir)
Conferência completa dos 3 arquivos (estoque de cada dia, movimentos, vendas, reservas, dia encerrado):
- **Os dados estavam íntegros**: em todas as cores, começou + movimentos = agora; começou de hoje = terminou de ontem;
  toda venda tem exatamente uma saída; nada duplicado; o dia 02/11 (encerrado) não foi mexido depois de fechar.

| O que a usuária viu | Causa real | Correção |
|---|---|---|
| “Azul Celeste: 7 no início, saiu 4, final 3 ou 4” | É **Plomo Celeste**: cadastrada com **3**; o **estoque ideal** foi posto em **7** (02:01 e 02:03) → a tela mostrou “repor 4”, lido como “saíram 4”; depois foi **arquivada e recriada** com 7. Nenhum movimento faltando | Estoque ideal separado e explicado (“não é estoque”), prévia antes de mudar, o histórico mostra a alteração cadastral |
| Renda blanco/negro “começou 1, agora 2 ▲+1” | Mesmo padrão: quantidade posta no campo da meta, depois arquivar e recriar | Cadastro novo com “Quantidade real” e “Estoque ideal” separados |
| Terracota “Início do dia 0” | 🐛 o cadastro usava o dia **selecionado na tela**; olhando outro dia (encerrado), a quantidade sumia sem aviso | Cadastro sempre no dia de **hoje**; sem o dia de hoje iniciado, avisa |
| Movimentos do dia “+113 Ajustes” | Mercadoria que chegou (25 cores, 02:47–03:04) foi lançada pelo “Definir” / “No estoque hoje” → registrada como **ajuste**, não entrada | Subir a quantidade pergunta: mercadoria nova, reposição ou correção da contagem |
| Vino e Azul “sem peça” | Estoque 1 com 1 reservada; a tela não dizia “reservada” | “🔒 reservadas”; o Estoque mostra físico / reservado / disponível |
| 20 cores somem entre o 2º e o 3º arquivo | 🐛 “Excluir” de cor nunca vendida **apagava os movimentos** (16) | Excluir nunca apaga: some das telas, o histórico fica |
| Plomo Rojo −2 | Venda real de 2 às 02:28 | — (correto) |

### Fase 2 — integridade
- Cadastro com quantidade entra no dia de **hoje** (`createVariant({ intoToday })`); sem o dia de hoje: aviso.
- Entrada com tipo: **mercadoria nova** ou **reposição** (`StockMovement.entryKind`); padrão em Configurações › Entrada de estoque.
- “Definir” / “No estoque hoje” para mais pergunta o motivo; “chegou mercadoria” vira **entrada**, “correção” continua **ajuste**.
- **Quem fez**: Configurações › Seu nome → `by` em movimentos, vendas, reservas, cadastro, auditoria e importação.
  Origem no histórico: 🙋 usuária (à mão), 🤖 sistema (efeito de venda ou reserva), 🕰️ registro antigo (sem a informação).
- **Excluir** é sempre “esconder” (`deletedAt`): movimentos, vendas e estoque de cada dia continuam.
- **Dia fechado**: todos os serviços de escrita já recusavam (`assertOpen`). Desfazer um movimento de um dia encerrado agora
  cria a correção **no dia de hoje**, ligada ao original (o dia encerrado não muda).
- O teclado não abre mais sozinho na folha de entrada/saída do Estoque (print 4).

### Fase 3 — Histórico de movimentações (Menu e Configurações)
- `services/history.ts` monta a vida de cada peça só com o que já está gravado (estoque de cada dia, movimentos, auditoria).
- Linha do tempo por dia: começou → registros → terminou; **divergência não explicada** quando a conta não fecha ou o dia
  começou diferente do que o anterior terminou (mostrada, nunca “corrigida”).
- Filtros: período (hoje por padrão, 7 e 30 dias, tudo, datas), grupo, produto, tipo, pessoa, origem.
- Cada registro abre os detalhes: data/hora, antes → movimentou → depois, origem, quem, referência (venda, importação,
  registro desfeito), motivo; **desfazer** com prévia antes → depois e confirmação (venda se cancela pela própria venda).
- Atalhos: “📜 Histórico desta peça” no Estoque e no cadastro; o nome da peça no Vender abre o histórico dela.

### Fase 4 — Importar mercadoria (Menu e Estoque)
- Formatos: grupo numa linha + “Produto: quantidade”; com tamanho (“Verde · P: 2”, “Verde (P): 2”); numa linha
  (“Lila > Rosa > 4”, com “;”, “|” ou tab); aceita o próprio relatório do WhatsApp (“• Cor Azul: 2 …”).
- **Prévia obrigatória**: existentes, novos, grupos novos, “parecidos” (precisa escolher: é o existente ou é novo — nunca
  duplica), erros por linha, antes / entrada / depois e o texto colado. Nada é gravado antes de confirmar.
- Operação: **somar** (entrada nova ou reposição) ou **definir** (contagem); produto novo à venda ou só no estoque.
- Aplicar é uma transação só (tudo ou nada); fica um registro em **`imports`** com o texto original, quem, quando, cada
  linha (antes, mudou, depois, criado) e as movimentações geradas (`importId`).
- **Desfazer**: prévia linha a linha; cada linha ganha um movimento inverso ligado ao original. Se depois da importação
  houve venda ou saída que impede (ou reservas), a linha fica como está e o motivo é guardado (“desfeita em parte”).
- “Copiar o modelo”: o catálogo atual pronto, só faltando as quantidades.

### Fase 5 — cadastro e experiência
- Novo formulário: grupo · nome e cor · **tipo** (opcional) · **tamanhos** (opcional, cada um com a sua quantidade) ·
  **quantidade real** · **à venda** ou só estoque · **usar estoque ideal?** com a meta separada (“não é estoque”).
- Tamanho é um campo da cor (`Variant.size`): cada tamanho é uma linha própria → estoque, vendas, reservas, importação,
  filtros e histórico funcionam sem mudar a estrutura. Mesmo nome com tamanho diferente pode; mesmo nome e tamanho, não.
- Tipos de produto, tamanhos, cores e ícones editáveis em Configurações; cores em **neutras, quentes, frias** + “Minhas cores”.
- Estoque ideal: “🎯 Usar estoque ideal (repor)?” por peça; editar a meta mostra a prévia (o real continua N, repor vira X).
- Filtros “🎯 Com ideal / Sem ideal” no Estoque e no Vender; filtro de tamanho no Vender; “🔒 Reservadas” no Estoque.
- **Novo produto pela aba Vender** (origem “vender”): entra no cadastro, no estoque de hoje e à venda.
- Tudo que abre com um toque mostra “ver mais” / “detalhes” (`ExpandHint`); histórico da peça do mais novo para o mais antigo;
  versão do app (Sobre) vem da entrada mais nova das Atualizações (1.6).
- **＋ Chegou mais** em cada peça do Vender: entrada no estoque (nova/reposição) com prévia; é a mesma função do Estoque
  (`moveStock`), então não existe um segundo controle de quantidade (teste: esgotada → +3 → vende de novo).
- Reservas ativas: recolher (lembra no aparelho) e filtrar por grupo e por peça, cor, tamanho ou cliente.

### Armazenamento e migração (não destrutiva)
- Banco **versão 3**: só acrescenta a tabela `imports` (nada existente muda).
- Campos novos, todos opcionais: `StockMovement.entryKind / by / importId`, `Variant.origin / createdBy / size / productType`,
  `Order.by`, `Reservation.by`, `AuditLog.by`. Registro antigo sem eles aparece como “registro antigo” — nada é inventado.
- Backup: `imports` é **opcional** (backup antigo abre; app antigo ignora a tabela nova). A conferência (checksum) não altera o
  backup recebido e aceita conferir duas vezes (as telas Backup e Passar conferem e depois restauram).
- Juntar celulares leva as importações pelo id (não duplica).

### Testes (todos passando)
- **202 testes** (198 + 4 com dados reais), também em outra data (`HOJE=2027-03-01`) e com o backup antigo de 02/11.
- `cenarios.test.tsx` (21): os 9 cenários pedidos — divergência (explicada; inventada nunca; entre dias), venda 10→8 com
  referência, reposição 8→13, ajuste 10→7 que não é venda, “Definir” que vira entrada, reserva 5/2/3 e cancelamento,
  “reservadas” no Vender, importação (formatos, prévia, confirmar, vender depois, desfazer respeitando a venda,
  “parecido” sem duplicar), produto criado no Vender pela tela, dia fechado intacto com desfazer no dia de hoje,
  reversões; os bugs de cadastro e de excluir; compatibilidade de backup; **dados reais**: 0 divergências e a “Celeste 7”
  explicada pela linha do tempo.

### Pendências e pontos de atenção
- **Não testado no celular**: as telas novas (Histórico, Importar, novo cadastro) foram conferidas no navegador do computador.
- Desfazer importação “em parte” não tira só um pedaço de uma linha: a linha inteira fica como está, com o motivo.
- Tipo de produto ainda não tem filtro próprio nas telas.
- Os 16 movimentos apagados pelo “Excluir” antigo (entre 03:11 e 03:28 de 03/11) não podem ser recuperados.
- Juntar celulares com versões diferentes do app: o celular sem esta versão ignora as importações do outro.
