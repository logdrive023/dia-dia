# Auditoria do estoque e das vendas — Dia a Dia

> Data: 04/11/2026 · Base: código em `main` (com as correções 1.7 ainda não publicadas), `SISTEMA.md`, `MELHORIAS.md`,
> e o backup real `dia-dia_passar-para-outro-celular_2026-11-04.json` (3 dias, 96 cores, 453 movimentos, 42 vendas, 22 reservas).
> Nenhum código foi alterado nesta etapa.
>
> Legenda de status: ✅ implementado e confirmado · 🟡 parcial · ❌ não existe · ❓ não deu para confirmar · 🧭 precisa de decisão de negócio

---

## 1. Visão geral do gerenciamento de estoque

O app é um **caderno por dia**, offline, num celular só (com “Juntar celulares” para somar dois aparelhos depois).

| Peça do modelo | Tabela | O que guarda |
|---|---|---|
| Produto | `groups` (ex.: “Plomo”) + `variants` (a cor/tamanho: “Plomo › Negro”) | cadastro, `startQuantity`, meta (`idealStock`), mínimo, à venda (`forSale`), arquivada/excluída |
| Estoque do dia | `dailyStockItems` (1 por dia × cor) | `initialQuantity` (começou) e `currentQuantity` (agora) |
| Movimento | `stockMovements` | tipo (venda, entrada, saída, perda, ajuste, correção, cancelamento, reserva), quantidade, saldo antes/depois, quem |
| Venda | `orders` (a cliente) + `sales` (cada peça) | preço, forma de pagamento, status `ok`/`cancelled` |
| Dinheiro | `cashRecords` (1 por dia) + `cashMovements` | venda, estorno, correção, despesa, diária, retirada… |
| Reserva | `reservations` | peça separada: reduz o **disponível**, não o físico |
| Rastro | `auditLogs` | alterações de cadastro, dia, venda |

**Fórmulas centrais (no código):**

- `agora = começou + soma dos movimentos do dia` — conferido por `runDiagnostics` (`services/diagnostics.ts`).
- `disponível = agora − reservas ativas com data ≤ dia` (`activeReservedByVariant`, `services/sales.ts`).
- `começou (dia N) = agora (último dia antes de N)` **no momento em que o dia N é iniciado** (`startDay`, `services/days.ts`).

O ponto mais importante para entender os erros: **o estoque não é calculado, ele é copiado de um dia para o outro**. Cada dia
tem a sua foto. Tudo o que muda “a foto de ontem” depois que hoje começou precisa ser levado à mão (“Atualizar”).

---

## 2. Conceitos fundamentais que precisamos dominar

| Conceito | Definição no nosso domínio | Exemplo real |
|---|---|---|
| **Físico** | peças que existem na loja (`currentQuantity`) | Naranja › Poa: 13 |
| **Reservado** | peças físicas prometidas | Naranja › Poa: 13 reservadas (“Se lo llevaron a casa”) |
| **Disponível** | físico − reservado (o que Vender deixa vender) | Naranja › Poa: 0 |
| **À venda × guardada** | aparece ou não em Vender; continua no estoque | 5 cores guardadas nos dados |
| **Ativa × arquivada × excluída** | arquivada sai das listas; excluída sai de tudo (histórico fica) | 25 exclusões “soft”, 22 “hard” (versão antiga) |
| **Começou do dia** | foto do físico no início do dia | 03/11: 385 |
| **Movimento** | toda mudança no físico, com antes → depois | 453 no backup |
| **Entrada × ajuste** | entrada = chegou mercadoria; ajuste = corrigir contagem | 03/11: +117 lançados como ajuste |
| **Saída × perda × venda** | saída sem dinheiro; perda (estragou); venda (com dinheiro) | 04/11: 13 saídas em cores ativas |
| **Correção (desfazer)** | movimento inverso ligado ao original | 8 desfazimentos |
| **Meta / repor** | `idealStock` (vazio = quantidade do cadastro); repor = meta − agora | “repor” desligado 71 vezes nos dados |
| **Identidade da peça** | o `id` da cor; entre celulares, o **nome** dentro do grupo | “Poa” × “Poa” = mesma peça? |

