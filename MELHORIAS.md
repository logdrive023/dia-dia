# Melhorias de lógica — Dia a Dia

Revisão do código em 31/10/2026 (commit `0c5243d`). Agora são 26 testes passando.
✅ = já corrigido no código (ainda sem commit). Veja também "Rodada de usabilidade" no fim.

Prioridade: 🔴 corrigir já · 🟠 importante · 🟡 melhoria · ⚪ manutenção

| # | Prioridade | Assunto | Esforço |
|---|---|---|---|
| 1 | ✅ 🔴 | Valor "1.230" é lido como 1,23 | pequeno |
| 2 | ✅ 🔴 | Conferência do caixa mistura Pix/Cartão com dinheiro vivo | médio |
| 3 | ✅ 🟠 | Saída/perda/ajuste pode "comer" peças reservadas | pequeno |
| 4 | ✅ 🟠 | App aberto depois da meia-noite continua no dia anterior | pequeno |
| 5 | ✅ 🟠 | iPhone pode apagar os dados se o app não for instalado | só orientação |
| 6 | 🟠 | Backup em texto vai ficar grande demais para o WhatsApp | médio |
| 7 | 🟡 | Transferir variações não checa nomes repetidos | pequeno |
| 8 | 🟡 | Não dá para pagar uma venda metade Pix, metade dinheiro | médio |
| 9 | 🟡 | Corrigir preço de venda exige cancelar e refazer | médio |
| 10 | 🟡 | Cancelar venda que veio de reserva não devolve a reserva | pequeno |
| 11 | 🟡 | Serviço de cadastro aceita lançar em dia encerrado | pequeno |
| 12 | 🟡 | Erro de restauração com mensagem técnica | pequeno |
| 13 | ⚪ | Histórico recalcula todos os dias a cada abertura | médio |
| 14 | ⚪ | `tsconfig.tsbuildinfo` está versionado | trivial |
| 15 | ⚪ | Sem testes de tela (ponta a ponta) | médio |

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
