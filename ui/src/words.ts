/**
 * Everything this screen says, in both languages.
 *
 * End-user text is the one thing never written in a single language: somebody reading the product in
 * English must not meet a Portuguese sentence here. `en` is typed by `pt-BR`, so a key added to one
 * and forgotten in the other is a compile error rather than a gap somebody finds in production.
 */
const ptBR = {
  search: "Buscar pessoa ou conversa",
  noMatch: "Ninguém com esse nome.",
  startHere: "Procure um colega acima e mande a primeira mensagem.",
  pick: "Escolha com quem falar.",
  group: "Grupo",
  newGroup: "Criar um grupo",
  groupName: "Como se chama o grupo",
  create: "Criar grupo",
  cancel: "Cancelar",
  write: "Escreva uma mensagem",
  send: "Enviar",
  you: "você",
  today: "Hoje",
  yesterday: "Ontem",
  people: "{n} pessoas",
  attach: "Anexar um arquivo",
  uploading: "Enviando o arquivo…",
  attached: "{name} pronto para ir junto",
  removeFile: "Tirar o arquivo",
  download: "Baixar",
  show: "Ver",
  save: "Salvar",
  close: "Fechar",
  loading: "Abrindo…",
  fileFailed: "Não deu para abrir este arquivo.",
  tooBig: "Arquivo grande demais. O limite é 10 MB.",
  sizeLimit: "Arquivos de até {size}.",
  directoryOff: "Este servidor não mostra quem trabalha aqui, então não dá para começar uma conversa nova.",
};

type Catalog = typeof ptBR;

const en: Catalog = {
  search: "Search a person or a conversation",
  noMatch: "Nobody by that name.",
  startHere: "Find a colleague above and send the first message.",
  pick: "Choose who to talk to.",
  group: "Group",
  newGroup: "Create a group",
  groupName: "What the group is called",
  create: "Create group",
  cancel: "Cancel",
  write: "Write a message",
  send: "Send",
  you: "you",
  today: "Today",
  yesterday: "Yesterday",
  people: "{n} people",
  attach: "Attach a file",
  uploading: "Sending the file…",
  attached: "{name} ready to go",
  removeFile: "Remove the file",
  download: "Download",
  show: "View",
  save: "Save",
  close: "Close",
  loading: "Opening…",
  fileFailed: "That file could not be opened.",
  tooBig: "That file is too large. The limit is 10 MB.",
  sizeLimit: "Files up to {size}.",
  directoryOff: "This server does not list who works here, so a new conversation cannot be started.",
};

/**
 * What a refusal means to whoever is reading it.
 *
 * The contract answers codes, never sentences — so this is the only place a code becomes words, and
 * a code nobody mapped falls back to one that is still honest.
 */
const refusalsPtBR = {
  no_caller: "O servidor não soube dizer quem é você. Entre novamente.",
  empty_message: "Escreva algo antes de enviar.",
  message_too_long: "Mensagem longa demais.",
  not_a_participant: "Você não está nesta conversa.",
  no_such_conversation: "Esta conversa não existe mais.",
  no_such_colleague: "Colega não encontrado.",
  empty_name: "Dê um nome ao grupo.",
  not_two_people: "Não dá para abrir uma conversa com você mesmo.",
  invalid_attachment: "Este arquivo não serve: confira o nome, o tipo e o tamanho.",
  attachment_not_ready: "O arquivo ainda não terminou de subir.",
  attachment_not_found: "Este arquivo não está mais aqui.",
  upload_quota_exceeded: "Há arquivos demais esperando envio. Tente de novo em instantes.",
  upload_conflict: "O envio deste arquivo se atrapalhou. Tente de novo.",
  invalid_media_chunk: "O arquivo chegou corrompido. Tente de novo.",
  invalid_upload_offset: "O envio deste arquivo saiu de ordem. Tente de novo.",
  media_size_limit: "Arquivo grande demais. O limite é 10 MB.",
  chat_failed: "Não deu para completar. Tente de novo.",
};

type Refusals = typeof refusalsPtBR;

const refusalsEn: Refusals = {
  no_caller: "The server could not tell who you are. Please sign in again.",
  empty_message: "Write something before sending.",
  message_too_long: "That message is too long.",
  not_a_participant: "You are not in this conversation.",
  no_such_conversation: "This conversation no longer exists.",
  no_such_colleague: "Colleague not found.",
  empty_name: "Give the group a name.",
  not_two_people: "You cannot open a conversation with yourself.",
  invalid_attachment: "That file will not do: check its name, type and size.",
  attachment_not_ready: "The file has not finished uploading.",
  attachment_not_found: "That file is no longer here.",
  upload_quota_exceeded: "Too many files are waiting to be sent. Try again shortly.",
  upload_conflict: "That upload got tangled. Try again.",
  invalid_media_chunk: "The file arrived corrupted. Try again.",
  invalid_upload_offset: "That upload went out of order. Try again.",
  media_size_limit: "That file is too large. The limit is 10 MB.",
  chat_failed: "That did not go through. Try again.",
};

export interface Words extends Catalog {
  refusalFor(code: string | undefined): string | undefined;
}

export function wordsFor(locale: string): Words {
  const english = locale.startsWith("en");
  const catalog = english ? en : ptBR;
  const refusals: Record<string, string> = english ? refusalsEn : refusalsPtBR;
  return {
    ...catalog,
    refusalFor: (code) => (code === undefined ? undefined : (refusals[code] ?? refusals.chat_failed)),
  };
}