**O que o domínio exige e nós tratamos como detalhe:** a *identidade* da peça (uma cor = um registro) e a *continuidade* do
estoque (o fim de um dia é o começo do outro). Quase todos os problemas reais vieram de quebrar uma das duas.

---

## 3. Regras de negócio identificadas (verificadas no código)

### 3.1 Estoque
| # | Regra | Onde | Status |
|---|---|---|---|
| E1 | Todo movimento grava saldo antes/depois e quem fez | `applyStockDelta` | ✅ (o “quem” nunca foi preenchido nos dados reais: 0 de 453) |
| E2 | Estoque não fica negativo numa operação local | `applyStockDelta` recusa | ✅ |
| E3 | Juntar celulares pode deixar negativo e avisa | `mergeBackup` (`oversold`) + diagnóstico | ✅ por decisão |
| E4 | Desfazer não apaga, cria movimento inverso; de dia encerrado entra **hoje** | `undoMovement` | ✅ |
| E5 | Iniciar o dia copia o fim do dia anterior; cor nunca vista usa a quantidade do cadastro | `startDay` | ✅ |
| E6 | Cor arquivada com peças passa para o dia seguinte; excluída não | `startDay` | ✅ (1.7) |
| E7 | Cadastro com quantidade vira o **começou** de hoje (sem movimento) | `createVariant` | 🟡 funciona, mas quebra a continuidade (ver P2) |
| E8 | “Definir” para mais pergunta: chegou mercadoria (entrada) ou correção (ajuste) | `setStock` + `EntryReasonPicker` | ✅ desde 1.6 |
| E9 | Saída/ajuste abaixo do reservado pergunta antes | `checkReserved` | ✅ |
| E10 | “Atualizar” traz correção do dia anterior para o começou de hoje | `resyncFromPrevious` | 🟡 corrigido em 1.7 para cor nova; só olha **um** dia para trás |
| E11 | Cor antiga (arquivada/excluída) não soma no total, não vende, “Resolver” passa ou zera | `Stock.tsx`, `settleRetiredStock` | ✅ (1.7) |

### 3.2 Vendas
| # | Regra | Onde | Status |
|---|---|---|---|
| V1 | Venda baixa o estoque **no Confirmar**, na mesma transação que grava venda e caixa | `createOrder` | ✅ |
| V2 | Toque duplo não duplica (id gerado ao abrir o carrinho) | `createOrder` (`dup`) | ✅ |
| V3 | Só vende até o disponível (físico − reservado) | `createOrder` | ✅ |
| V4 | Guardada não vende (exceto convertendo reserva) | `createOrder` | ✅ |
| V5 | Cor **arquivada/excluída** não vende | só a tela filtra; o serviço **não** confere | 🟡 |
| V6 | Venda sem preço: sai do estoque, não entra no caixa (pergunta antes) | `Sell.tsx` + `createOrder` | ✅ por decisão |
| V7 | Preço sugerido = preço da cor, senão **último preço do grupo** | `useLastPriceByGroup` | 🟡 desconto vira padrão (ver P12) |
| V8 | Cancelar: devolve todas as peças, estorna por forma, reserva pode voltar | `cancelOrder` | ✅ |
| V9 | Cancelar exige o dia da venda **aberto** | `cancelOrder` → `assertOpen` | 🟡 (ver P7) |
| V10 | Trocar peça: a errada volta, a certa sai, valor igual | `swapSaleItem` | 🟡 (ver P10) |
| V11 | Corrigir valor: diferença entra/sai no caixa | `correctOrderPrices` | 🟡 pagamento dividido não atualiza `payments` (ver P11) |
| V12 | Devolução de **parte** da venda | — | ❌ |

### 3.3 Reservas
| # | Regra | Status |
|---|---|---|
| R1 | Reserva não mexe no físico (movimento informativo de quantidade 0) | ✅ |
| R2 | Só reserva até o disponível; guardada não reserva | ✅ |
| R3 | Vale do dia em que foi feita em diante, **sem prazo** | ✅ como está — 🧭 prazo? |
| R4 | Cliente obrigatório | ❌ (15 de 22 sem cliente) |
| R5 | Reserva em cor arquivada/excluída | ❓ o serviço não bloqueia; não há caso nos dados |

