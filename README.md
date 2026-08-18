# CompartilhaAíGorila

Uma sala única onde um grupo de amigos entra, alguém transmite a tela **com
áudio** e os outros assistem. Sem câmera, sem microfone — a conversa por voz
continua no Discord.

O encaminhamento de vídeo é feito pelo [Cloudflare Realtime
SFU](https://developers.cloudflare.com/realtime/sfu/), que dá 1.000 GB/mês de
egresso grátis. O servidor deste repositório cuida de login, presença e de
distribuir os endereços das tracks; ele não toca na mídia.

---

## Como funciona

```
Navegador A (transmite)                  Navegador B (assiste)
   │  push(track)                            │  ◄── pull(track)
   │  WS: "estou transmitindo,               │  WS: recebe o estado da sala
   │       eis (sessionId, trackName)"       │      e puxa a track do A
   ▼                                         ▼
┌────────────────────────────────────────────────────┐
│  Servidor Node (server/)                           │
│   /api/login|logout|me   cookie de sessão assinado │
│   /ws                    presença + endereços      │
│   /partytracks/*         proxy (guarda o segredo)  │
└──────────────────────┬─────────────────────────────┘
                       │ Bearer SFU_APP_TOKEN
                       ▼
             Cloudflare Realtime SFU  ◄── a mídia trafega por aqui
```

O SFU da Cloudflare não tem conceito de sala: quem assiste só consegue puxar uma
track se souber o par `(sessionId, trackName)` de quem transmite. Distribuir esse
par é a única razão de existir do WebSocket em `server/signaling.ts`.

**A identidade é o apelido.** Quem abre duas abas continua sendo um participante
só, com duas conexões; a pessoa sai da sala quando a última fecha. A transmissão
pertence à conexão que a publicou, então fechar uma aba ociosa não derruba a aba
que está de fato compartilhando a tela. O preço disso é que dois amigos que
escolherem o mesmo apelido viram uma entrada só — aceitável numa sala cujo
portão de verdade é a senha compartilhada.

Cada cliente informa pelo socket qual transmissão está exibindo, e é daí que sai
a contagem de espectadores na barra lateral. Quem assiste a própria tela vê a
captura local, não uma cópia vinda do SFU, e por isso não conta como audiência.

O `SFU_APP_TOKEN` nunca chega ao navegador — daí o proxy `/partytracks/*`, que
fica atrás do cookie de sessão para que ninguém de fora consuma a sua cota.

O trabalho pesado de WebRTC (SDP, renegociação, recuperação de queda de conexão)
é da lib [`partytracks`](https://www.npmjs.com/package/partytracks), mantida pela
Cloudflare.

---

## Rodando localmente

**1. Crie o app SFU.** No [dashboard da
Cloudflare](https://dash.cloudflare.com/?to=/:account/realtime/sfu), crie um app
Realtime SFU e guarde o **App ID** e o **App Secret**.

**2. Configure o ambiente.**

```sh
cp .env.example .env
```

Preencha `SFU_APP_ID` e `SFU_APP_TOKEN` com o que a Cloudflare deu, escolha uma
`ROOM_PASSWORD` e gere a chave de assinatura:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O servidor recusa subir com qualquer variável faltando, dizendo qual é.

**3. Suba.**

```sh
pnpm install
pnpm dev
```

A UI fica em <http://localhost:5173> e o servidor em `:8787`. Em
desenvolvimento o Vite repassa `/api`, `/ws` e `/partytracks` para ele.

**4. Teste com duas pessoas.** Abra duas janelas do Chrome — uma normal e uma
anônima, senão as duas compartilham o mesmo cookie — e entre com apelidos
diferentes.

Para produção: `pnpm build && pnpm start`, que serve `dist/client` pelo próprio
Node numa porta só. Para exercitar isso em `http://localhost`, rode com
`SECURE_COOKIES=false` — senão o navegador descarta o cookie `Secure` e o login
parece aceitar a senha sem nunca entrar.

### Container

```sh
docker build -t compartilha-ai-gorila .
docker run -p 8787:8787 --env-file .env compartilha-ai-gorila
```

Imagem multi-stage: o primeiro estágio monta o bundle do cliente com o
toolchain completo, o segundo fica só com as dependências de runtime (~227 MB).
Não há `--env-file` no `CMD` — um container recebe configuração pelo ambiente, e
`server/env.ts` recusa subir se faltar alguma variável.

## Uso de banda

A captura é limitada a **720p, 30fps**, e o encoder a **2,5 Mbps**
(`client/src/tracks.ts`). O teto de resolução por si só não limita bitrate — uma
tela agitada estoura o que o encoder quiser — então o `maxBitrate` é o número
que de fato segura a conta.

A Cloudflare cobra só a saída dela para os clientes, e o que você **envia** é de
graça. A 2,5 Mbps isso dá ~1,1 GB/h **por espectador**: contra a cota gratuita
de 1.000 GB/mês, cerca de 900 horas-espectador, ou ~225 h/mês com 4 pessoas
assistindo.

---

## Expondo para amigos (Cloudflare Tunnel)

**`http://localhost` funciona; `http://192.168.x.x` não.** Capturar a tela exige
um contexto seguro, então assim que o app sai da sua máquina ele precisa de
HTTPS. Um *quick tunnel* resolve isso num comando: uma URL HTTPS pública
apontando para o servidor local, sem conta na Cloudflare, sem domínio e sem
abrir porta no roteador.

**1. Instale o
[`cloudflared`](https://github.com/cloudflare/cloudflared/releases/latest).**

**2. Rode um comando só.**

```sh
pnpm share
```

Ele monta o cliente, sobe o servidor em modo produção — porta única, e o cookie
de sessão sai `Secure`, como o HTTPS do túnel pede — e abre o túnel na frente,
anunciando a URL assim que ela existe:

```
  Room reachable at https://<quatro-palavras>.trycloudflare.com
```

Mande a URL para os amigos junto com a `ROOM_PASSWORD`, e peça que abram no
Chrome/Chromium (ver "Limitações conhecidas"). Qualquer um com a URL cai na tela
de login, então o portão continua sendo a senha. `Ctrl+C` derruba servidor e
túnel juntos, e o endereço morre com eles; a próxima execução sorteia outro.

Para exercitar o app em desenvolvimento, aponte o túnel para o Vite
(`cloudflared tunnel --url http://localhost:5173`) em vez do Node — é por isso
que `vite.config.ts` aceita hosts `.trycloudflare.com`. Nesse caminho o cookie
sai sem `Secure` e o HMR pode reclamar pelo túnel; para testar com gente de
verdade, prefira o modo produção acima.

O túnel não custa nada e não pede conta, mas não tem garantia de uptime e corta
em 200 requisições simultâneas: serve para testar, não para hospedar.

### Se o vídeo não chegar

Tela preta e `ICE failed` no console significam que não existe caminho UDP
direto até o SFU, quase sempre por NAT simétrico ou rede que bloqueia UDP de
saída do lado de quem assiste. O conserto é o TURN: crie a chave em Realtime →
TURN, preencha `TURN_APP_ID` e `TURN_APP_TOKEN` e reinicie o servidor, que lê o
ambiente só no boot. O túnel segue de pé e a URL não muda.

## Limitações conhecidas

- **Áudio da tela** depende do navegador e do sistema. Chrome/Chromium com
  PipeWire no Linux funciona; o Firefox não suporta áudio em `getDisplayMedia` de
  jeito nenhum. Se o vídeo chega e o áudio não, o problema quase sempre é este, e
  não o código.
- **A mídia passa pela Cloudflare** mesmo com o app rodando local. Isso é
  inerente ao SFU deles — ver "Uso de banda" acima.
- **A sala vive em memória.** Reiniciar o servidor esvazia a sala, e todo mundo
  reconecta sozinho.

---

## Estrutura

| Caminho | O que é |
|---|---|
| `shared/protocol.ts` | Contrato do WebSocket e validação, usado pelos dois lados |
| `server/env.ts` | Ambiente lido e validado uma vez, no boot |
| `server/session.ts` | Senha da sala e cookie assinado |
| `server/room.ts` | Estado da sala, em memória |
| `server/signaling.ts` | WebSocket: presença e endereços das tracks |
| `server/main.ts` | Rotas HTTP e boot |
| `client/src/useBroadcast.ts` | Publica a tela no SFU e anuncia para a sala |
| `client/src/tracks.ts` | Singletons do PartyTracks e os tetos de 720p30 / 2,5 Mbps |
| `client/src/components/Stage.tsx` | Painel principal: prévia local ou track remota |
| `scripts/share.ts` | Build, servidor e túnel num comando (`pnpm share`) |

```sh
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

---

## Licença

[AGPL-3.0-only](LICENSE). É copyleft de rede: quem rodar uma versão modificada
como serviço acessível pela internet tem de oferecer o código dessa versão aos
usuários dela, não só a quem receber o binário.
