/**
 * Entrega o bundle da tela: um endereço, uma pasta.
 *
 * Separado do processo do plugin porque o bundle são os MESMOS bytes para toda empresa — é servido
 * por um processo da implantação, não de dentro do plugin. Por isso o processo pode rodar na máquina
 * de quem desenvolve enquanto o bundle mora num endereço público: o que precisa casar é o
 * `integrity`, que o runtime calcula do que ESTE servidor está entregando.
 *
 * O servir em si é do SDK. Era o mesmo arquivo em todo plugin com tela, junto com as partes fáceis
 * de errar em silêncio: o content-type, o CORS sem o qual o navegador pula a verificação de
 * integridade, o `no-store` e a recusa de caminho que sai da pasta. Esta cópia servia só `ui.js` —
 * um bundle com folha de estilo própria daria 404.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveBundle } from "@creativepetabyte/argus-sdk";

serveBundle({
  directory: join(dirname(fileURLToPath(import.meta.url)), "..", "ui", "dist"),
  // Abaixo de 49152: acima disso o Windows entrega a faixa para conexões de saída, e o bind falha
  // de vez em quando sem padrão.
  port: Number(process.env.PLUGIN_UI_PORT ?? 4640),
  pluginId: "chat.internal",
});