### 3.4 Relatório e telas
| # | Regra | Status |
|---|---|---|
| T1 | Total do Estoque = total do relatório (só cores ativas) | ✅ (1.7) |
| T2 | “Esgotado” = 0 peças, reservadas aparecem como reservadas | ✅ |
| T3 | Relatório explica a diferença começou → terminou | ❌ mostra vendas e entradas, **não** saídas, perdas, ajustes e correções (ver P5) |
| T4 | “O que saiu” = vendas com cor + vendas do caderno sem cor | 🟡 mistura peças que não mexem no estoque |

---

## 4. Histórico dos problemas e aprendizados

| Quando | Problema | Causa | Correção | Aprendizado |
|---|---|---|---|---|
| até 1.5 | “Entrou no estoque: 664” | quantidade do cadastro lançada como entrada | cadastro = começou; migração `migrateCadastroEntries` | estoque inicial ≠ mercadoria que chegou |
| até 1.5 | Meta 15 → 18 virou peça a mais | meta e estoque no mesmo campo | “No estoque hoje” separado da meta | meta não é estoque |
| até 1.5 | “Cor Azul: 2 🚫 esgotado” com 2 reservadas | esgotado olhava o disponível | esgotado = físico 0 | físico ≠ disponível |
| até 1.5 | Início 9 esgotados × mensagem 1 | duas regras | uma função (`restockOf`, `loadStockRows`) | um número = uma função |
| 02–03/11 | Excluir apagava o histórico (22 exclusões “hard”, ~100 peças) e mudou o dia 02/11 já encerrado | delete físico | 1.6: exclusão “soft” (`deletedAt`) | dia encerrado nunca muda por efeito colateral |
| 03/11 | +117 peças lançadas como “Ajuste manual” às 02:47–03:04 | “Definir” para mais era sempre ajuste | 1.6: pergunta o motivo | intenção do usuário precisa ser explícita |
| 02–04/11 | **Poa 7 + Poa 7 = 14** (Camisa) e Azul com 122 peças | cor arquivada com peças continuava no dia, igual à nova, somando | 1.7: cor antiga separada, fora do total, “Resolver” | identidade da peça: uma cor física = um registro ativo |
| 03/11 03:20 | **Dorado › Azul 5 → 0** (e mais 3 cores) | “Atualizar” zerava cor cadastrada no dia | 1.7: só compara cores que existiam ontem | continuidade: cor nova não tem “ontem” |
| 04/11 | 167 toques em “−” para limpar cores fantasmas | não havia “zerar cor antiga” | 1.7: “Resolver” | limpeza também é operação de estoque |

---

## 5. Erros básicos que cometemos

Cada item: **problema → por quê → regra fundamental → comportamento correto → como evitar**.

### P1. Duas linhas para a mesma peça física (Poa 7 + 7) — ✅ corrigido em 1.7
- **Problema:** a cor antiga (arquivada) e a nova com o mesmo nome apareciam iguais no Estoque, com + e −, somando no total.
- **Por quê:** “arquivar com saldo” foi pensado para “não sumir estoque”, mas a tela não distinguia a linha e o total somava tudo.
  O cadastro deixa recriar o mesmo nome se a antiga estiver arquivada.
- **Regra:** *uma peça física tem um único registro ativo; total = soma só do que existe.*
- **Correto:** ao arquivar com saldo, decidir o destino das peças (passar, zerar, manter separado) e nunca somar a antiga.
- **Evitar:** teste `cor-repetida.test.ts`; diagnóstico avisa cor antiga com saldo e nome repetido. O editor da cor já permite
  trocar a bolinha sem recriar (`Catalog.tsx`, `updateVariant` com `color`); a recriação em massa de 02/11 indica que isso
  **não era encontrado** pela usuária — 🟡 problema de descoberta na tela, não de função.

