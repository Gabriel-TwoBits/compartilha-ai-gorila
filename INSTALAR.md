# Como instalar o CompartilhaAíGorila

Esse programa serve para você **transmitir a tela mandando só o som do jogo** —
sem a call do Discord junto. Hoje, quem transmite pelo site acaba mandando as
vozes da conversa também, e todo mundo se ouve com atraso.

Você só precisa dele para **transmitir**. Para assistir, o site basta.

## 1. Baixar

Abra o link da sala no computador: o botão de download já vem com o arquivo
certo para o seu sistema.

São uns 100 MB. Esse é o único download que você faz à mão — depois o app se
atualiza sozinho.

## 2. Abrir

### Windows

Clique duas vezes no arquivo baixado.

**Vai aparecer uma tela azul dizendo "O Windows protegeu o computador".** Isso é
normal e não quer dizer que tem vírus — acontece com todo programa que não pagou
um certificado da Microsoft, que custa caro e não faz sentido para um grupo de
amigos.

Para continuar:

1. Clique em **Mais informações** (o textinho pequeno)
2. Clique em **Executar assim mesmo**

Pronto. Ele instala sozinho, não pede senha de administrador, e abre no fim.

### Linux

O **AppImage** não instala nada: é um arquivo só, que roda de onde estiver. Só
precisa ganhar permissão de execução uma vez.

Pelo gerenciador de arquivos: clique com o direito → **Propriedades** →
**Permissões** → marque *permitir execução*. Depois é clique duplo.

Ou pelo terminal:

```sh
chmod +x ~/Downloads/CompartilhaAiGorila.AppImage
~/Downloads/CompartilhaAiGorila.AppImage
```

**Se o clique duplo não fizer nada**, falta a `libfuse2` — o Debian 13 e o
Ubuntu 22.04+ não a instalam mais por padrão, e sem ela o AppImage nem abre nem
reclama:

```sh
sudo apt install libfuse2
```

**Ou use o pacote `.deb`**, que não precisa de nada disso: baixe, clique duas
vezes, ou rode `sudo apt install ./CompartilhaAiGorila.deb`.

A diferença: o **`.deb` não se atualiza sozinho**. Quando sair versão nova você
baixa de novo. Com o AppImage, o app se vira — por isso ele é o recomendado, se
a `libfuse2` não for problema.

**Precisa do PipeWire**, que já vem no Ubuntu 22.10+, Fedora 34+, Debian 12+ e
derivados recentes. Para conferir, rode `pactl info`: tem que responder
*"Server Name: PulseAudio (on PipeWire ...)"*. Se disser só *PulseAudio*, sem o
PipeWire, o áudio por aplicativo não vai funcionar — avise que a gente vê o que
dá para fazer.

## 3. Transmitir

1. Entre com seu apelido e a senha da sala.
2. Clique em **Transmitir minha tela**.
3. Escolha o que compartilhar.

   No **Linux com Wayland** (o padrão hoje no Ubuntu, no Fedora e no KDE), quem
   pergunta é uma janelinha do próprio sistema. É um clique a mais e não há como
   evitar: ali nenhum programa pode listar as janelas dos outros, de propósito.

   No **Windows** e no Linux com X11, a lista aparece dentro do app, com as
   miniaturas.

**O áudio já vai junto**, sem você fazer nada: o padrão é mandar tudo o que
estiver tocando, menos o Discord. Um jogo aberto depois entra sozinho.

Se quiser escolher, clique em **🔈 Áudio**:

| modo | o que entra |
|---|---|
| **Tudo menos o Discord** | tudo o que está tocando, e o que você abrir depois. É o padrão. |
| **Só estes aplicativos** | só o que você marcar. |
| **Áudio do sistema inteiro** | tudo, Discord junto. Igual ao site. |
| **Sem áudio** | só imagem. |

Nos dois primeiros o Discord nem aparece na lista, então não tem como
escorregar.

## 4. Conferindo se o som está indo

Do lado dos controles tem uma **barrinha**. Ela mexe conforme o som que está
saindo.

- Barra mexendo quando o jogo faz barulho → tá certo.
- Barra parada → o áudio não está indo. Abra o **🔈 Áudio** e confira o modo.
  Não precisa parar a transmissão para mudar.

## Perguntas

**Meu programa não aparece na lista de áudio.**
No **Linux**, a lista mostra quem está **tocando som agora**. Um jogo em
silêncio não aparece até fazer barulho — dê um tiro, abra o menu, e ele entra.
No **Windows** é o contrário: a lista mostra quem tem janela própria, então um
programa sem janela não aparece.

Em qualquer caso, "tudo menos o Discord" não depende de marcar nada.

**Marquei o jogo mas ninguém ouve.**
Olhe a barrinha. Se ela não mexe, o programa marcado não é o que toca o som —
alguns jogos usam um processo separado para áudio. Tente "tudo menos o Discord".

**Posso assistir alguém pelo app enquanto transmito?**
Pode. Só não use **áudio do sistema inteiro** — nesse modo o som da pessoa que
você está assistindo entra na sua transmissão e ela se ouve de volta. O app
avisa quando isso pode acontecer.

**Está saindo a minha voz na transmissão.**
O app nunca abre o microfone. Se a sua voz sai, é porque algum programa está
**reproduzindo** ela — retorno de microfone, ou mesa virtual tipo SteelSeries
Sonar e VoiceMeeter. Os modos por aplicativo já deixam esses de fora. Se ainda
assim sair, avise.

**Diz que meu Windows é antigo demais.**
A captura por aplicativo precisa do Windows 10 build 20348 ou do Windows 11. Em
Windows mais antigo dá para transmitir com o som do sistema inteiro, mas aí o
Discord vai junto — nesse caso o site faz a mesma coisa.

**Preciso baixar de novo quando sair versão nova?**
Não. O app procura sozinho e mostra uma faixa com **Reiniciar e atualizar**.
Quem não clicar recebe a versão nova na próxima vez que fechar o app. (O `.deb`
é a exceção: esse você baixa de novo.)

**Como desinstalo?**
No Windows: Configurações → Aplicativos → CompartilhaAiGorila → Desinstalar.
No Linux: apague o `.AppImage`, ou `sudo apt remove compartilha-ai-gorila-desktop`
se instalou pelo `.deb`.

**Ainda dá para usar o site?**
Dá, do mesmo jeito. O app é só uma opção melhor para quem transmite.
