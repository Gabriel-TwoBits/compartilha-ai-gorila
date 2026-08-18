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

## Antes de tirar do localhost

- **`http://localhost` funciona; `http://192.168.x.x` não.** Capturar a tela
  exige um contexto seguro. Assim que o app sair da sua máquina, ele precisa de
  HTTPS. O caminho mais curto é o [Cloudflare
  Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):
  `cloudflared tunnel --url http://localhost:8787` dá uma URL HTTPS pública
  apontando para o servidor local, de graça, sem abrir porta no roteador.
- Quando isso acontecer, rode com `NODE_ENV=production` para que o cookie de
  sessão passe a ser `Secure`.

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
| `Dockerfile` | Build multi-stage: cliente no primeiro estágio, runtime no segundo |

```sh
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

---

## Publicando no Codeberg

Crie o repositório vazio no Codeberg e depois:

```sh
git remote add origin https://codeberg.org/<seu-usuário>/compartilha-ai-gorila.git
git push -u origin main
```
