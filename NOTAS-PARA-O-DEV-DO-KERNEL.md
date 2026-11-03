# Três coisas no SDK de plugins, com reprodução

**Objeto:** `@creativepetabyte/argus-sdk` 0.3.1
**Base:** o plugin `argus-plugin-chat-interno`, lido inteiro, e o SDK compilado em `node_modules`
**Data:** 2026-11-03

---

## O argumento, em um parágrafo

O protocolo plugin↔kernel tem quinze RPCs. Doze têm porta no `PluginContext` que o autor de plugin
recebe. Os três que não têm — `RequestArtefactSlot`, `ConfirmArtefact`, `ForgetArtefact` — são
exatamente os que o chat interno precisava, e ele acabou construindo upload fatiado em pedaços de
48 KiB sobre chamada de contrato: 215 linhas em `src/media-store.ts`, uma tabela a mais no schema,
um pacote fora do npm, e um estado *pending* com varredura de 24 h que reimplementa o que a zona
`temporary` já faz sozinha. **Enquanto isso, o mesmo processo usa o artefact store, duas linhas
acima, para hospedar o próprio bundle de UI.** Não é falta de capacidade no sistema — é um fio solto
no `contextFor` e um README que não menciona que a capacidade existe.

Nada aqui depende de acreditar em mim. As três seções abaixo têm reprodução.

---

## Antes: quem escreveu, e o que eu não vi

Sou o Claude Code (Opus 5). Marcos me pediu para avaliar quão fácil é construir um plugin para este
sistema, e para validar cada afirmação em vez de opinar. Ele está repassando o resultado; o conteúdo
é meu, e as perguntas em aberto são para você.

Li o plugin inteiro (`src/`, `ui/`, `shared/`, `tests/`) e o SDK **compilado** — `index.js`,
`testing.js`, `ui/index.js`, mais os `.d.ts`. Executei scripts contra o `createFakeHost` e os
helpers que o próprio SDK publica; as saídas coladas abaixo são execução real.

**Não li o kernel nem o shell do frontend** — não estão neste checkout. Onde uma conclusão
dependeria deles, eu digo isso e paro. Descartei quatro itens por não se sustentarem; estão listados
no fim, para você saber o que foi considerado e rejeitado.

Uma nota que é relevante para o resto: o código deste SDK é cuidadoso de um jeito incomum. Os
comentários explicam *por que* cada decisão foi tomada, e vários documentam o incidente concreto que
a motivou — o `Map` em escopo de módulo, os três exemplos que usaram `type:` onde ia `kind:` e
renderizaram em branco com os testes verdes, o evento confirmado cedo demais. Isso tornou a análise
muito mais rápida do que o normal. **É também por isso que eu acho que os itens 1 e 2 são omissões e
não decisões:** o arquivo é consistente demais para que fossem intencionais e não estivessem
comentadas.

---

## 1. Três RPCs de artefato não têm porta no `PluginContext`

### Reproduza

Em qualquer checkout de plugin com o SDK instalado:

```js
// verifica-ctx.mjs  →  node verifica-ctx.mjs
import { createFakeHost } from "@creativepetabyte/argus-sdk/testing";
import { contextFor } from "@creativepetabyte/argus-sdk";

const host = createFakeHost();
const ctx = contextFor(host, { instanceId: "t_acme:i_1" }, undefined);

console.log("host.storeArtefact :", typeof host.storeArtefact);
console.log("ctx.artefacts      :", ctx.artefacts);
console.log("ctx.storeArtefact  :", ctx.storeArtefact);
console.log("Object.keys(ctx)   :", Object.keys(ctx).sort().join(", "));
console.log("alguma chave com 'artef'?", Object.keys(ctx).filter(k => /artef/i.test(k)));
```

Saída aqui:

```
host.storeArtefact : function
ctx.artefacts      : undefined
ctx.storeArtefact  : undefined
Object.keys(ctx)   : announce, call, config, contracts, dataDir, emit, log, store, tenantId
alguma chave com 'artef'? []
```

### O padrão em volta

`contextFor` (`index.js:20914-20969`) repassa toda capacidade opcional do host com a mesma forma
`...host.X === undefined ? {} : { ... }`:

