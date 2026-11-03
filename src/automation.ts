import type { NodeField, ProviderAction } from "@creativepetabyte/argus-automation-nodes";

/**
 * The contract through which this plugin offers nodes to the automation engine.
 *
 * The name must end in `.AutomationNodesService`: that suffix is how the engine tells which of a
 * company's contracts are worth asking for a catalogue.
 */
export const AUTOMATION_NODES = "chat.internal.v1.AutomationNodesService";

const group = { id: "chat-internal", label: { "pt-BR": "Chat interno", en: "Internal chat" } };

/**
 * The conversation a node acts on, written once because five nodes need exactly this field.
 *
 * The hint names `{{input.conversationId}}` rather than describing it, because every trigger this
 * plugin declares carries that key — so the obvious thing to type is also the thing that works.
 */
const conversationField: NodeField = {
  key: "conversationId",
  type: "text",
  required: true,
  label: { "pt-BR": "ID da conversa", en: "Conversation ID" },
  hint: {
    "pt-BR": "Aceita referências, como {{input.conversationId}}.",
    en: "Accepts references, such as {{input.conversationId}}.",
  },
};

const membersField: NodeField = {
  key: "memberIds",
  type: "json",
  optional: true,
  label: { "pt-BR": "Participantes (IDs)", en: "Members (IDs)" },
  hint: {
    "pt-BR": "Lista de IDs de pessoas da empresa.",
    en: "A list of company member IDs.",
  },
};

/**
 * What this plugin offers, and what it will not offer however convenient it would be.
 *
 * An automation run has nobody behind it — a message arrived, or another node ran — so the call
 * reaches this plugin with no caller. Most of its methods refuse that, deliberately: `Send`,
 * `Messages`, `OpenDirect`, `MarkRead`, `Conversations`, `Colleagues` and the attachment methods all
 * answer `no_caller`, because an automation must not write, read or mark as read as whoever happened
 * to configure it.
 *
 * Everything below is a method with no human author to forge. Opening, renaming and staffing a room
 * records a membership, not words. Listing the company's conversations and reading one by id answers
 * the COMPANY, which is who the automation runs for. And `SendAsSystem` writes with the author fixed
 * to the system: a method of its own, so that `Send` keeps refusing and its refusal keeps meaning
 * something.
 *
 * What is NOT here, and why: a node that sends as a chosen person (that is `Send`, and it refuses),
 * one that opens a direct conversation (it would have to pick one of the two people as the opener),
 * one that marks a conversation read (read by whom?), and the attachment methods (the bytes belong
 * to a sender). Each of those would list in the editor, get wired up, and then refuse at run time
 * with `no_caller` — a flow that silently never worked.
 */
