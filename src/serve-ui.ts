/**
 * Entrega o bundle da tela, e so isso: um endereco, um arquivo.
 *
 * Separado do processo do plugin porque o bundle e os MESMOS bytes para toda empresa -- ele e
 * servido por um processo da implantacao, nao de dentro do plugin. E por isso que o processo pode
 * rodar na maquina de quem desenvolve enquanto o bundle mora num endereco publico: o que precisa
 * casar e o `integrity`, que o plugin calcula lendo o mesmo arquivo.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PLUGIN_UI_PORT ?? 4640);
const bundle = fileURLToPath(new URL("../ui/dist/ui.js", import.meta.url));

createServer((request, response) => {
  if (request.url !== "/ui.js") {
    response.writeHead(404).end();
    return;
  }
  readFile(bundle).then(
    (conteudo) => {
      response
        .writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          // O kernel prende o bundle por `integrity`; a origem e aprovada pelo operador.
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        })
        .end(conteudo);
    },
    () => response.writeHead(500).end(),
  );
}).listen(port, "0.0.0.0", () => console.log(`[chat.internal] bundle em http://localhost:${port}/ui.js`));
