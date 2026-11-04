/**
 * O que mudou no app (Menu › Atualizações). A primeira é a mais nova.
 * Ao publicar uma versão: acrescente uma entrada no topo com um id novo.
 */
/** `version`: o número que aparece em Sobre (a entrada mais nova é a versão do app). Nova entrada = próximo número. */
/** Cada item: [ícone, texto] ou [ícone, texto, 'bug' | 'melhoria'] (sem o terceiro, o app decide pelo texto). */
export type ChangeItem = [string, string] | [string, string, ChangeKind];
export type ChangeKind = 'bug' | 'melhoria';
export interface ChangeEntry { id: string; version: string; date: string; title: string; items: ChangeItem[] }

/**
 * Correção ou melhoria? Correção = algo que estava errado: ícone 🐛, “Corrigido…” ou “… não … mais …”
 * (ex.: “O teclado não abre mais sozinho”). O resto é melhoria (coisa nova ou mais clara).
 */
export function changeKind(item: ChangeItem): ChangeKind {
  if (item[2]) return item[2];
  const [icon, text] = item;
  return icon === '🐛' || /corrigid/i.test(text) || /\bnão\b.*\bmais\b/i.test(text) ? 'bug' : 'melhoria';
}

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-11-04b', version: '1.8', date: '04/11/2026', title: 'Condicional, fiado, vale, contagem da loja e lucro',
    items: [
      ['👜', 'Novo: Condicional (a cliente levou para provar em casa). Na reserva, escolha “Levou para provar” e até quando. A peça sai da venda, mas continua sendo da loja. Depois: “Ficou” vira venda (dá para escolher quantas ficou) e “Voltou” volta à venda'],
      ['⏰', 'Condicional que passou do prazo aparece em vermelho na lista de reservas'],
      ['📒', 'Novo: Fiado (sim ou não). Ao fechar a venda, ligue “Fiado”: a peça sai, nada entra no caixa. Quando ela pagar, toque em “Pagou” (Caixa › Fiado a receber): o valor entra no caixa do dia'],
      ['🎟️', 'Novo: Vale. Ao devolver ou cancelar, escolha “Devolver o dinheiro” ou “Virar vale”. Na próxima compra, digite o nome dela e use o vale. Caixa › Vales mostra quem tem'],
      ['🔢', 'Novo: Contagem da loja (Estoque › Contar a loja, ou Menu). Digite o que contou em cada cor, veja antes → depois e grave tudo de uma vez. Peças em condicional entram sozinhas'],
      ['📊', 'Novo: Mais vendidas, paradas e lucro (Menu), em 7, 30 ou 90 dias'],
      ['💲', 'Novo: Custo da peça (Produtos › cor). Opcional, só para ver o lucro; a venda guarda o custo do dia'],
      ['🧾', 'Novo: Mandar recibo no WhatsApp em cada venda (Caixa)'],
      ['🆕', 'Atualizações separadas em 🐛 Correções e ✨ Melhorias; as versões antigas ficam resumidas (toque para abrir)'],
      ['💰', 'Caixa mostra o dinheiro que entrou ou saiu hoje por venda de outro dia (fiado pago, devolução de venda antiga). Antes entrava na conta, mas não aparecia na lista', 'bug'],
      ['💾', 'Backup antigo (de antes dos vales) continua abrindo normalmente', 'bug'],
    ],
  },
  {
    id: '2026-11-04a', version: '1.7', date: '04/11/2026', title: 'Cor repetida não soma mais peça que não existe',
    items: [
      ['🐛', 'Corrigido: cor arquivada ou excluída que ainda tinha peças aparecia no Estoque igual à cor nova e somava no total (ex.: Poa 7 + Poa 7 = 14, quando só existiam 7)'],
      ['🗄️', 'No Estoque, cor antiga com peças fica separada no fim do grupo, em amarelo, “fora do total”, sem + e −, com o botão Resolver'],
      ['➡️', 'Resolver: passar as peças para a cor nova com o mesmo nome ou zerar (eram repetidas). Fica registrado nas Movimentações'],
      ['⚠️', 'Aviso no topo do Estoque quando alguma cor antiga ainda tem peças'],
      ['🗑️', 'Arquivar ou excluir uma cor que ainda tem peças hoje: o app pergunta o que fazer com elas antes'],
      ['🧮', 'Total do Estoque igual ao do relatório; zerar cor antiga não conta como “saiu” no relatório'],
      ['🏷️', '“Nome repetido neste grupo” aparece quando duas cores ativas têm o mesmo nome'],
      ['📜', 'Histórico e Movimentações mostram “(cor arquivada)” / “(cor excluída)” ao lado do nome'],
      ['🩺', 'Diagnóstico avisa cor antiga com peças e cor repetida no mesmo grupo'],
      ['🐛', 'Corrigido: “Atualizar” (trazer correções de ontem) zerava a cor cadastrada no mesmo dia (ex.: Dorado › Azul 5 → 0). Cor nova do dia também não aparece mais como “começou diferente do fim de ontem”'],
      ['↩️', 'Novo: Devolver peça (Caixa, em cada peça da venda): levou 3, devolveu 1 → a peça volta ao estoque e o valor dela sai do caixa; o resto da venda continua'],
      ['📅', 'Cancelar ou devolver venda de um dia encerrado não precisa mais reabrir o dia: a peça e o dinheiro voltam HOJE e o dia encerrado não muda', 'melhoria'],
      ['🧮', 'Mensagem e Encerrar o dia mostram a conta do estoque inteira: começou − vendeu + voltou + entrou − saiu ± ajustes = terminou. Novas seções “Saiu sem ser venda” e “Ajustes de contagem”'],
      ['🔗', '“Atualizar” leva a correção pela cadeia de dias (corrigiu anteontem → ontem e hoje acompanham)'],
      ['⚠️', 'Reabrir um dia que já tem dias depois avisa que a mudança só chega neles com “Atualizar” (e que cancelar/devolver não precisa reabrir)'],
      ['🛡️', 'Cor antiga não vende, não reserva, não recebe entrada nem troca (regra do app, não só da tela). Troca para cor guardada também é recusada'],
      ['🗄️', 'Cor excluída que ainda tinha peças continua no dia seguinte como cor antiga (fora do total, com Resolver): peça nunca some sem registro'],
      ['💳', 'Corrigir valor de venda com pagamento dividido: as formas (Pix, dinheiro…) acompanham o caixa'],
      ['⏳', 'Reserva com 3 dias ou mais mostra “há N dias · ainda vale?”; reserva sem nome aparece em destaque'],
      ['🏷️', 'Preço sugerido na venda: o último preço da mesma cor (antes era o último do grupo, e um desconto virava padrão)'],
      ['🔄', 'Troca de peça e devolução aparecem com o nome certo nos movimentos e no histórico'],
      ['🙋', 'Lembrete no Início para colocar seu nome (cada registro mostra quem fez)'],
      ['📱', 'Estoque: “Movimentos do dia” não quebra mais em duas linhas no celular'],
      ['🤝', 'Juntar celulares: cor antiga de um celular não se mistura com a cor ativa do mesmo nome no outro'],
    ],
  },
  {
    id: '2026-11-03a', version: '1.6', date: '03/11/2026', title: 'Histórico de movimentações, importação e cadastro mais claro',
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
      ['➕', '“Chegou mais” em cada peça da aba Vender (verde, sempre dá para tocar, até na peça esgotada): põe mais no estoque (mercadoria nova ou reposição) e já fica à venda'],
      ['🔒', 'Peça toda reservada aparece como “reservadas” (não mais “sem peça”); no Estoque: físico, reservado e disponível'],
      ['📌', 'Reservas ativas: dá para recolher a lista e filtrar por grupo, peça ou cliente'],
      ['🙋', 'Configurações › Seu nome: aparece em cada registro feito por você'],
      ['🐛', 'Corrigido: cadastrar com quantidade olhando outro dia perdia a quantidade (agora entra sempre no dia de hoje)'],
      ['🗂️', 'Excluir uma cor não apaga mais o histórico dela'],
      ['⌨️', 'O teclado não abre mais sozinho na tela de entrada/saída do estoque'],
      ['▾', 'Tudo que abre com um toque mostra “ver mais” / “detalhes” (histórico, importações, reservas, texto colado)'],
      ['⬆️', 'Histórico da peça do mais novo para o mais antigo: hoje em cima e, em cada dia, “agora” primeiro'],
      ['🔗', 'Dois registros no mesmo instante ficam na ordem certa no histórico (segue o saldo: 8 → 36 → 40)'],
      ['📱', 'Atualizações: o selo “mais nova” não quebra mais em duas linhas'],
      ['🧾', 'Fechar venda: o nome da peça aparece inteiro e o preço fica embaixo (os preços mais usados quebram linha sem estragar a tela)'],
      ['🔢', 'Sobre mostra a versão certa do app (a mesma das Atualizações)'],
    ],
  },
  {
    id: '2026-11-02a', version: '1.5', date: '02/11/2026', title: 'Cadastro e relatório corrigidos',
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
    id: '2026-11-01b', version: '1.4', date: '01/11/2026', title: 'Dois celulares e mais segurança',
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
    id: '2026-11-01a', version: '1.3', date: '01/11/2026', title: 'Pix na tela',
    items: [
      ['⚡', 'QR code do Pix aparece na venda ao escolher Pix, com o valor'],
      ['⚡', 'Botão “Mostrar Pix” no Início e no Menu, sem precisar de venda'],
      ['📱', 'O app sabe se é iPhone ou Android (Neon) e diz onde conferir o Pix'],
      ['✅', 'Depois da venda no Pix: “já caiu?” e marcar no Caixa quando cair'],
    ],
  },
  {
    id: '2026-10-31c', version: '1.2', date: '31/10/2026', title: 'Caixa em forma de conta',
    items: [
      ['🧮', 'Caixa: ontem separado, hoje linha por linha (vendas por forma, saídas) e o total no fim'],
      ['💼', 'Diária de 150 por dia, lançada sozinha ao iniciar o dia (Configurações › Sua diária)'],
      ['🔎', 'Dinheiro contado aparece na mensagem na hora: “faltam”, “sobram” ou “bateu”'],
    ],
  },
  {
    id: '2026-10-31b', version: '1.1', date: '31/10/2026', title: 'Vendas',
    items: [
      ['🔀', 'Cada peça pode ser paga de um jeito (uma no Pix, outra no dinheiro)'],
      ['🔄', 'Trocar a peça de uma venda já feita (a errada volta ao estoque, a certa sai)'],
      ['🎨', '44 cores com nome'],
      ['🔄', 'Configurações: voltar aos dados iniciais ou recomeçar do zero'],
    ],
  },
  {
    id: '2026-10-31a', version: '1.0', date: '31/10/2026', title: 'Primeira versão',
    items: [
      ['📦', 'Estoque do dia, vender, reservar, caixa e relatório no WhatsApp'],
      ['📒', 'Dados iniciais: lista oficial do estoque e cadernos de 30/10 e 31/10'],
    ],
  },
];

export const LATEST_CHANGE = CHANGELOG[0].id;
/** versão do app = a da entrada mais nova (Sobre e Atualizações) */
export const APP_VERSION = CHANGELOG[0].version;