export const automationActions: Record<string, ProviderAction> = {
  "chat.group.open": {
    method: "OpenGroup",
    group,
    label: { "pt-BR": "Abrir grupo no chat interno", en: "Open an internal chat group" },
    description: {
      "pt-BR": "Cria um grupo e devolve a conversa. O autor fica como sistema, não como uma pessoa.",
      en: "Creates a group and returns the conversation. The author is the system, not a person.",
    },
    example: { name: "Plantão da noite", memberIds: [] },
    fields: [
      {
        key: "name",
        type: "text",
        required: true,
        label: { "pt-BR": "Nome do grupo", en: "Group name" },
        hint: {
          "pt-BR": "Aceita referências, como {{input.text}}.",
          en: "Accepts references, such as {{input.text}}.",
        },
      },
      {
        ...membersField,
        hint: {
          "pt-BR": "Lista de IDs de pessoas da empresa. Vazio abre o grupo sem ninguém.",
          en: "A list of company member IDs. Empty opens the group with nobody in it.",
        },
      },
    ],
  },

  "chat.group.rename": {
    method: "RenameGroup",
    group,
    label: { "pt-BR": "Renomear grupo", en: "Rename a group" },
    description: {
      "pt-BR": "Troca o nome de um grupo. Só grupos: uma conversa direta é nomeada por quem está do outro lado.",
      en: "Changes a group's name. Groups only: a direct conversation is named by whoever is on the other side.",
    },
    example: { conversationId: "{{input.conversationId}}", name: "Plantão da noite" },
    fields: [
      conversationField,
      { key: "name", type: "text", required: true, label: { "pt-BR": "Novo nome", en: "New name" } },
    ],
  },

  "chat.group.members.add": {
    method: "AddMembers",
    group,
    label: { "pt-BR": "Adicionar pessoas ao grupo", en: "Add people to a group" },
    description: {
      "pt-BR": "Põe pessoas em um grupo e devolve quem está na sala. Quem já estava não é mexido. Só grupos.",
      en: "Puts people in a group and returns who is in the room. Somebody already there is left alone. Groups only.",
    },
    example: { conversationId: "{{input.conversationId}}", memberIds: [] },
    fields: [conversationField, membersField],
  },

  "chat.group.members.remove": {
    method: "RemoveMembers",
    group,
    label: { "pt-BR": "Remover pessoas do grupo", en: "Remove people from a group" },
    description: {
      "pt-BR":
        "Tira pessoas de um grupo e devolve quem ficou. Quem abriu o grupo permanece, e as mensagens continuam lá.",
      en: "Takes people out of a group and returns who is left. Whoever opened it stays, and the messages remain.",
    },
    example: { conversationId: "{{input.conversationId}}", memberIds: [] },
    fields: [conversationField, membersField],
  },

  "chat.conversations.list": {
    method: "ListConversations",
    group,
    label: { "pt-BR": "Listar conversas da empresa", en: "List the company's conversations" },
    description: {
      "pt-BR":
        "Todas as conversas desta empresa, com participantes e última mensagem. Sem contagem de não lidas: ninguém está pedindo.",
      en: "Every conversation of this company, with its participants and last message. No unread count: nobody is asking.",
    },
    example: {},
  },

  "chat.conversation.messages": {
    method: "ConversationMessages",
    group,
    label: { "pt-BR": "Ler mensagens de uma conversa", en: "Read a conversation's messages" },
    description: {
      "pt-BR":
        "Mensagens de uma conversa, da mais antiga para a mais nova. Lê qualquer conversa da empresa, porque não há pessoa pedindo.",
      en: "A conversation's messages, oldest first. It reads any conversation of the company, because no person is asking.",
    },
    example: { conversationId: "{{input.conversationId}}", limit: 50 },
    fields: [
      conversationField,
      {
        key: "limit",
        type: "number",
        optional: true,
        label: { "pt-BR": "Quantidade (1–200)", en: "How many (1–200)" },
      },
      {
        key: "before",
        type: "number",
        optional: true,
        label: { "pt-BR": "Antes da sequência", en: "Before this sequence" },
        hint: {
          "pt-BR": "Use o seq da mensagem mais antiga da página anterior.",
          en: "Use the seq of the oldest message on the previous page.",
        },
      },
    ],
  },

  "chat.message.system": {
    method: "SendAsSystem",
    group,
    label: { "pt-BR": "Avisar na conversa (como sistema)", en: "Post in a conversation (as the system)" },
    description: {
      "pt-BR": "Escreve na conversa. O autor é o sistema, não uma pessoa: não há como enviar no nome de alguém.",
      en: "Writes in the conversation. The author is the system, not a person: there is no way to post in somebody's name.",
    },
    example: { conversationId: "{{input.conversationId}}", text: "Aviso automático" },
    fields: [
      conversationField,
      {
        key: "text",
        type: "text",
        required: true,
        label: { "pt-BR": "Texto", en: "Text" },
        hint: {
          "pt-BR": "Aceita referências, como {{input.text}}.",
          en: "Accepts references, such as {{input.text}}.",
        },
      },
      {
        key: "messageId",
        type: "text",
        optional: true,
        label: { "pt-BR": "ID da mensagem", en: "Message ID" },
        hint: {
          "pt-BR": "O mesmo ID duas vezes é uma mensagem só, para o caso de reexecução.",
          en: "The same ID twice is one message, for the case of a re-run.",
        },
      },
    ],
  },
};
