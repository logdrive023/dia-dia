/**
 * O que mudou no app (Menu › Atualizações). A primeira é a mais nova.
 * Ao publicar uma versão: acrescente uma entrada no topo com um id novo.
 */
export interface ChangeEntry { id: string; date: string; title: string; items: [string, string][] }

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-11-02a', date: '02/11/2026', title: 'Cadastro e relatório corrigidos',
    items: [
      ['🗑️', 'Cor arquivada agora tem “Excluir” direto na lista (se já teve vendas, as vendas antigas ficam no histórico)'],
      ['📦', 'A quantidade do cadastro é o estoque com que a cor começa o dia — não aparece mais em “Entrou no estoque”'],
      ['🎯', 'Na cor: “No estoque hoje” (corrige a quantidade) separado da “Meta para o repor” (não mexe no estoque)'],
      ['🚫', 'Cores arquivadas não entram mais no relatório do WhatsApp (Entrou, Repor e total do estoque)'],
      ['🔧', 'Dados antigos consertados sozinhos ao abrir: o “Entrou” do cadastro virou estoque inicial (o estoque final não muda)'],
      ['💬', 'Mensagem muito grande não trava mais o WhatsApp: vai pelo compartilhar do celular ou é copiada'],
      ['📦', 'Mensagem do WhatsApp mostra o estoque de agora, cor por cor, com “⚠️ repor” ou “🚫 esgotado” ao lado (chave “Mostrar o estoque” no Encerrar o dia)'],
      ['🔁', 'Em cada produto: “Precisa repor?” (sim/não) e “Tem estoque mínimo?” — só aparece para repor quando chega no mínimo'],
      ['✂️', '“Precisa repor” no WhatsApp mais simples: só a cor e o número (ex.: “Cor Blanco: 1”)'],
      ['🔢', 'Chave “Repor com tem X de Y” no Encerrar o dia: liga para mostrar “(tem 14 de 15)” ao lado do número'],
    ],
  },
  {
    id: '2026-11-01b', date: '01/11/2026', title: 'Dois celulares e mais segurança',
    items: [
      ['🔄', 'Juntar celulares: um celular gera um código com tudo, o outro importa e as vendas se somam (Menu › Juntar com outro celular)'],
      ['🛡️', 'O app pede ao navegador para nunca apagar os dados e mostra em Configurações se está protegido'],
      ['🆕', 'O app procura versão nova sozinho (de hora em hora e quando volta para a tela)'],
      ['💼', 'A diária entra sozinha só no dia de hoje (dia antigo esquecido aberto não recebe mais)'],
      ['⚡', 'Pix conferido e depois com valor corrigido: aparece “Pix mudou” para conferir de novo'],
      ['🆕', 'Esta tela de Atualizações'],
      ['✓', 'Selo no topo: “✓ Atualizado” na última versão, “🆕 Atualizar” quando sai uma nova'],
      ['⌨️', 'Fechar venda não abre mais o teclado sozinho'],
      ['🧹', 'Recomeçar com uma venda aberta: o carrinho some junto (antes ficava o número na tela)'],
      ['🎨', 'Nova cor num app sem grupos: pede para criar o grupo ali mesmo (antes dava erro “Invalid argument”)'],
      ['📶', 'Procura versão nova no máximo a cada 10 minutos (quase nada de internet)'],
    ],
  },
  {
    id: '2026-11-01a', date: '01/11/2026', title: 'Pix na tela',
    items: [
      ['⚡', 'QR code do Pix aparece na venda ao escolher Pix, com o valor'],
      ['⚡', 'Botão “Mostrar Pix” no Início e no Menu, sem precisar de venda'],
      ['📱', 'O app sabe se é iPhone ou Android (Neon) e diz onde conferir o Pix'],
      ['✅', 'Depois da venda no Pix: “já caiu?” e marcar no Caixa quando cair'],
    ],
  },
  {
    id: '2026-10-31c', date: '31/10/2026', title: 'Caixa em forma de conta',
    items: [
      ['🧮', 'Caixa: ontem separado, hoje linha por linha (vendas por forma, saídas) e o total no fim'],
      ['💼', 'Diária de 150 por dia, lançada sozinha ao iniciar o dia (Configurações › Sua diária)'],
      ['🔎', 'Dinheiro contado aparece na mensagem na hora: “faltam”, “sobram” ou “bateu”'],
    ],
  },
  {
    id: '2026-10-31b', date: '31/10/2026', title: 'Vendas',
    items: [
      ['🔀', 'Cada peça pode ser paga de um jeito (uma no Pix, outra no dinheiro)'],
      ['🔄', 'Trocar a peça de uma venda já feita (a errada volta ao estoque, a certa sai)'],
      ['🎨', '44 cores com nome'],
      ['🔄', 'Configurações: voltar aos dados iniciais ou recomeçar do zero'],
    ],
  },
  {
    id: '2026-10-31a', date: '31/10/2026', title: 'Primeira versão',
    items: [
      ['📦', 'Estoque do dia, vender, reservar, caixa e relatório no WhatsApp'],
      ['📒', 'Dados iniciais: lista oficial do estoque e cadernos de 30/10 e 31/10'],
    ],
  },
];

export const LATEST_CHANGE = CHANGELOG[0].id;