### P2. Cadastro escreve o “começou” sem movimento — 🟡 parcialmente tratado
- **Problema:** `createVariant` grava `initialQuantity = quantidade` no dia de hoje. Para qualquer conta “ontem → hoje”, essa
  peça parece ter surgido do nada. Foi isso que fez o “Atualizar” zerar 4 cores (P2 do dia 03/11).
- **Por quê:** decisão correta (cadastro não é “Entrou”), mas implementada **mexendo na foto do dia** em vez de registrar um fato.
- **Regra:** *toda mudança de saldo deve ser explicável por um registro.*
- **Correto:** um movimento próprio, por exemplo “estoque inicial do cadastro”, que não conta como “Entrou” mas fica no histórico
  e na conta. 🧭 decisão de modelagem.
- **Evitar:** o teste `atualizar-cor-nova.test.ts` cobre o “Atualizar”; outros lugares que comparam dias (`compareDays`, histórico)
  ❓ não foram auditados para esse caso.

### P3. Dia encerrado alterado por efeito colateral — ✅ (causa) / 🟡 (modelo)
- **Problema:** exclusões “hard” de 03/11 apagaram registros do dia 02/11 (encerrado). Hoje 02/11 mostra 426 → 385, que não é o
  que ela viu e mandou naquele dia.
- **Regra:** *período fechado é imutável; correção entra como lançamento novo.*
- **Correto:** já é assim para excluir (1.6) e para desfazer (`undoMovement` lança hoje). **Não** é assim para cancelar venda (P7)
  nem para reabrir o dia.
- **Evitar:** qualquer função que escreva num dia deve passar por `assertOpen`; a exceção é a migração (`migrateCadastroEntries`
  apaga movimentos — feita uma vez, com tombstone).

### P4. Intenção ambígua: “Definir” para mais era ajuste — ✅ corrigido em 1.6
- **Problema:** 03/11 tem +117 em “Ajuste manual” (25 cores em 17 minutos): era mercadoria chegando. O relatório daquele dia
  mostra “Entrou 15” em cores ativas.
- **Regra:** *entrada, saída, perda e ajuste são fatos diferentes; o relatório depende da classificação.*
- **Evitar:** o picker de motivo. Os dados antigos continuam classificados como ajuste (não dá para saber com certeza).

### P5. O relatório não fecha a conta para quem lê — ❌ aberto
- **Problema:** o WhatsApp mostra “O que saiu” (só vendas), “Entrou” e “Começo → final”. **Saídas, perdas, ajustes e correções
  não aparecem.** Dados reais de 04/11: começou 446, vendeu 8, entrou 32 → deveria dar 470; terminou **452**. As 18 peças
  (13 saídas + 5 desfazimentos) não estão em lugar nenhum da mensagem.
- **Por quê:** `daySummary` calcula `outUnits` e `adjustUnits`, mas `report.ts` e `CloseDay.tsx` não usam.
  O teste de “a conta fecha” (`conta-estoque.test.ts`) não inclui saída nem perda.
- **Regra:** *começou − vendido + entrou − saiu/perdeu ± ajuste = terminou, e cada termo aparece.*
- **Correto:** uma linha “Saiu sem venda / perdas / ajustes” no relatório e no Encerrar.
- **Evitar:** teste que gere todos os tipos de movimento e confira a soma da mensagem.

### P6. Reserva usada como ferramenta genérica — 🧭 aberto
- **Problema:** 20 reservas ativas (48 peças), a mais antiga de 02/11, nunca resolvidas. As notas mostram outros usos:
  “Se lo llevaron a casa” (13 Naranja › Poa), “Porque ya llevo 6 a casa” (Lila › Blanco), “Eran lila, no broche”
  (6 peças no grupo errado), 15 com “Pedido” e sem cliente.
- **Por quê:** faltam operações para “levei para casa”, “estão no grupo errado” e talvez “encomenda”; a reserva era o único jeito
  de “tirar da venda sem tirar do estoque”.