| RPC | superfície em `ctx` |
|---|---|
| `StorageGet` / `StorageSet` / `StorageDelete` | `ctx.store` |
| `ListMembers` | `ctx.members` |
| `DiscoverContracts` | `ctx.contracts` |
| `DiscoverEvents` / `Subscribe` | `ctx.events` |
| `Call` | `ctx.call` |
| `GetConfig` | `ctx.config` |
| **`RequestArtefactSlot` / `ConfirmArtefact` / `ForgetArtefact`** | **nenhuma** |

Testei a saída de emergência: **não existe contrato `kernel.*` de artefato** que um plugin pudesse
chamar por `ctx.call`. Os únicos que o SDK conhece são `CallRequested`, `ContractProviderChanged`,
`HttpRoute`, `InstanceInstalled`, `InstanceRemoved` e `LifecycleRequested`. A única porta é
`host.storeArtefact`, e o contexto não a repassa.

### Por que eu insisto neste

Porque o plugin **já depende** do artefact store para funcionar. `src/main.ts:11` passa
`hostedBundle`, e `index.js:23817` empurra os bytes do `ui.js` por `host.storeArtefact`. O processo
que sobe o próprio bundle por ali não consegue subir um anexo de mensagem.

E a documentação da zona `temporary` (`host-DP-0VLXr.d.ts:65`) descreve o caso do chat palavra por
palavra:

> "expires on its own, which is what **a half-finished upload** or a generated export wants —
> nobody has to remember to delete it, and forgetting is how a store fills up"

Compare com `src/media-store.ts:20-23`: `PENDING_MS = 24h`, cota por empresa, varredura do que foi
abandonado. Foi escrito à mão porque não havia como alcançar a coisa que já fazia isso.

### A parte em que o pedido simples está errado

Eu ia pedir só `ctx.artefacts.store()`. Fui checar antes e **não basta.**

`ForgetArtefact` está ligado apenas ao caminho interno do outbox (`index.js:23415-23416`), para
payload temporário de evento. **Não existe `host.forgetArtefact`.** Um anexo em `durable` não teria
como ser apagado — o que quebra "deletado junto com a conversa" e quebra o `deleteData` que o kernel
exige de todo plugin.

A razão de fundo é interessante: em `durable` **o endereço é o conteúdo**
(`host-DP-0VLXr.d.ts:87`). Duas empresas que subirem o mesmo arquivo compartilham endereço, e uma
apagar quebraria a outra.

**Você já resolveu isso para o caso temporário**, via `emission` (`host-DP-0VLXr.d.ts:84-88`):

> "it makes the artefact that emission's own, so another emission of identical bytes cannot share it
> and be broken when this one is forgotten"

Então o pedido na forma honesta: **`durable` precisa do equivalente de `emission` — um dono — e de
um `forget`.** Artefato endereçado por conteúdo, sem noção de dono, não serve para dado de cliente.
O precedente da solução é o seu próprio desenho.

**Pedido:** `ctx.artefacts?.store()`, opcional como as vizinhas — kernel sem artefact store é
deployment suportado (`host-DP-0VLXr.d.ts:795-796`), então o `?` já é o padrão certo. Mais a
semântica de dono e remoção para `durable`, antes ou junto.

---

## 2. `emit` descarrega payload grande sozinho; `call` não

### Reproduza

```sh
grep -c 'offloadLargePayload(' node_modules/@creativepetabyte/argus-sdk/index.js
# → 2
grep -n 'offloadLargePayload(' node_modules/@creativepetabyte/argus-sdk/index.js
# → 23277: async function offloadLargePayload(deps, event2) {      ← a definição
# → 23627:   const outgoing = await offloadLargePayload(            ← o único uso
```

O único uso está dentro de `async emit(`. `host.call` (`index.js:23590-23596`) são seis linhas sem
nada equivalente.

`offloadLargePayload` aceita até 983040 bytes inline (`DEFAULT_LARGE_PAYLOAD_BYTES`) e acima disso
guarda no artefact store com `zone: "temporary"`, trocando o payload por uma referência —
transparente para quem emite, com degradação para inline quando não há store (`NO_ARTEFACT_STORE`,
`index.js:23308`).

**Transparência sobre esta:** não consegui executá-la. `createHost` não é exportado publicamente e o
fake host não tem offload. A contagem de call-sites é a evidência — uma definição, um consumidor,
nenhum segundo lugar onde isso aconteça.

### Por que isso importa

`emit` e `call` são métodos vizinhos no mesmo objeto. Um tolera ~960 KB e se vira sozinho acima
disso; o outro bate num teto de 100 KB e não tem recurso. Nada na API diz isso, e o autor só
descobre quando a chamada falha. Foi essa assimetria — não a ausência de capacidade — que produziu
as fatias de 48 KiB.

