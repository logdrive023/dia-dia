# Dia a Dia — estoque, vendas e caixa (PWA)

Caderno digital do dia: estoque por data, vendas com várias peças por pessoa, Dinheiro/Pix/Cartão,
"dei dinheiro", saldo "Ontem + hoje", encerramento do dia com relatório para WhatsApp e no formato do caderno.
Tudo fica no aparelho (IndexedDB), sem login nem servidor.

## Rodar

```bash
npm install
npm run dev        # desenvolvimento (http://localhost:5173, também na rede local)
npm test           # testes automáticos (carga inicial, vendas, caixa, backup...)
npm run build      # gera a pasta dist/ para publicar
npm run preview    # serve o build (com Service Worker) em http://localhost:4173
```

## Publicar no GitHub Pages

O workflow `.github/workflows/deploy.yml` testa, gera o build e publica a cada push na `main`.

1. Crie o repositório `dia-dia` em https://github.com/logdrive023 e suba esta pasta:

   ```bash
   git init
   git add .
   git commit -m "Dia a Dia"
   git branch -M main
   git remote add origin https://github.com/logdrive023/dia-dia.git
   git push -u origin main
   ```

2. No GitHub: **Settings › Pages › Source: GitHub Actions** (só na primeira vez).
3. Acompanhe em **Actions**. Quando ficar verde, o app está em
   **https://logdrive023.github.io/dia-dia/**
4. No celular, abra o link e use "Adicionar à tela inicial" (Android: Chrome; iPhone: Safari › Compartilhar).

Para atualizar depois: `git add . && git commit -m "..." && git push` — publica sozinho.
Os dados da usuária ficam só no celular; o GitHub guarda apenas o app.

## Fluxo do dia

1. **Início › ▶ Iniciar o dia** — copia o estoque final e o saldo do último dia.
2. **Vender** — toque em “+” nas peças, “Fechar venda”, digite o preço (os preços usados aparecem como atalho), escolha 💵 Dinheiro / ⚡ Pix / 💳 Cartão.
3. **Caixa** — “Dei dinheiro” (ex.: Chico 50), Entrada, Despesa, Retirada (ex.: −300 do acumulado).
4. **Início › 🌙 Encerrar o dia** — resumo (vendeu, entrou, precisa repor), relatório WhatsApp ou Caderno, compartilhar e travar o dia.

Conta do caixa (igual ao caderno):
`vendas + entradas − dei − despesas = hoje` · `Ontem + hoje = subtotal − retiradas = saldo`.

## Estrutura

- `src/db` — banco Dexie (tabelas, índices) e carga inicial editável (8 grupos, 51 variações, 238 peças).
- `src/services` — regras: catálogo, dias, vendas/reservas, caixa, resumo/comparação, relatório, backup (JSON e texto `ESTOQUE_BACKUP_V1`), CSV.
- `src/screens` — telas. `src/__tests__` — testes.