- **Regra:** *cada estado da peça precisa de um nome próprio; reserva tem dono e prazo.*
- **Efeito:** 5 cores com 0 disponível e peças no total; peças fora da loja contadas no estoque.
- **Correto:** 🧭 depende das respostas da seção 12.

### P7. Cancelar venda de um dia encerrado — 🟡 aberto
- **Problema:** `cancelOrder` exige o dia da venda aberto. A pessoa reabre ontem, cancela, a peça volta **no ontem**; hoje só
  recebe a peça depois do “Atualizar”. Até lá, Vender usa o estoque antigo.
- **Inconsistência:** desfazer movimento de dia encerrado lança **hoje** (`undoMovement`); cancelar venda lança **ontem**.
- **Regra:** *a devolução física acontece no dia em que a peça volta.*
- **Correto:** 🧭 cancelar venda antiga = estorno e devolução lançados hoje, ligados à venda original.

### P8. A continuidade entre dias depende de botão — 🟡 aberto
- **Problema:** o modelo guarda uma foto por dia. Corrigir um dia passado não corrige os seguintes; o “Atualizar” traz só do
  dia imediatamente anterior para o dia aberto. Correção em 02/11 com 03/11 encerrado e 04/11 aberto não chega ao 04/11 sem
  reabrir o 03/11.
- **Regra:** *o saldo de hoje deve ser derivável do histórico, não de uma cópia.*
- **Correto:** ou proibir mexer no passado (lançar tudo hoje), ou recalcular a cadeia inteira. 🧭 decisão de modelagem.

### P9. Regras só na tela, não no serviço — 🟡 aberto
- `createOrder` não recusa cor arquivada/excluída; `createReservation` também não; `swapSaleItem` recusa arquivada mas não
  confere `forSale`; `moveStock` aceita + em cor excluída (foi o que permitiu +10 em cores excluídas em 03/11, antes de 1.7).
- **Regra:** *a regra mora no serviço; a tela só esconde.*
- **Evitar:** teste de serviço “não vende/reserva/entra em cor antiga”.

### P10. Troca de peça grava “venda” positiva e reescreve a venda — 🟡
- `swapSaleItem` registra a peça que volta como movimento tipo `venda` com quantidade **+1** e altera o `variantId` da linha da
  venda no lugar (ou apaga a linha com tombstone). O total fecha, mas o histórico da venda passa a dizer que foi vendida a
  peça certa desde o início e a lista de movimentos mostra “venda +1”.
- **Correto:** tipo próprio (“troca”) e a linha original mantida como trocada. ❓ impacto no histórico da peça não testado.

### P11. Corrigir valor com pagamento dividido — ❓
- Sem “forma por peça”, a correção lança a diferença na forma principal mas **não** atualiza `order.payments`. Se a venda tinha
  Pix + dinheiro, o “Pix conferido” passa a olhar valores antigos. Não há caso nos dados; precisa de teste.

### P12. Preço não é dado de cadastro — 🧭
- Nenhuma cor ativa tem preço salvo. O app sugere o **último preço do grupo**: um desconto vira o padrão da próxima venda.
  Dados: Plomo › Cafe vendida a 72, 73 e 75; cartão com 87,77 e 98,18 (provável taxa da maquininha calculada à mão).

### P13. “Quem fez” nunca preenchido — 🟡
- 0 de 453 movimentos e 0 de 371 auditorias têm nome. Com dois celulares, não dá para saber quem lançou o quê.

---

## 6. Gaps e cenários não contemplados

