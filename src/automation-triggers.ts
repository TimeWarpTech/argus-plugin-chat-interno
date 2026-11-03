import type { TriggerDefinition } from "@creativepetabyte/argus-automation-nodes";
import {
  CONVERSATION_READ,
  GROUP_ADMINS_CHANGED,
  GROUP_OPENED,
  GROUP_UPDATED,
  MESSAGE_DELETED,
  MESSAGE_SENT,
  PARTICIPANTS_ADDED,
  PARTICIPANTS_REMOVED,
} from "./events.js";

/**
 * Everything this plugin announces, described so a flow can start from it.
 *
 * Nothing is published here for the engine's sake alone: each of these goes out anyway, for the open
 * screens, and a plugin may only listen to its own topic. Declaring them as triggers tells the
 * editor that they exist and what they carry.
 *
 * Each example is the REAL payload, because the editor shows it as the input available to the nodes
 * downstream -- somebody writes `{{input.conversationId}}` by reading this. Every one of them
 * carries `conversationId`, which is the field the nodes in `automation.ts` ask for.
 */
const group = { id: "chat-internal", label: { "pt-BR": "Chat interno", en: "Internal chat" } };

export const automationTriggers: TriggerDefinition[] = [
  {
    type: GROUP_ADMINS_CHANGED,
    group,
    label: { "pt-BR": "Administradores do grupo alterados", en: "Group administrators changed" },
    description: {
      "pt-BR": "Inicie quando um participante ganhar ou perder a função de administrador.",
      en: "Start when a participant becomes or stops being an administrator.",
    },
    example: {
      conversationId: "conversation-example",
      memberId: "bruno",
      isAdmin: true,
      admins: ["ana", "bruno"],
      by: "ana",
    },
  },
  {
    type: MESSAGE_DELETED,
    group,
    label: { "pt-BR": "Mensagem apagada", en: "Message deleted" },
    description: {
      "pt-BR": "Inicie quando uma mensagem for apagada para todos.",
      en: "Start when a message is deleted for everyone.",
    },
    example: {
      conversationId: "conversation-example",
      messageId: "message-example",
      deletedBy: "ana",
      deletedAt: "2026-01-01T12:00:00.000Z",
    },
  },
  {
    type: GROUP_UPDATED,
    group,
    label: { "pt-BR": "Nome do grupo alterado", en: "Group name changed" },
    description: { "pt-BR": "Inicie quando o nome de um grupo mudar.", en: "Start when a group's name changes." },
    example: { conversationId: "conversation-example", name: "Equipe de atendimento" },
  },
  {
    type: MESSAGE_SENT,
    group,
    label: { "pt-BR": "Mensagem enviada", en: "Message sent" },
    description: {
      "pt-BR": "Inicie quando alguém enviar uma mensagem no chat interno.",
      en: "Start when somebody sends a message in the internal chat.",
    },
    example: {
      messageId: "message-example",
      conversationId: "conversation-example",
      authorId: "ana",
      text: "Exemplo",
      at: "2026-01-01T12:00:00.000Z",
      seq: 1,
      participants: ["ana", "bruno"],
    },
  },
  {
    type: GROUP_OPENED,
    group,
    label: { "pt-BR": "Grupo aberto", en: "Group opened" },
    description: {
      "pt-BR": "Inicie quando um grupo for criado. `createdBy` é `system` quando quem abriu foi uma automação.",
      en: "Start when a group is created. `createdBy` is `system` when an automation opened it.",
    },
    example: {
      conversationId: "conversation-example",
      name: "Plantão da noite",
      createdBy: "ana",
      createdAt: "2026-01-01T12:00:00.000Z",
      participants: ["ana", "bruno"],
    },
  },
  {
    type: PARTICIPANTS_ADDED,
    group,
    label: { "pt-BR": "Pessoas adicionadas à conversa", en: "People added to a conversation" },
    description: {
      "pt-BR": "Inicie quando alguém entrar em um grupo. `memberIds` é quem entrou; `participants` é a sala inteira.",
      en: "Start when somebody joins a group. `memberIds` is who joined; `participants` is the whole room.",
    },
    example: {
      conversationId: "conversation-example",
      memberIds: ["bruno"],
      participants: ["ana", "bruno"],
      by: "system",
      at: "2026-01-01T12:00:00.000Z",
    },
  },
  {
    type: PARTICIPANTS_REMOVED,
    group,
    label: { "pt-BR": "Pessoas removidas da conversa", en: "People removed from a conversation" },
    description: {
      "pt-BR": "Inicie quando alguém sair de um grupo. `memberIds` é quem saiu; `participants` é quem ficou.",
      en: "Start when somebody leaves a group. `memberIds` is who left; `participants` is who is left.",
    },
    example: {
      conversationId: "conversation-example",
      memberIds: ["bruno"],
      participants: ["ana"],
      by: "system",
      at: "2026-01-01T12:00:00.000Z",
    },
  },
  {
    type: CONVERSATION_READ,
    group,
    label: { "pt-BR": "Conversa marcada como lida", en: "Conversation marked read" },
    description: {
      "pt-BR": "Inicie quando alguém ler uma conversa até uma mensagem. `through` é o seq lido.",
      en: "Start when somebody reads a conversation up to a message. `through` is the seq they read to.",
    },
    example: {
      conversationId: "conversation-example",
      userId: "ana",
      through: 7,
      at: "2026-01-01T12:00:00.000Z",
    },
  },
];
