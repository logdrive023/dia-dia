/**
 * O que mudou no app (Menu › Atualizações). A primeira é a mais nova.
 * Ao publicar uma versão: acrescente uma entrada no topo com um id novo.
 */
export interface ChangeEntry { id: string; date: string; title: string; items: [string, string][] }

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-11-03a', date: '03/11/2026', title: 'Histórico de movimentações, importação e cadastro mais claro',
    items: [
      ['📜', 'Novo: Histórico de movimentações (Menu e Configurações). A vida de cada peça desde o cadastro: começou, entrou, vendeu, reservou, ajustou, quem fez e quanto tem agora'],
      ['🔎', 'Filtros no histórico: data, grupo, peça, tipo, quem fez e origem (você ou o sistema)'],
      ['⚠️', 'Se a conta de uma peça não fecha, aparece “Divergência não explicada” (o app não inventa ajuste)'],
      ['↩️', 'Desfazer pelo histórico mostra antes → depois e pede confirmação; o registro original continua lá'],
      ['📋', 'Novo: Importar mercadoria. Cole uma lista (grupo, produto, tamanho, quantidade), veja a prévia antes/entrada/depois e confirme'],
      ['🧾', 'Cada importação fica guardada com o texto colado e dá para desfazer sem mexer nas vendas feitas depois'],
      ['📦', 'Entrada de estoque: escolha “mercadoria nova” ou “reposição” (o padrão fica em Configurações)'],
      ['✏️', '“Definir” ou “No estoque hoje” para mais: o app pergunta se chegou mercadoria ou se foi correção da contagem'],
      ['🎯', 'Estoque ideal mais claro: “Usar estoque ideal?” em cada peça, separado da quantidade real, com prévia antes de mudar'],
      ['📏', 'Tamanhos (P, M, G…) e tipos de produto (Vestido, Blusa…), opcionais e editáveis em Configurações'],
      ['🎨', 'Cores separadas em neutras, quentes e frias; dá para criar cores e ícones novos'],
      ['🛍️', '“Novo produto” direto na aba Vender: entra no cadastro, no estoque de hoje e já à venda'],
      ['🔒', 'Peça toda reservada aparece como “reservadas” (não mais “sem peça”); no Estoque: físico, reservado e disponível'],
      ['📌', 'Reservas ativas: dá para recolher a lista e filtrar por grupo, peça ou cliente'],
      ['🙋', 'Configurações › Seu nome: aparece em cada registro feito por você'],
      ['🐛', 'Corrigido: cadastrar com quantidade olhando outro dia perdia a quantidade (agora entra sempre no dia de hoje)'],
      ['🗂️', 'Excluir uma cor não apaga mais o histórico dela'],
      ['⌨️', 'O teclado não abre mais sozinho na tela de entrada/saída do estoque'],
    ],
  },
  {
    id: '2026-11-02a', date: '02/11/2026', title: 'Cadastro e relatório corrigidos',
    items: [
      ['🗑️', 'Cor arquivada agora tem “Excluir” direto na lista (se já teve vendas, as vendas antigas ficam no histórico)'],
      ['📦', 'A quantidade do cadastro é o estoque com que a cor começa o dia — não aparece mais em “Entrou no estoque”'],
      ['🎯', 'Na cor: “No estoque hoje” (corrige a quantidade) separado da “Meta para o repor” (não mexe no estoque)'],
      ['🚫', 'Cores arquivadas não entram mais no relatório do WhatsApp (Entrou, Repor e total do estoque)'],
      ['🔧', 'Dados antigos consertados sozinhos ao abrir: o “Entrou” do cadastro virou estoque inicial (o estoque final não muda)'],
      ['📦', 'Mensagem do WhatsApp mostra o estoque de agora, cor por cor, com “⚠️ repor” ou “🚫 esgotado” ao lado (chave “Mostrar o estoque” no Encerrar o dia)'],
      ['🔁', 'Em cada produto: “Precisa repor?” (sim/não) e “Tem estoque mínimo?” — só aparece para repor quando chega no mínimo'],
      ['✂️', '“Precisa repor” no WhatsApp mais simples: só a cor e o número (ex.: “Cor Blanco: 1”)'],
      ['🔢', 'Chave “Repor com tem X de Y” no Encerrar o dia: liga para mostrar “(tem 14 de 15)” ao lado do número'],
      ['🌅', '“Estoque agora” mostra cada cor com “começou 3 → terminou 2” (chave para ligar/desligar)'],
      ['🔒', 'Peça reservada não aparece mais como “esgotado”: mostra “🔒 2 reservadas”. Esgotado é só quando acaba'],
      ['🚫', 'Esgotados: o número do Início e o da mensagem agora são sempre iguais (esgotado = 0 peças)'],
      ['🌙', 'Virou a data: o dia de ontem que ficou aberto encerra sozinho (reaberto de propósito não fecha)'],
      ['💾', 'No “Bom dia”: mostra o último backup (data e hora) e pergunta se quer fazer outro agora'],
      ['🧾', 'Mensagem do WhatsApp com “Totais” no final: estoque, repor e começo → final do dia (chave)'],
      ['➖', 'Linha de divisão entre os grupos na mensagem (chave), simples para a mensagem ficar menor'],
      ['📋', '“Enviar no WhatsApp” agora copia a mensagem e abre o WhatsApp: é só escolher a conversa e colar (antes abria uma página do WhatsApp que não chegava na conversa)'],
      ['📏', 'Encerrar o dia mostra o tamanho da mensagem: atual / máximo (65.536 letras de uma mensagem do WhatsApp)'],
      ['🔄', 'Botão “Atualizar” sempre atualiza (antes, no computador, às vezes não recarregava)'],
      ['✂️', 'Se um dia passar do máximo, vai em partes (chave): copia a parte 1, volta para o app e toca em “Mandar parte 2”. Mostra antes como vai ficar (e o botão continua lá mesmo se o celular fechar o app)'],
      ['🌙', 'Venda no meio quando passa da meia-noite: o app espera a venda terminar (ela fica no dia em que começou) e só depois vira o dia'],
      ['📂', 'Dia antigo reaberto e esquecido aberto: aviso no Início com “Encerrar”'],
      ['📏', 'Estoque mínimo não pode ser maior que a meta (antes aparecia “repor 1” sem precisar)'],
      ['📤', '“Outros apps” sem o compartilhar do aparelho: copia o texto (não abre mais a página antiga do WhatsApp)'],
      ['💾', 'Gerar o código do “Juntar com outro celular” conta como backup'],
      ['🔄', 'Juntar com outro celular: dia encerrado/reaberto e as chaves da mensagem seguem o que foi feito por último'],
      ['📅', 'Calendário (📅) abre no celular de novo: tocar no ícone abre o calendário do aparelho'],
      ['⚡', 'Atualizar o app baixa metade (só a parte do app; React e o banco ficam guardados) e a tela de abertura explica quando está baixando pela internet'],
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