| Cenário real | O que acontece hoje | Status |
|---|---|---|
| Cliente devolve **1** de 3 peças | só cancelar tudo e vender de novo, ou trocar | ❌ |
| Cliente devolve peça comprada ontem | reabrir ontem, cancelar, “Atualizar” hoje | 🟡 (P7) |
| Peça com defeito volta e não pode vender | cancelar + “perda”; não há estado “com defeito” | 🟡 (há “guardada”) |
| Peças levadas para casa / consignadas | usam reserva sem prazo | 🧭 (P6) |
| Peças cadastradas no grupo errado | usam reserva; “Mover” move a cor inteira, não parte das peças | ❌ mover N peças entre cores |
| Mesma peça vendida nos dois celulares | ambos vendem; ao juntar fica negativo e avisa | ✅ por decisão / 🧭 aceitar o risco? |
| Celulares com catálogos criados separados | juntar casa por nome; uma cor antiga arquivada pode casar com a ativa e somar os movimentos das duas | ❓ risco lido no código (`mergeBackup`), não visto nos dados |
| Contagem geral (inventário) | “Definir” cor por cor ou importar “definir” | 🟡 sem “modo inventário” com antes/depois de tudo |
| Reserva esquecida há dias | continua bloqueando, sem aviso de idade | ❌ |
| Venda à meia-noite | fica no dia em que começou | ✅ |
| Dia reaberto esquecido | aviso no Início | ✅ |
| Cor recriada para mudar a bolinha | gerava duplicata | 🟡 (P1) |
| Preço diferente por forma de pagamento (cartão) | digitado à mão | 🧭 |

---

## 7. Integração entre vendas e estoque

```
Confirmar venda (uma transação IndexedDB)
 ├─ confere: dia aberto · reserva convertida válida · cor existe · à venda · qty ≤ físico − reservado
 ├─ caixa: 1 lançamento por forma de pagamento (venda sem preço não lança)
 ├─ orders + sales (status ok)
 ├─ stockMovements tipo venda (−qty), saldo antes/depois
 └─ reservas convertidas → status converted

Cancelar (transação) → +qty tipo cancelamento no DIA DA VENDA · estorno por forma · sales/order cancelled · reserva volta (opcional)
Trocar → +qty (tipo venda) na errada, −qty na certa · caixa não muda
Corrigir valor → só caixa (venda/estorno “Correção de valor”) · estoque não muda
```

**Sólido:** venda, caixa e estoque nunca ficam pela metade num celular (transação única); o diagnóstico confere venda × peças ×
caixa × estoque. Nos dados reais, as 42 vendas fecham.

**Frágil:** o que acontece **depois** do dia (P7), a classificação da troca (P10) e as regras que só a tela aplica (P9).

---

## 8. Riscos de inconsistência e concorrência

| Risco | Gatilho | Proteção hoje | Avaliação |
|---|---|---|---|
| Saldo gravado ≠ começou + movimentos | escrita fora de `applyStockDelta` | diagnóstico (erro) | ✅ detectado; 0 casos nos dados |
| Começou de hoje ≠ fim de ontem | dia anterior corrigido depois | aviso + “Atualizar” (só 1 dia) | 🟡 (P8) |
| Peça física em dois registros | arquivar/recriar | 1.7 + diagnóstico | ✅ |
| Peça somando no lugar errado ao juntar | casar por nome | nenhuma | ❓ |
| Venda da última peça em dois celulares | uso offline simultâneo | aviso pós-juntar | 🧭 |
| Dois toques no Confirmar | toque duplo | id da venda | ✅ |
| Dia encerrado mudando | reabrir, cancelar venda antiga | registro `reopenedAt` | 🟡 |
| Tela × relatório com números diferentes | regras duplicadas | funções únicas (`loadStockRows`, `daySummary`) | ✅ estoque · ❌ explicação da diferença (P5) · ❓ o Início calcula alguns totais por conta própria (`Home.tsx`), não comparado |
| Peças fora da loja contando no total | reserva usada como “levei” | nenhuma | 🧭 (P6) |

**Fontes de verdade duplicadas** (podem divergir): `dailyStockItems.currentQuantity` × soma dos movimentos;
`orders.totalInCents` × soma de `sales` × soma do caixa; `orders.payments` × lançamentos de caixa (P11);
`variants.startQuantity` usado como estoque inicial **e** como meta padrão.

---

## 9. O que está sólido e o que não está

**Sólido (confirmado no código e nos dados):**
- Atomicidade venda + caixa + estoque; idempotência do Confirmar.
- Livro de movimentos com antes/depois e desfazer por inverso.
- Bloqueio de negativo local; disponível respeitando reservas.
- Dinheiro em centavos; estorno por forma; Pix conferido com valor.
- Diagnóstico de coerência (nos dados reais: nenhuma divergência de saldo, de cadeia entre dias ou de venda × caixa).
- Depois de 1.7: cor antiga isolada; cadastro do dia preservado no “Atualizar”.