Um detalhe que eu sinalizaria mesmo que você não mexa em nada: procurei `102400` e `100 * 1024` no
SDK e **não há ocorrência**. O teto é do HTTP do kernel, o SDK não o conhece, e o 48 KiB vive só no
plugin e no pacote `chat-media`, calculado à mão para caber em base64. Se esse teto mudar no kernel,
o plugin quebra em silêncio e não há onde olhar.

**Pedido:** o mesmo `offloadLargePayload` no caminho de `call`, entrada e saída. O mecanismo existe,
tem fallback e está exercitado em produção pelo `emit`. É reaproveitamento.

---

## 3. `defineContract` e `refusing` não compõem, e a falha apaga o motivo

### Reproduza

```js
// verifica-contrato.mjs  →  node verifica-contrato.mjs
import { defineContract, refusing } from "@creativepetabyte/argus-sdk";

const s = (campos) => ({ parse: (v) => {
  if (typeof v !== "object" || v === null) throw new Error("not_object");
  for (const k of campos) if (typeof v[k] !== "string") throw new Error("missing_" + k);
  return v;
} });

const Chat = defineContract("chat.internal.v1.InternalChat", {
  SendMessage: { input: s(["conversationId", "text"]), output: s(["messageId"]) },
});

const served = Chat.serve({ SendMessage: (input, call) => {
  if (!call?.caller) throw new Error("no_caller");
  return { messageId: "m1", seenCaller: call.caller.userId };
}});
const impl = served["chat.internal.v1.InternalChat"].SendMessage;

console.log("A)", await impl({ conversationId: "c1", text: "oi" },
                             { caller: { userId: "u_7", role: "agent" } }));

const guarded = refusing({ SendMessage: impl });
console.log("B)", await guarded.SendMessage({ conversationId: "c1", text: "oi" }, {}));

const ctx = { call: async () => ({ error: "no_caller" }) };   // o que (B) devolveu
try {
  console.log("C) recebeu:", await Chat.call(ctx, "SendMessage", { conversationId: "c1", text: "oi" }));
} catch (e) {
  console.log("C) explodiu:", e.message);
}
```

Saída aqui:

```
A) { messageId: 'm1', seenCaller: 'u_7' }
B) { error: 'no_caller' }
C) explodiu: missing_messageId
```

- **(A)** `serve()` repassa o `caller`, como o comentário em `index.js:24274-24276` promete. Boa
  notícia e era minha maior dúvida: este plugin depende de `caller.userId` e **poderia** adotar
  contratos tipados sem perder isso.
- **(B)** `refusing()` por fora de `serve()` compõe bem no lado do provedor.
- **(C)** `defineContract.call()` faz `schema.output.parse(output)` estrito
  (`index.js:24265-24266`). A recusa não passa — e o erro que chega é `missing_messageId`. **O código
  real, `no_caller`, desaparece.**

### Por que isso importa

O chamador tipado não apenas rejeita a recusa: ele a troca por um erro que descreve a coisa errada.
A tela receberia "falta o campo messageId" quando o problema era "o kernel não disse quem está
chamando".

Isso é exatamente a falha que o chat se esforça para evitar — ele devolve códigos e nunca frases, e
traduz cada código na tela. E eu suspeito que seja o motivo de ele não usar nenhum dos dois helpers:
o custo aparece como 44 chamadas de `stringAt`/`numberAt`/`stringsAt` em `src/plugin.ts`, mais
`codeOf` + `refusal()` (`src/plugin.ts:92-100`), que são uma reimplementação linha a linha do
`refusing()` que você já exporta.

**Pedido:** vocabulário de recusa em `defineContract` — um `refusals` opcional por método, ou um
`parse` que reconheça a forma `{ error }` antes de tentar o esquema de sucesso. Sem isso, quem
quiser os dois helpers oficiais tem que poluir todo esquema de saída com união de erro, em todos os
métodos.

---

## 4. O que amarra os três: não está documentado

```sh
grep -in 'artefact\|refusing\|largePayload\|offload' node_modules/@creativepetabyte/argus-sdk/README.md
# → nenhuma linha
```

O README cobre `watch`, `defineContract`, `defineEvent`, recuperação de stream e `createSseParser`.
Artefact store, offload automático de `emit` e `refusing()` não aparecem.

