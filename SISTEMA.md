# Dia a Dia — documentação completa do sistema

> Caderno digital de estoque, vendas e caixa para uma loja pequena, feito para o celular, que funciona sem internet.
> Este documento explica **o que existe**, **por que foi feito assim**, **como funciona por dentro** e **como testar**.

Link publicado: **https://logdrive023.github.io/dia-dia/** · Repositório: `github.com/logdrive023/dia-dia`

---

## Sumário

1. [O problema e a ideia](#1-o-problema-e-a-ideia)
2. [Como a usuária usa (o dia a dia)](#2-como-a-usuária-usa-o-dia-a-dia)
3. [Funcionalidades, tela por tela](#3-funcionalidades-tela-por-tela)
4. [Regras de negócio (como as contas funcionam)](#4-regras-de-negócio-como-as-contas-funcionam)
5. [Tecnologia e por que cada escolha](#5-tecnologia-e-por-que-cada-escolha)
6. [Arquitetura e pastas (arquivo por arquivo)](#6-arquitetura-e-pastas-arquivo-por-arquivo)
7. [Banco de dados](#7-banco-de-dados)
8. [Offline, instalação, atualização e segurança dos dados](#8-offline-instalação-atualização-e-segurança-dos-dados)
9. [Publicação (deploy)](#9-publicação-deploy)
10. [Testes: o que existe e como rodar](#10-testes-o-que-existe-e-como-rodar)
11. [Como testar à mão (no computador e no celular)](#11-como-testar-à-mão-no-computador-e-no-celular)
12. [Decisões importantes e problemas já resolvidos](#12-decisões-importantes-e-problemas-já-resolvidos)
13. [Dados iniciais oficiais](#13-dados-iniciais-oficiais)
14. [Limites conhecidos e ideias futuras](#14-limites-conhecidos-e-ideias-futuras)
15. [Como fazer mudanças sem quebrar nada](#15-como-fazer-mudanças-sem-quebrar-nada)

---

## 1. O problema e a ideia

A loja controlava tudo num **caderno "Check List"**: cada venda numa linha (`2x70 = 140 Dinero`), quem recebeu dinheiro
(`Chico: 50 — eu di`) e, no fim, a conta do caixa (`Ayer 645 + 885 = 1530 − 300 = 1230`). O estoque era uma lista de
grupos (Plomo, Lila, Broche…) e cores, com quantidades.

O app substitui o caderno sem mudar o jeito de pensar:

- **mesma conta do caderno** (ontem + hoje − saídas = saldo), com o formato do caderno disponível ao lado do formato "normal";
- **estoque por dia**: cada dia começa com o que sobrou do anterior;
- **relatório no WhatsApp** com um toque, no fim do dia;
- **sem login, sem servidor, sem internet**: tudo fica no celular;
- feito **para celular** (Android e iPhone), com letras e botões grandes e tudo explicado por "ⓘ" com exemplos.

---

## 2. Como a usuária usa (o dia a dia)

1. **Início › Iniciar o dia** → o dia começa com o estoque final do dia anterior (ou o cadastro, no primeiro dia). A diária de 150 entra sozinha no caixa.
2. **Vender** → toca em “+ Vender” nas peças, **Fechar venda**, confere o preço, escolhe como pagou (Dinheiro, Pix, Crédito, Débito; ou cada peça de um jeito). Escolheu Pix: o QR code aparece na tela.
3. **Caixa** → lança dinheiro que não é venda (dei dinheiro, entrada, despesa, retirada, pagamento) e vê a conta do dia.
4. **Encerrar o dia** → confere o dinheiro contado, toca em **Enviar no WhatsApp** (o app copia a mensagem e abre o WhatsApp: é só colar na conversa) e encerra.
   - Esqueceu de encerrar? Quando vira a data (app aberto à meia-noite ou aberto no outro dia), o dia anterior **encerra sozinho** (o caixa contado fica como estava). Dia reaberto de propósito não fecha de novo.
   - No **“Bom dia! Vamos começar?”** aparece **💾 Último backup: data às hora** e a pergunta “Quer fazer outro backup agora?” com o botão.
5. Usa dois celulares? **Menu › Juntar com outro celular** ao fim do dia.

---

## 3. Funcionalidades, tela por tela

### Cabeçalho (todas as telas)
- Título, **“✓ Tudo salvo · horário”** (último registro gravado; prova de que salvou) e selo **“✓ Atualizado / 🆕 Atualizar”**.
- Botão **Menu**.
- Barra de dias (7 dias + calendário), com cor por situação (aberto, encerrado, sem dia) e legenda.

### Início
- Situação do dia (não iniciado / aberto / encerrado) e escolha de como começar: **continuar** (recomendado) ou **do zero**.
- No **“Bom dia! Vamos começar?”**: cartão **💾 Último backup: dd/mm às hh:mm** (ou “Ainda não fez backup”) com a pergunta “Quer fazer outro backup agora?” e o botão; se o dia anterior fechou sozinho, avisa “O dia dd/mm foi encerrado sozinho”.
- **Desfazer o início** enquanto não houver lançamento (diária automática não conta).
- Botões **Nova venda**, **Encerrar o dia**, **⚡ Mostrar Pix (QR code)** e **Enviar relatório no WhatsApp** (copia e abre o WhatsApp; “Ver antes” abre o Encerrar o dia).
- Cartão **Vendido hoje** (total, vendas, peças, média, barra por forma de pagamento) e **Saldo do caixa**.
- Números do estoque (peças, para repor, esgotados, entrou hoje), cada um com explicação e atalho para o Estoque. São **os mesmos números** da mensagem do WhatsApp (esgotado = 0 peças).
- Cartões por grupo com filtro **Todos / À venda / Guardados**.
- Aviso de backup atrasado e dica de instalação no iPhone.

### Vender
- Ajuda “Como vender” e “Como reservar” (passo a passo com exemplo).
- Busca, escopo **⭐ Para vender / Todos os grupos** e filtros (disponíveis, repor, esgotadas, reservadas).
- **Estoque ⇄ Venda**: janela única para trazer peças guardadas para a venda ou guardar de volta (grupo inteiro ou cor a cor).
- Grupos que abrem e fecham (lembra a escolha no aparelho), “Abrir/Fechar todos”.
- Cada cor: quantas à venda, **começou → agora**, 📌 reservar, **+ Vender** / − +.
- **Fechar venda**:
  - preço por peça (sugere o último preço do grupo; “usar em todas”);
  - **“Pagou tudo numa forma só”** (ligado) ou desligado = **cada peça escolhe a sua forma** (2 peças iguais viram 2 linhas);
  - **QR do Pix** aparece quando há Pix, com o valor do Pix;
  - **Resumo da venda** (quanto em cada forma, peças sem preço, total);
  - não abre o teclado sozinho;
  - depois de vender no Pix: aviso **“já caiu? ✅ Caiu”**.
- Reservas (nome, quantidade, observação), converter reserva em venda, cancelar reserva.
- ⚙️ Grupos: quais grupos aparecem em “Para vender” e quais têm prioridade.

### Estoque
- Resumo (repor, esgotados — tocam e filtram), legenda “começou → agora”.
- Grupo: começou → agora, **Guardar todas / Pôr à venda**.
- Cor: + / − (entrada/saída), **definir quantidade** (ajuste), à venda/guardada, avisos (repor, 🚫 esgotado, 📌 reservadas). O repor de cada cor segue o cadastro (ver 4.5).
- **Movimentos do dia** (filtros: vendidas, entraram, saíram, ajustes) com **Desfazer** (cria movimento inverso, não apaga).

### Caixa
- Cartão verde: **Saldo** = Veio de ontem + Hoje; **Na mão** (dinheiro vivo) e **No banco** (Pix/cartão); vendas por forma com %.
- **Lançar dinheiro**: Dei dinheiro, Entrada, Despesa, Retirada, **Pagamento** (diária; “2 dias” = 2 diárias).
- **Conta do dia** em dois modos:
  - **Normal**: 📅 Ontem (dinheiro · banco) → ☀️ Caixa de hoje linha por linha (vendas por forma, cada saída) → **= Hoje** → ✅ **Total**;
  - **Caderno**: a mesma conta escrita como no caderno.
- **Conferir dinheiro** (contado × esperado: faltam / sobram / bateu).
- **Movimentado hoje**: cada venda com de onde veio cada peça (grupo › cor), forma por peça, **🔄 Trocar peça**,
  **✏️ Corrigir valor**, **✖️ Cancelar venda**, situação do Pix (**⏳ Conferir / ✅ Caiu / ⚠️ Mudou**); lançamentos manuais
  com ✕; vendas do caderno (sem peça) com Corrigir/Cancelar.

### Encerrar o dia

> **Esgotado = 0 peças**, igual em todo lugar (Início, Estoque, Vender e WhatsApp). Peça reservada continua no estoque:
> aparece como “🔒 N reservadas”, não como esgotada. Vender usa o que está livre (estoque − reservadas).

- Resumo (vendeu, entrou, repor), formas de pagamento, **✅ Total (ontem + hoje)**.
- **Dinheiro vivo contado**: a mensagem muda na hora (faltam/sobram/bateu).
- Relatório **WhatsApp** (padrão) ou **Caderno**.
- **Chaves da mensagem do WhatsApp**, na ordem da tela (ficam salvas e valem também para o “Enviar relatório” do Início):

| Chave | Padrão | Ligada | Desligada |
|---|---|---|---|
| 📦 Mostrar o estoque | ligada | lista “Estoque agora”, cor por cor, com os avisos ao lado | só “📊 Estoque no fim do dia: 385 peças” |
| 🌅 Começo → fim do dia em cada cor (só com o estoque ligado) | ligada | “Cor Azul: começou 15 → terminou 12” | “Cor Azul: 12” |
| 🧾 Totais no final | ligada | total no estoque, total para repor, “Começo do dia 426 → 🌙 final 385 = −41” | sem a seção |
| ➖ Divisão entre os grupos | ligada | linha `- - - - - - - -` entre um grupo e outro | sem a linha |
| 🔢 Repor com “tem X de Y” | desligada | “Cor Blanco: 1 (tem 14 de 15)” | “Cor Blanco: 1” |
| ✏️ Editar mensagem | desligada | dá para escrever junto antes de mandar (não muda dados) | vai o texto do app |
| ✂️ Mandar em partes se passar (no quadro do tamanho) | ligada | passou do máximo → vai em partes | vai inteira |

- Avisos ao lado da cor no “Estoque agora”: **🚫 esgotado** (só com 0), **🔒 N reservadas**, **⚠️ repor N**.
- **📏 Tamanho da mensagem**: “atual / máximo” em letras (máximo de uma mensagem do WhatsApp: **65.536**), com barra.
  Com os dados reais e tudo ligado: ~5.700. Passando do máximo com “partes” ligado, o quadro mostra **antes** quantas partes,
  o tamanho de cada uma e onde cada uma começa.
- Recado em cima do botão: **“Ao clicar em Enviar no WhatsApp vai copiar e abrir o WhatsApp. Lá é só colar na conversa.”**
- **Enviar no WhatsApp**, **Copiar texto**, **Outros apps** (compartilhar do celular). Como o envio funciona: ver 4.16.
- O repor de cada cor vem do cadastro (ver 4.5).
- **Encerrar o dia** bloqueia o dia contra mudanças acidentais (dá para reabrir).

### Menu
| Item | O que faz |
|---|---|
| Produtos e grupos | cadastrar/renomear/ordenar grupos e cores, preço, 44 cores com nome; em cada cor: **📦 No estoque hoje** (corrige a quantidade), **🔁 Precisa repor?**, **📏 Tem estoque mínimo?**, **🎯 Meta**; arquivar e **🗑️ Excluir** (também direto na lista de arquivadas) |
| Mostrar meu Pix | QR code do Pix na tela (valor opcional), copiar código, onde conferir (Neon/iPhone) |
| Histórico | calendário do mês, resumo do mês, melhor dia, cartões por dia, comparar dois dias |
| Juntar com outro celular | gera código com tudo / cola o código do outro e **soma** |
| Passar para outro celular | arquivo ou texto com tudo e **substitui** no outro (troca de aparelho) |
| Backup | cópia em arquivo ou texto, restaurar, planilhas CSV, “voltar como estava” |
| Atualizações | o que mudou em cada versão (selo “Novo” até abrir) |
| Configurações | formas de pagamento, moeda, **sua diária** e diária automática, lembrete de backup, título do relatório, **dados protegidos** (status, teste de gravação, espaço), verificar dados, **recomeçar** (dados iniciais ou do zero) |
| Sobre | “Feito com amor, pelo seu amor 🥰” |

---

## 4. Regras de negócio (como as contas funcionam)

### 4.1 Dinheiro sempre em centavos
Todo valor é **inteiro em centavos** (`7000` = 70,00). Nada de número quebrado: evita 0,1 + 0,2 ≠ 0,3. Limites validam
valores absurdos (`MAX_CENTS`, `MAX_QTY`). Digitação aceita “1.474,80”, “70”, “70,5”; recusa lixo, negativos e notação científica.

### 4.2 Dias independentes (estoque por data)
- Cada dia tem uma **cópia** do estoque (`dailyStockItems`): `initialQuantity` (começou) e `currentQuantity` (agora).
- **Iniciar o dia (continuar)** copia o `currentQuantity` do último dia anterior. Primeiro dia: usa a quantidade do cadastro.
- **Do zero**: todas as peças em 0 e caixa 0 (para recontar tudo).
- Se um dia anterior for corrigido depois que o seguinte começou, aparece o aviso **“o dia anterior mudou”** com botão para acertar.
- **Virou a data, o dia de ontem encerra sozinho** (`autoCloseOldDays`): ao abrir o app e quando passa da meia-noite com o
  app aberto, todo dia ainda aberto **antes de hoje** é encerrado (marca `autoClosedAt`; o caixa contado fica como estava).
  Dia **reaberto de propósito** (`reopenedAt`) não fecha de novo. A tela segue para o novo dia.
- **Cor nova cadastrada com quantidade**: a quantidade é o estoque com que a cor **começa** o dia (não é “Entrou”). Dados antigos que registravam como entrada são convertidos sozinhos ao abrir o app (`migrateCadastroEntries`), sem mudar o estoque final.

### 4.3 Todo movimento de estoque é registrado
Venda, entrada, saída, perda, ajuste, cancelamento, troca: cada um vira um `stockMovement` com saldo antes/depois.
**Desfazer não apaga**: cria um movimento inverso (`correcao`) ligado ao original. Regra que o diagnóstico confere:
**estoque = começou + soma dos movimentos**.

### 4.4 À venda × guardada
Nem tudo que está no estoque está à venda. Cada cor tem `forSale` (padrão: à venda). Guardada não aparece no Vender e não
pode ser vendida/reservada (exceto convertendo uma reserva que já existia). **Grupo novo**: a primeira cor já nasce à venda
e o grupo entra em ⭐ Para vender.

### 4.5 Estoque ideal e “repor” (configurado em cada cor)
Uma regra só (`restockOf` em `summary.ts`), usada no Início, no Estoque e no WhatsApp:

| Cadastro da cor | Repor |
|---|---|
| 🔁 Precisa repor? **desligado** | nunca (0) |
| 📏 Tem estoque mínimo? **ligado** (ex.: mínimo 3, meta 10) | só quando chega no mínimo: com 5 → 0; com 3 → 7; com 0 → 10 |
| sem mínimo | **meta − agora** (nunca negativo) |

- **Meta** = `idealStock` da cor ou, vazio, a quantidade do cadastro. Ex.: cadastrou 15, vendeu 1 → repor 1.
- Mudar a **meta** (ex.: 15 → 18) **não mexe no estoque**: só muda o repor (3).
- Para corrigir quantas peças tem, use **“📦 No estoque hoje”** na cor (vira ajuste, não “Entrou”).

### 4.5b Arquivar e excluir
- **Arquivar**: some do Vender, do Estoque e do **relatório** (Entrou, Repor, total do estoque); dá para reativar.
- **Excluir** (também direto na lista de arquivadas): nunca vendida → apaga de vez; já vendida → some de tudo, mas as vendas antigas continuam no histórico com o nome.

### 4.6 Reservas
Reserva separa peças para uma cliente: **disponível = estoque − reservado**. Vale para o dia da reserva e os seguintes.
Saída/ajuste que deixaria menos peças que o reservado pergunta antes. Converter reserva = venda; cancelar venda que veio
de reserva pode devolver a reserva. Cor com tudo reservado **não é esgotada**: continua no estoque e aparece como
“🔒 2 reservadas” (ex.: começou 3, vendeu 1, 2 reservadas para Kelly → “Cor Azul: 2 🔒 2 reservadas”).

### 4.7 Vendas
- Uma venda = uma cliente, várias peças (`order` + `sales`). Toque repetido no Confirmar não duplica (id da venda gerado ao abrir o carrinho).
- **Forma de pagamento**: uma só, ou **por peça** (`payByLine`): o caixa recebe a soma por forma.
- **Corrigir valor**: a diferença entra/sai no caixa como “correção de valor” (com forma por peça, na forma de cada peça).
- **Cancelar**: devolve as peças e estorna cada forma. Nada é apagado.
- **Trocar peça** (vendeu Branco, era Vermelho): a errada volta, a certa sai; valor e caixa não mudam.
- **Pix conferido**: guarda quando e **quanto** foi conferido; se o valor mudar depois → “⚠️ Pix mudou”.

### 4.8 A conta do caixa
```
Ontem (saldo do dia anterior)              1.474,80   (💵 645 em dinheiro · 🏦 829,80 no banco)
+ vendas por forma (Dinheiro, Pix, Crédito, Débito)
+ entradas
− dei dinheiro (ex.: Chico 50)
− despesas
− pagamento da diária (uma linha por dia)
− retiradas
= Hoje (resultado do dia)                    +585
Total = Ontem + Hoje                       2.059,80
Na mão = dinheiro de ontem + dinheiro de hoje (só lançamentos em dinheiro)   1.230
No banco = Total − Na mão                    829,80
```
- “Ontem” vem sozinho do último dia (`cashChain` calcula todos os dias em ordem); pode ser digitado à mão em caso especial.
- O mesmo cálculo alimenta tela, WhatsApp, caderno e CSV (`cashStatement` gera as linhas da conta, sempre na mesma ordem).

### 4.9 Diária (pagamento de quem vende)
- Valor em **Configurações › Sua diária** (padrão 150).
- **Automática** (pode desligar): ao iniciar o dia, entra “Pagamento da diária de dd/mm: 150” **só no dia de hoje**.
  Não duplica; se tirar no ✕, não volta; dia antigo esquecido aberto não recebe.
- Diárias atrasadas: Caixa › Pagamento › “2 dias” → duas linhas de 150.

### 4.10 Pix
- QR estático da conta Neon. O código foi lido da foto, **conferido pelo CRC do padrão Pix** e o QR foi **gerado de novo,
  limpo** (PNG em base64 dentro do app, vira imagem na hora). Botão “copiar código Pix (copia e cola)”.
- O app sabe se é **iPhone** (não tem o Neon) ou **Android** (Samsung com Neon) e diz onde conferir.
- **Não lê notificações**: app de navegador não tem permissão para ler notificações de outros apps (Android nem iPhone).
  Por isso a conferência é um toque (“✅ Caiu”).

### 4.11 Vendas do caderno (sem peça)
Os cadernos de 30/10 e 31/10 não dizem a cor vendida. Viraram **vendas no caixa sem peça** (`cashMovement` tipo venda sem
venda ligada), mostradas como “📒 Do caderno · peça não anotada”, com Corrigir/Cancelar. **Não mexem no estoque.**

### 4.12 Recomeçar
- **Voltar aos dados iniciais**: lista oficial + cadernos.
- **Reiniciar tudo do 0**: app vazio (sem grupos, sem dias, caixa 0). Deixa a marca “já preparado” para os dados iniciais
  não voltarem sozinhos ao abrir.
- Os dois guardam uma cópia antes (“Voltar como estava”), limpam o carrinho e recarregam o app.

### 4.13 Juntar celulares (dois aparelhos)
Cada celular guarda os próprios dados. **Juntar** soma os dois:
- o código é o backup inteiro em texto (JSON → gzip → base64, partes de 60 mil letras, conferência por parte);
- **produtos casam por nome** (grupo + cor), porque cada celular gera identificadores próprios;
- **dias casam pela data**; vendas, peças, lançamentos e movimentos casam pelo identificador (não duplicam);
- venda **cancelada** num celular fica cancelada; venda mexida dos dois lados: vale a versão com **mais mudanças**;
- **Pix conferido**: vale a conferência mais recente;
- diária automática e linhas do caderno **não duplicam**; o que foi **apagado** (✕, linha juntada na troca) **não volta**
  (lista de “apagados”, `tombstones`, que também viaja no código);
- o estoque de cada dia é **refeito**: começou + movimentos;
- se os dois venderam a mesma última peça, o estoque fica negativo e o app **avisa** (“Peça vendida nos dois celulares”);
- **idempotente**: importar o mesmo código de novo não muda nada; faça nos dois sentidos para os dois ficarem iguais.

### 4.14 Backup e transferência
- Backup em **arquivo JSON** ou **texto** (o mesmo formato do Juntar). Validação completa antes de restaurar; se falhar,
  **nada muda** (transação única).
- Antes de restaurar/receber/recomeçar/juntar, guarda **cópia de segurança** (tabela `safety`): “Voltar como estava”.
- CSV para planilha (estoque, vendas, histórico) com proteção contra “fórmula” no Excel.

### 4.15 Auditoria e diagnóstico
- `auditLogs` registra mudanças importantes (cancelar, corrigir, trocar, apagar lançamento, iniciar/desfazer dia…).
- **Configurações › Verificar dados** roda `runDiagnostics`: estoque × movimentos, venda × peças × caixa, caixa por dia,
  reservas, avisos (dia no futuro, estoque negativo após juntar…).

### 4.16 Relatório do WhatsApp (como é montado e enviado)
- **Ordem das seções** (`whatsappReport` em `report.ts`): 📒 Fechamento → 💰 Vendas → 🧮 Caixa (ontem, conta linha por
  linha, = Hoje, ✅ Total, na mão, no banco, contado) → 🛍️ O que saiu → 📦 Entrou no estoque → 🔁 Precisa repor →
  🚫 Esgotados → 📦 Estoque agora (ou 📊 Estoque no fim do dia) → 🧾 Totais. Cores agrupadas por grupo.
- **Fora da mensagem**: cores arquivadas/excluídas e grupos arquivados (não entram em Entrou, Repor, Estoque nem totais);
  a quantidade do cadastro não é “Entrou”.
- **A conta fecha** (teste `conta-estoque.test.ts`): começou − saiu + entrou ± ajuste = terminou, em cada cor e no total.
  Venda cancelada devolve a peça e não conta em “O que saiu”. Dados reais de 02/11: 426 − 41 = 385.
- **Esgotados (N)** = o mesmo número do Início (todas as cores com 0, mesmo as que também estão em “repor”).
- **Enviar = copiar + abrir** (`sendWhatsApp`): copia a mensagem inteira e abre o app (`whatsapp://`; no computador,
  WhatsApp Web). Lá a pessoa escolhe a conversa e cola. Não usa o link `wa.me/?text=`: no iPhone ele abria a página do
  WhatsApp (com emoji quebrado) e “Abrir app” não chegava na conversa. Se não conseguir copiar, **não** abre o WhatsApp e
  avisa para usar “Copiar texto”.
- **Partes** (`splitForWhatsApp`, só se passar de 65.536 letras e com a chave ligada): copia a parte 1 (“📨 *Parte 1 de 2*”)
  e abre o WhatsApp; ao voltar para o app aparece a faixa **“💬 Mandar parte 2”** (`PartsBanner`, guarda as partes só na
  memória). Corta entre seções ou, se der menos partes, entre linhas — **nunca no meio de uma linha**; a parte que continua uma
  seção começa com “↪️ título (continua)”. Juntando as partes estão todas as linhas, na ordem (teste).

---

## 5. Tecnologia e por que cada escolha

| Peça | Versão | Por quê |
|---|---|---|
| **React** | 18.3 | telas reativas, ecossistema enorme, fácil de manter |
| **TypeScript** | 5.6 (`strict`, sem variáveis não usadas) | pega erro antes de rodar; o build falha se o tipo estiver errado |
| **Vite** | 5.4 | build rápido, servidor de desenvolvimento instantâneo |
| **Tailwind CSS** | 3.4 | estilo direto no componente, consistente, sem CSS solto |
| **Dexie** | 4 (IndexedDB) | banco de dados **dentro do navegador**, com transações e índices; funciona offline |
| **dexie-react-hooks** (`useLiveQuery`) | 1.1 | a tela se atualiza sozinha quando o banco muda |
| **vite-plugin-pwa** (Workbox) | 0.20 | transforma o site em **app instalável** que funciona offline e se atualiza |
| **Vitest** | 2.1 | testes rápidos, mesmo ecossistema do Vite |
| **fake-indexeddb** | 6 | banco em memória para testar as regras sem navegador |
| **jsdom + Testing Library** | 25 / 16 | testa as **telas** como a pessoa usa (tocar, digitar, ver) |
| **GitHub Actions + Pages** | — | a cada push: testa, compila e publica de graça |

Por que **sem servidor**: custo zero, funciona sem internet, os dados não saem do celular (privacidade). O preço disso é
que cada celular tem seus dados — resolvido com **Juntar celulares**, **Backup** e **Passar para outro celular**.

---

## 6. Arquitetura e pastas (arquivo por arquivo)

```
dia-dia/
├─ .github/workflows/deploy.yml   publica no GitHub Pages (testa → compila → publica)
├─ public/                        ícones do app (192, 512, svg)
├─ scripts/icons.mjs              gera os ícones
├─ index.html                     página única
├─ vite.config.ts                 Vite + PWA (manifesto, cache) + Vitest (configuração dos testes)
├─ tailwind.config.js / postcss.config.js
├─ SISTEMA.md                     este documento
├─ MELHORIAS.md / README.md       histórico de melhorias e guia rápido
└─ src/
   ├─ main.tsx                    liga o React na página
   ├─ App.tsx                     casca do app: cabeçalho, abas, menu, janelas, atualização, “Mandar parte 2”, recuperação de erro
   ├─ state.tsx                   estado global: dia escolhido, carrinho, aba, janela aberta, configurações
   ├─ index.css                   estilos globais (Tailwind) e regras de rolagem no celular
   ├─ db/
   │  ├─ db.ts                    banco Dexie (tabelas e índices, versões)
   │  ├─ types.ts                 tipos de todos os registros
   │  └─ seed.ts                  dados iniciais oficiais (lista do estoque, grupos à venda, cadernos)
   ├─ lib/
   │  ├─ util.ts                  dinheiro (centavos ↔ texto), datas, formas de pagamento, 44 cores com nome
   │  ├─ pix.ts                   QR do Pix (base64), código copia e cola, CRC, iPhone × Android
   │  ├─ changelog.ts             lista do Menu › Atualizações
   │  ├─ updateState.ts           situação da versão (selo do cabeçalho)
   │  ├─ applyUpdate.ts           botão Atualizar: ativa a versão nova e recarrega sempre
   │  └─ pendingParts.ts          partes da mensagem que faltam mandar (“Mandar parte 2”)
   ├─ services/                   REGRAS (sem tela): tudo testável
   │  ├─ days.ts                  iniciar/desfazer/encerrar/reabrir dia, encerrar sozinho na virada, movimentos de estoque, desfazer, dias do caderno, conserto do cadastro antigo
   │  ├─ sales.ts                 vendas, pagamento por peça, cancelar, corrigir valor, trocar peça, reservas, Pix conferido
   │  ├─ cash.ts                  lançamentos de caixa, diária automática, vendas do caderno, “ontem”, contado
   │  ├─ summary.ts               contas: caixa de todos os dias, resumo do dia, linhas da conta, estoque com repor (`restockOf`), estoque de agora
   │  ├─ catalog.ts               grupos e cores (criar, renomear, ordenar, arquivar, excluir, à venda/guardada, repor/mínimo)
   │  ├─ report.ts                relatório WhatsApp e caderno, tamanho, partes, copiar + abrir o WhatsApp, compartilhar
   │  ├─ backup.ts                backup/restauração, texto comprimido em partes, recomeçar
   │  ├─ sync.ts                  juntar celulares (mesclar dois bancos) e lista de apagados
   │  ├─ storage.ts               armazenamento permanente e teste de gravação
   │  ├─ diagnostics.ts           verificação de consistência
   │  ├─ csv.ts                   planilhas
   │  ├─ settings.ts              configurações e valores padrão
   │  └─ audit.ts                 registro de auditoria
   ├─ components/
   │  ├─ ui.tsx                   botões, cartões, janelas (Sheet), tooltips com exemplo, escolha de cor, avisos
   │  ├─ day.tsx                  barra de dias, iniciar o dia, avisos do dia
   │  ├─ StockFlow.tsx            “começou X → agora Y” (mesmo visual em todo lugar)
   │  └─ Pix.tsx                  QR do Pix e janela “Meu Pix”
   ├─ screens/                    uma por tela/janela (Home, Sell, Stock, Cash, CloseDay, History, Catalog, Settings,
   │                              Backup, Transfer, Sync)
   └─ __tests__/                  testes (ver seção 10)
```

**Princípio**: **regras em `services/`**, telas em `screens/`. A tela só chama o serviço. Assim dá para testar as contas
sem tela, e a mesma regra vale em todo lugar.

---

## 7. Banco de dados

IndexedDB (via Dexie), nome `dia-dia`, versão 2. Índices:

| Tabela | Índices | Para quê |
|---|---|---|
| `groups` | id, displayOrder, active | grupos (Plomo, Lila…) |
| `variants` | id, groupId, displayOrder, active | cores de cada grupo (`forSale`, `idealStock` = meta, `minimumStock`, `restockOff`, `startQuantity`, `color`, `archivedAt`, `deletedAt`) |
| `categories` | id, displayOrder | etiquetas |
| `dailyRecords` | id, **&date** (único), status | um registro por dia (aberto/encerrado, `autoClosedAt`, `reopenedAt`) |
| `dailyStockItems` | id, dailyRecordId, variantId, **&[dailyRecordId+variantId]** | estoque de cada cor em cada dia |
| `stockMovements` | id, dailyRecordId, variantId, type, createdAt, orderId | todo movimento de estoque |
| `orders` | id, dailyRecordId, createdAt | vendas (`payments`, `payByLine`, `pixConfirmedAt/Cents`) |
| `sales` | id, orderId, dailyRecordId, variantId, createdAt | peças de cada venda (preço, forma) |
| `reservations` | id, dailyRecordId, variantId, status | reservas |
| `cashRecords` | id, **&dailyRecordId** | caixa do dia (ontem digitado, contado, `dailyPayDone`) |
| `cashMovements` | id, dailyRecordId, type, relatedOrderId, createdAt | todo lançamento de caixa (`venda`, `entrada`, `dar`, `despesa`, `retirada`, `pagamento`, `estorno`) |
| `settings` | id, **&key** | configurações (inclusive as chaves do relatório: `reportShowStock`, `reportStockStartEnd`, `reportRestockDetail`, `reportTotals`, `reportDividers`, `reportSplit`), marcas (`seedDone`, `migrCadastroV1`), lista de apagados (`tombstones`) |
| `auditLogs` | id, entityType, entityId, createdAt | auditoria |
| `safety` | id | cópia de segurança para “Voltar como estava” |

Campos novos são opcionais (não exigem migração). Mudança de índice exige **nova versão** em `db.ts`.

---

## 8. Offline, instalação, atualização e segurança dos dados

- **PWA**: o service worker (Workbox) guarda todos os arquivos do app; abre sem internet.
- **Instalar**: Android (Chrome/Samsung Internet) “Instalar app”; iPhone (Safari) Compartilhar › “Adicionar à Tela de Início”.
- **Atualização**: o app procura versão nova ao abrir, **de hora em hora** e ao **voltar para a tela**. Achou: faixa
  “🆕 Nova versão… Atualizar” e selo no cabeçalho. Tocar ativa a versão nova e **recarrega sempre** (`applyUpdate`: quando a
  nova ativa, quando troca o controle ou, no máximo, em 4 s; sem versão esperando, só recarrega). Antes, no computador, às
  vezes não recarregava (página aberta com Ctrl+Shift+R ou versão baixada por outra aba). **Dados não mudam**. Não recarrega
  sozinho de propósito (não perder um carrinho no meio da venda). Qualquer mudança no app (até um texto) gera aviso;
  mudar só testes/documentação não gera.
- **Dados protegidos**: o app pede `navigator.storage.persist()` (ao abrir e ao iniciar o dia) para o navegador nunca apagar
  os dados; Configurações mostra o status, faz **teste de gravação** e mostra o espaço usado.
- Cuidados: Chrome e Samsung Internet (e o Safari × app da tela de início no iPhone) guardam dados **separados** — usar sempre
  o mesmo ícone; aba anônima apaga ao fechar.
- **Nunca preso no “Carregando”**: se o banco não abrir em 8 s, aparece a tela de recuperação; erro de tela vira aviso com
  “Tentar de novo”; arquivo antigo após atualização recarrega uma vez sozinho.
- **Privacidade**: os dados ficam só no celular. Atenção: o repositório e o site são **públicos**, então o **código Pix**
  (chave e nome) fica visível no código do app (QR estático só serve para receber).

---

## 9. Publicação (deploy)

`.github/workflows/deploy.yml`, a cada push na `main`:
1. `actions/checkout@v7`, `configure-pages@v6`, `setup-node@v7` (**Node 24**, mesma versão do PC), cache do npm;
2. `npm ci` → `npm test` (**se um teste falhar, não publica**) → `npm run build` (inclui checagem de tipos);
3. `upload-pages-artifact@v5` → `deploy-pages@v5`.

Ambiente fixo `ubuntu-24.04`, tempo máximo 20 min (build) / 10 min (publicação).
Uma vez só: **Settings › Pages › Source: GitHub Actions**.

```bash
git add -A
git commit -m "o que mudou"
git push
```
Acompanhe em **Actions**; em ~2 min está no ar. Ao publicar algo que a usuária deve saber, acrescente uma entrada no topo de
`src/lib/changelog.ts`.

---

## 10. Testes: o que existe e como rodar

### Comandos
```bash
npm test                 # suíte completa (~75 s, um arquivo por vez)
npx vitest run src/__tests__/app.test.ts     # um arquivo
npx tsc --noEmit -p .    # só checar os tipos
npm run build            # tipos + build de produção
```

### Relógio fixo (testes não dependem da data)
`src/__tests__/setup.ts` faz os testes rodarem como se fosse **01/11/2026 12:00** (o tempo continua andando).
Para provar que nada depende do calendário, rode em outras datas:
```bash
HOJE=2026-12-31 npm test
HOJE=2028-07-15 npm test
```
(PowerShell: `$env:HOJE='2026-12-31'; npm test`)

O setup também: banco em memória (`fake-indexeddb`), espera de até 10 s pelas telas (GitHub é lento), simula download de arquivo no jsdom.
Configuração (`vite.config.ts`): 60 s por teste, **um arquivo por vez** (os testes pesados não atrasam os de tela).

### Arquivos de teste (165 testes + 2 com dados reais = 167)

| Arquivo | Testes | O que garante |
|---|---|---|
| `app.test.ts` | 36 | regras principais: iniciar dia, estoque, vendas, reservas, caixa, diária, dados iniciais (números dos cadernos), relatório exato do WhatsApp, recomeçar |
| `quebrar.test.ts` | 33 | tentativas de quebrar: valores absurdos, toque repetido, dia encerrado, venda forjada, backup com lixo, CSV malicioso, voltar atrás |
| `cadastro-relatorio.test.ts` | 14 + 1 real | cadastro não é “entrou”, meta não mexe no estoque, arquivadas fora do relatório, excluir, repor/mínimo, estoque na mensagem, reservadas, totais, divisão, conserto dos dados antigos, copiar inteira; **dados reais** |
| `novidades.test.tsx` | 11 | armazenamento permanente, Atualizações, selo da versão, carrinho ao recomeçar, juntar pela tela, chaves do repor e da mensagem, tamanho e recado do botão |
| `pix.test.tsx` | 9 | código Pix válido (CRC), base64 é PNG 480×480, iPhone × Android, QR na venda, botão Mostrar Pix, ✅ Caiu, Pix mudou |
| `abas.test.tsx` | 9 | cada aba pela tela: Início (inclusive Enviar = copiar + abrir), Vender, Estoque, Caixa, Menu, pagamento por peça, diária automática |
| `extremo.test.ts` | 9 | **macaco**: milhares de ações aleatórias; tempestade (operações ao mesmo tempo); escala (meses de uso); relógio errado |
| `partes.test.tsx` | 7 | dividir em partes (todas as linhas, na ordem, título repetido), copiar + abrir no celular e no computador, não abrir se não copiou, “Mandar parte 2” pela tela |
| `conta-estoque.test.ts` | 5 + 1 real | **a conta do estoque na mensagem**: começou 15, vendeu 3 → saiu 3, terminou 12, repor 3, totais −3; cancelar, entrada, ajuste, reserva, dia seguinte; **dados reais** cor por cor |
| `virada.test.tsx` | 6 | dia de ontem encerra sozinho (ao abrir e à meia-noite com o app aberto), reaberto não fecha, “Bom dia” com último backup |
| `atualizar.test.ts` | 5 | botão Atualizar sempre recarrega (página sem controle, outra aba, sem eventos, uma vez só); tamanho da mensagem |
| `juntar.test.ts` | 4 | dois celulares: exemplo 3+2=5, caderno/diária sem duplicar, cancelada no outro, **teste maluco** de rodadas aleatórias |
| `macaco-tela.test.tsx` | 4 | toques aleatórios na tela sem quebrar (4 sorteios) |
| `recomecar.test.ts` | 3 | voltar aos iniciais / do zero, continua vazio ao reabrir, backtest de ciclos com “voltar como estava” |
| `dez-dias.test.ts` | 2 | 10 dias simulados contra um modelo independente (estoque e caixa batem dia a dia) |
| `pagamento-misto.test.ts` | 2 | pagamento por peça + backtest (vendas, correções, cancelamentos, trocas) batendo por forma |
| `troca.test.ts` | 2 | trocar peça vendida + backtest (estoque cor por cor) |
| `tela.test.tsx` | 2 | um dia completo pela tela (iniciar, vender, lançar, encerrar, relatório copiado) |
| `rolagem.test.ts` | 2 | impede `overflow` em html/body (travava a rolagem no Android) e altura das janelas |

### Testar com os dados reais do celular
Exporte em Menu › Passar para outro celular › Enviar tudo e rode (o arquivo **não** vai para o repositório):
```bash
DADOS_REAIS="C:/caminho/dia-dia_passar-para-outro-celular.json" npm test
```
Os testes restauram os dados num banco de teste (nunca no celular) e conferem: relatório sem arquivadas, conserto dos dados
antigos, excluir as arquivadas sem mudar estoque nem dinheiro, esgotados do Início = da mensagem, totais, tamanho da mensagem
e quanto cada chave pesa, e **a conta do estoque cor por cor** (começou − saiu ± movimentos = terminou).
Para rodar em outra data junto: `HOJE=2027-03-01 DADOS_REAIS=... npm test`.

### Testes “malucos” em tamanho grande
Os backtests rodam em tamanho menor na suíte normal (para o GitHub ser rápido). Para rodar pesado:

| Variável | Teste | Padrão | Pesado |
|---|---|---|---|
| `MACACO_ACOES` | ações aleatórias por sorteio (5 sorteios) | 1500 | 4000 (= 20.000) |
| `MACACO_TELA` | toques aleatórios na tela por sorteio | 400 | 1000 |
| `TROCAS` | passos do backtest de troca | 400 | 10000 |
| `MISTO` | operações de pagamento misto | 300 | 5000 |
| `RECOMECAR` | ciclos de recomeçar | 80 | 1000 |
| `JUNTAR` | rodadas de dois celulares | 12 | 150 |

```bash
MACACO_ACOES=4000 TROCAS=5000 MISTO=3000 JUNTAR=40 RECOMECAR=500 npx vitest run src/__tests__/extremo.test.ts src/__tests__/troca.test.ts src/__tests__/pagamento-misto.test.ts src/__tests__/juntar.test.ts src/__tests__/recomecar.test.ts
```
Resultados já obtidos: 20.000 ações sem erro; 10.000 trocas; 5.000 pagamentos mistos; 150 rodadas de dois celulares
(5.129 ações) com os dois sempre idênticos; 1.000 ciclos de recomeçar.

### O que cada teste “maluco” confere
- nunca erro técnico (só recusas com mensagem amigável);
- **diagnóstico sem erro** (estoque = começou + movimentos; venda = peças = caixa);
- comparação com um **modelo independente** (o teste calcula sozinho o que deveria dar e compara com o app);
- juntar: os dois celulares mostram **exatamente** o mesmo caixa, estoque, vendas e reservas; importar de novo não muda nada.

---

## 11. Como testar à mão (no computador e no celular)

**No computador**
```bash
npm install
npm run dev              # http://localhost:5173 (também abre no celular pela rede: http://IP-do-PC:5173)
npm run build && npm run preview   # versão de produção com service worker: http://localhost:4173
```
No Chrome: F12 › ícone de celular (modo dispositivo) para simular tamanhos (320, 360, 390, 412, 430).
Para testar sem mexer nos dados de uso, abra o app em **outra porta** (`npm run preview -- --port 4175`): cada endereço tem
o próprio banco no navegador.
Para recomeçar limpo: Configurações › Recomeçar, ou F12 › Application › Storage › Clear site data.

**No celular (roteiro rápido)**
1. Instalar na tela inicial; Configurações › Dados guardados → deve ficar 🛡️ Protegido (senão “Proteger agora”).
2. Iniciar o dia → conferir a diária no Caixa.
3. Vender 2 peças (uma no Pix, outra no dinheiro) → QR aparece → confirmar → “✅ Caiu”.
4. Caixa: conferir a conta (ontem, hoje linha por linha, total, na mão).
5. Trocar uma peça, corrigir um valor, cancelar uma venda.
6. Encerrar o dia: digitar o contado, ver “faltam/sobram/bateu” na mensagem, ver o 📏 tamanho, tocar em **Enviar no WhatsApp**
   → o WhatsApp abre → escolher a conversa → **colar**.
7. Conferir na mensagem uma cor que vendeu: “começou X → terminou Y” e os totais iguais ao Início.
8. Rolar todas as telas e janelas para cima e para baixo; testar com letra grande do celular.
9. Dois celulares: Juntar nos dois sentidos e conferir que os números ficam iguais.

---

## 12. Decisões importantes e problemas já resolvidos

| Situação | Causa | Solução |
|---|---|---|
| Tela “grudada” no Redmi (Android) | `overflow-x: hidden` em html e body cria segunda área de rolagem | só `overflow-x: clip` no `#root`; teste `rolagem.test.ts` impede voltar |
| Tela arrastando para o lado / menu sem rolar com **letra grande** | grade de 4 colunas e janelas sem `min-h-0` | 2 colunas, quebra de linha em vez de “…”, `min-h-0`, altura `vh` + `dvh` |
| Teclado abrindo sozinho ao fechar venda | foco automático no preço | removido |
| “2” no carrinho depois de zerar tudo | o reset não recarregava (função sem retorno) | recarrega de verdade + carrinho se limpa sozinho de peças inexistentes |
| Deploy falhando no GitHub | testes de tela esperavam só 1 s; arquivos rodando juntos; datas fixas | espera de 10 s, um arquivo por vez, relógio fixo nos testes |
| Diária em dia antigo esquecido aberto | conferia qualquer dia aberto | só o dia de hoje |
| Pix conferido e depois corrigido | não guardava o valor conferido | guarda o valor; mostra “Pix mudou” |
| Dois celulares com caixas separados | dados ficam em cada aparelho | Juntar celulares (mescla segura, testada com milhares de ações) |
| QR do Pix de foto de tela | foto pode não escanear bem | QR regenerado limpo a partir do código conferido pelo CRC |
| Cadernos sem a cor vendida | não dá para inventar a peça | vendas no caixa sem peça, sem mexer no estoque |
| “Invalid argument to Table.get()” | cor salva sem grupo | exige grupo; sem grupos, cria o grupo ali mesmo; erros técnicos viram mensagem em português |
| “Entrou no estoque: 664” | a quantidade do cadastro era lançada como entrada | cadastro = estoque inicial; dados antigos convertidos sozinhos (`migrateCadastroEntries`) |
| Meta 15 → 18 tratada como peça a mais | meta e estoque misturados | “No estoque hoje” (ajuste) separado da “Meta” (só repor) |
| Cores arquivadas na mensagem | o relatório não filtrava | arquivadas/excluídas fora de Entrou, Repor, Estoque e totais |
| “Cor Azul: 2 🚫 esgotado” | esgotado olhava o livre (estoque − reservadas) | esgotado = 0 peças; reservadas aparecem como “🔒 N reservadas” |
| Início com 9 esgotados, mensagem com 1 | duas regras diferentes | uma regra só (0 peças) e “Esgotados (N)” lista todas; teste compara os dois |
| WhatsApp abria uma página e não chegava na conversa (iPhone) | link `wa.me` com o texto | copiar + abrir o app; a pessoa cola |
| “Atualizar” sem efeito no computador | o recarregar dependia de um evento que nem sempre vem | `applyUpdate` recarrega sempre (testado no caso que travava) |
| Testes de tela falhando às vezes | `await import()` dentro de transação do banco fechava a transação antes da hora | import normal no topo do arquivo |

---

## 13. Dados iniciais oficiais

- **Estoque**: lista oficial do **começo de 31/10/2026** — 8 grupos, 51 cores, **238 peças**. À venda: Azul, Plomo, Lila
  (e Broche Rey quando cadastrado); os outros guardados.
- **30/10 (sexta, encerrado)**: 9 vendas, 20 peças — Dinheiro 645 · Crédito 753,75 · Débito 76,05.
- **31/10 (sábado)**: 11 vendas em dinheiro = 935 (13 peças); Chico 50; diárias de 30/10 e 31/10 (150 cada).
  Ontem 645 + 885 = 1.530 − 300 = **1.230 na mão**; total 2.059,80 (829,80 no banco).
- O estoque **não** desconta as vendas dos cadernos (não há cor anotada) — decisão combinada.
- Carregados ao iniciar o primeiro dia (Configurações › Recomeçar › Voltar aos dados iniciais para refazer).

---

## 14. Limites conhecidos e ideias futuras

- **Ler notificações do banco**: impossível em app de navegador; só com app Android nativo (nunca no iPhone).
- **Juntar celulares** funciona melhor ao fim do dia, antes de iniciar o próximo; a mesma venda mexida nos dois lados antes
  de juntar fica com a versão de mais mudanças.
- Nome e ícone do app instalado demoram a atualizar (Android dias; iPhone só reinstalando).
- Ideias: backup automático ao encerrar o dia; QR do Pix já com o valor da venda (exige gerador de QR no app);
  otimizar o cálculo do caixa depois de anos de uso (hoje ~12 ms com 6 meses).

---

## 15. Como fazer mudanças sem quebrar nada

1. Regra nova → em `src/services/` (nunca só na tela) + teste em `src/__tests__/`.
2. Tela nova → em `src/screens/`, usando os componentes de `src/components/ui.tsx`; pensar no celular (letra grande, 320 px,
   nada de `overflow` em html/body).
3. Valor de dinheiro → sempre centavos inteiros; mostrar com `money()`.
4. Campo novo no banco → opcional em `types.ts`; índice novo → nova versão em `db.ts`. **Nunca** `await import()` (nem
   outro `await` que não seja do banco) dentro de `db.transaction`: fecha a transação no meio.
5. Rodar `npm test` (e, se mexeu em data, `HOJE=2027-03-01 npm test`; se tiver o arquivo, `DADOS_REAIS=... npm test`) e `npm run build`.
6. Algo que a usuária deve saber → entrada nova no topo de `src/lib/changelog.ts`.
7. `git add -A && git commit -m "..." && git push` → o GitHub testa e publica.