**Não sólido:**
- Continuidade entre dias depende de cópia + botão (P2, P8).
- Mudanças em dia passado (P3, P7).
- Relatório não explica a diferença do estoque (P5).
- Estados da peça faltando; reserva fazendo papel de vários (P6).
- Regras de “cor antiga” só na tela (P9).
- Rastreabilidade de pessoa (P13) e de preço (P12).

**Conclusão:** o **registro** é confiável (o que foi lançado está lá e fecha). O **significado** não é: o mesmo número pode
estar contando peça fantasma, peça fora da loja ou mercadoria classificada como ajuste. Até aqui as correções foram pontuais,
cada uma no sintoma (tela, relatório, botão). As regras fundamentais que faltam são três: **identidade única da peça**,
**continuidade derivada do histórico** e **passado imutável**.

---

## 10. Recomendações (em ordem, sem refatoração antes da decisão)

1. **Relatório e Encerrar mostram saídas, perdas, ajustes e desfazimentos** (P5). Baixo risco, alto ganho de clareza.
2. **Serviço recusa venda, reserva, entrada e troca em cor arquivada/excluída** (P9), com teste.
3. **Decidir os estados da peça** (seção 12) antes de mexer em reservas: “levei para casa”, “grupo errado”, “encomenda”.
4. **Cancelar venda de dia encerrado lança hoje** (P7), como o desfazer já faz.
5. **Cadastro com quantidade vira um movimento próprio** (P2) — muda o modelo; fazer só com decisão e migração testada.
6. **Avisar reserva com mais de N dias** e exigir cliente ou motivo.
7. **Preço na cor ou no grupo** e, se for regra, taxa do cartão (P12).
8. **Pedir “Seu nome” no primeiro uso** de cada celular (P13).
9. **Teste do Juntar com cor arquivada e ativa de mesmo nome** (risco da seção 8).
10. **Tipo “troca”** em vez de “venda +1” (P10) e teste de correção com pagamento dividido (P11).

---

## 11. Checklist de validação do gerenciamento de estoque

Rodar depois de cada mudança (automatizar como teste quando possível):

- [ ] Para cada dia e cor: `agora = começou + movimentos` (diagnóstico sem erro).
- [ ] Para cada dia: `começou = fim do dia anterior`, **exceto** cores criadas no dia.
- [ ] Total do Estoque = total do relatório = total do Início.
- [ ] Relatório: `começou − vendido + entrou − saiu − perdeu ± ajuste ± desfeito = terminou`.
- [ ] Nenhuma cor arquivada/excluída com saldo no dia aberto (ou resolvida pelo “Resolver”).
- [ ] Nenhum nome repetido entre cores ativas do mesmo grupo.
- [ ] Toda venda `ok`: soma das peças = total = caixa líquido; movimentos de venda = −quantidade vendida.
- [ ] Toda venda cancelada: caixa líquido 0 e estoque líquido 0.
- [ ] Reservas ativas ≤ físico em cada cor; nenhuma sem cliente/motivo; idade conhecida.
- [ ] Desfazer de dia encerrado entrou hoje; dia encerrado sem movimento depois do `closedAt` (salvo reaberto).
- [ ] Juntar duas vezes o mesmo código não muda nada.
- [ ] Movimentos com “quem fez” preenchido.

---

## 12. Dúvidas de negócio que ainda precisam ser respondidas