**Na minha leitura isto é a causa raiz dos itens 1, 2 e 3.** Quem escreveu o chat interno conhece o
sistema a fundo — isso é visível nos comentários, que discutem ordenação por conversa, o que
acontece numa reconexão, e por que um `Map` em escopo de módulo seria vazamento entre empresas. É
alguém atento. E ainda assim reimplementou `refusing()` à mão e construiu upload fatiado tendo blob
store no mesmo processo.

Três consequências, em ordem de gravidade:

1. **O plugin de referência ensina os padrões errados.** Quem for fazer o segundo plugin vai olhar
   este — é o exemplo mais completo que existe — e copiar validação manual e upload fatiado. A
   dívida se replica, e cada cópia fica mais difícil de desfazer.
2. **A assimetria do item 2 é inadivinhável.** Dois métodos vizinhos, ordem de magnitude de
   diferença, nada na API sinalizando.
3. **O número mágico está fora do alcance de quem o deve.** O 48 KiB vive no plugin; o teto de
   100 KB vive no kernel; o SDK não conhece nenhum dos dois.

A conclusão que eu tiraria disso é, no fundo, favorável: **o sistema é mais capaz do que o seu
plugin de referência demonstra.** O conserto mais barato não é construir capacidade nova — é
documentar o que já existe e ligar o fio do item 1.

---

## O que está genuinamente bom

Não quero que a lista acima passe a impressão errada, porque ela é a minoria do que eu li.

O processo de um plugin são três linhas (`runPlugin(plugin)`), sem porta de entrada, sem endereço
para configurar, funcionando atrás de NAT. `create(ctx)` roda uma vez por empresa e o código **não
alcança** um `companyId` — vazar dado entre empresas exige esforço deliberado, e isso é isolamento
por construção, não por disciplina do autor. É a melhor decisão do desenho inteiro.

Mais: escopos declarativos, `exportData`/`deleteData` como parte da interface e não como TODO,
suíte de conformidade, idempotência de evento endereçada já no template, i18n nos dois idiomas
desde o scaffold. E o `createFakeHost` é bom o suficiente para eu ter validado quatro hipóteses sem
kernel e sem rede — o que é mais do que a maioria dos SDKs permite.

Um plugin CRUD com uma tela é trabalho de algumas horas, e o tempo vai todo para o domínio. O que
os itens acima dizem é que isso deixa de valer no momento em que o plugin precisa de arquivo, de
payload grande ou de recusa tipada — e que nos três casos a capacidade estava lá.

---

## O que eu considerei e descartei

- **"`renderSlot` não recebe contexto."** A assinatura é `(name: string) => SlotNode`
  (`ui/index.d.ts:271`), e isso limita de verdade — contribuição por mensagem ou por conversa é
  impossível, como o `README.md` do chat admite. Mas `renderSlot` **não existe no runtime do SDK**
  (grep em `ui/index.js`: zero); quem implementa é o shell, que eu não li. Não sei se é barato ou
  caro, então vai como pergunta: **existe intenção de passar contexto de slot?**
- **"Unificar `SlotNode`/`PageNode` entre shell e SDK."** Já é TODO declarado seu, com o incidente
  documentado em `host-DP-0VLXr.d.ts:505-517`. Você já sabe; relatar não agrega.
- **"Falta um `argus-plugin dev`."** Opinião minha sobre ergonomia, sem evidência de ser o gargalo
  real. Cortado.
- **`RouteAnswer` só aceita `text/plain`** (`host-DP-0VLXr.d.ts:843-848`). Verdadeiro, mas
  secundário: se o item 1 entrar, download sai pelo endereço do artefato. Deixo só registrado que
  uma lista fechada de tipos — o mesmo desenho de `ArtefactToStore.contentType`, `host:76-79` —
  preservaria a garantia de não deixar o plugin ditar headers.
- **Qualquer conclusão sobre desempenho, sobre o kernel ou sobre o shell.** Não os li.

---

## Ordem sugerida

**4 → 1 → 2**, com 3 como nota de rodapé. O 4 é o mais barato e explica os outros. O 1 e o 2 são o
mesmo pedido por dois ângulos: exponha o artefato ao autor, e use no `call` o offload que já existe
no `emit`.

Se for para levar um argumento só: **doze dos quinze RPCs do protocolo têm porta no `ctx`, e os três
que faltam são justamente os que este plugin precisava — enquanto ele usa o artefact store, no mesmo
processo, para hospedar o próprio bundle.**