1. **“Pedido” nas reservas** (15 casos): é encomenda de cliente, peça separada para entregar, ou lista para comprar do fornecedor?
2. **Peças levadas para casa** (13 Naranja › Poa, 6 Lila › Blanco): continuam sendo estoque da loja? Voltam? Contam no total?
3. **Peças no grupo errado** (“Eran lila, no broche”): mover as peças entre cores deveria existir?
4. **Reserva tem prazo?** O que fazer com reserva de vários dias atrás?
5. **Devolução parcial:** a cliente devolve uma peça — devolve dinheiro, vira crédito ou troca?
6. **Cancelar venda de ontem:** o estoque e o dinheiro voltam ontem ou hoje?
7. **Preço:** existe preço fixo por grupo/cor? Desconto é exceção? Cartão tem acréscimo fixo?
8. **Dois celulares vendendo ao mesmo tempo:** acontece? Aceitam o risco de vender a última peça duas vezes?
9. **Meta / repor:** ela usa? (desligou o repor 71 vezes). A meta deve continuar sendo, por padrão, a quantidade do cadastro?
10. **Quem pode arquivar/excluir** e se excluir deve exigir saldo zero.
11. **Contagem geral (inventário):** ela conta a loja inteira de tempos em tempos? Precisa de um modo próprio?

---

## 13. Situação depois das correções (1.7, ainda não publicado)

Testes novos: `src/__tests__/lacunas.test.ts` (10 casos), `cor-repetida.test.ts`, `atualizar-cor-nova.test.ts`.

| Item | Antes | Agora | Onde |
|---|---|---|---|
| P1 cor repetida somando | ❌ | ✅ cor antiga separada, fora do total, “Resolver” | `Stock.tsx`, `settleRetiredStock` |
| P2 cadastro sem movimento | 🟡 | 🟡 continua sem movimento; o efeito (Atualizar zerar) foi corrigido | `resyncOne` |
| P3/P7 dia encerrado mudando | 🟡 | ✅ cancelar e devolver venda antiga lançam **hoje**; reabrir avisa | `returnDay` em `sales.ts`, `day.tsx` |
| P5 relatório não fecha | ❌ | ✅ linha 🧮 com todos os termos + seções “Saiu sem ser venda” e “Ajustes de contagem”; também no Encerrar | `daySummary.flow`, `flowText` |
| P6 reservas como ferramenta genérica | 🧭 | 🟡 aviso “há N dias” e “Sem nome” em destaque; **sem** bloquear (decisão pendente, seção 12) | `Sell.tsx` |
| P8 continuidade só 1 dia | 🟡 | ✅ “Atualizar” anda pela cadeia até o último dia “do zero”; aviso olha a cadeia | `resyncFromPrevious`, `syncGap(id, true)` |
| P9 regras só na tela | 🟡 | ✅ `assertLiveVariant` em venda, reserva, entrada/saída/definir e troca; troca recusa guardada | `days.ts`, `sales.ts` |
| P10 troca como “venda +1” | 🟡 | 🟡 o registro continua tipo venda; tela e histórico mostram “Troca: voltou/saiu” | `Stock.tsx`, `history.ts` |
| P11 pagamento dividido na correção | ❓ | ✅ `payments` acompanha o caixa | `syncPayments` |
| P12 preço | 🧭 | 🟡 sugere o último preço **da cor**; preço fixo e taxa do cartão seguem como decisão | `Sell.tsx` |
| P13 quem fez | 🟡 | 🟡 lembrete no Início quando o nome está vazio | `Home.tsx` |
| Devolução parcial | ❌ | ✅ “↩️ Devolver” por peça; devolver tudo = Cancelar | `returnSaleItem` |
| Excluída com peças sumindo no dia seguinte | ❌ | ✅ passa como cor antiga até ser resolvida | `startDay` |
| Juntar casando cor antiga com ativa | ❓ | ✅ casa só com o mesmo estado (antiga com antiga) | `mergeBackup` |

**Continua aberto (precisa de decisão — seção 12):** significado de “Pedido”, peças levadas para casa, mover N peças entre
cores/grupos, prazo de reserva, preço fixo/taxa do cartão, dois celulares vendendo a mesma peça, modo inventário,
e se o cadastro com quantidade deve virar movimento próprio (P2).

**Efeito colateral aceito:** cancelar/devolver uma venda antiga muda o status/quantidade da venda no registro daquele dia
(a lista de vendas do dia mostra “cancelada”/“devolvida”), mas **não** muda o estoque nem o caixa daquele dia.
