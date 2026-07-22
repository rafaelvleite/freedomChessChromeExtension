# Freedom Chess for Chess.com

Extensão Chrome Manifest V3 para controlar o tabuleiro do Chess.com por voz em português do Brasil. A versão 2 valida cada comando contra os lances legais da posição atual e pede confirmação antes de interagir com o tabuleiro.

## Privacidade e custo

- Não usa API paga, servidor próprio, analytics ou armazenamento de transcrições.
- Prefere o reconhecimento local (`processLocally`) da Web Speech API.
- Se o pacote pt-BR local não estiver disponível, o modo online só é ativado após consentimento explícito. Nesse modo, o navegador pode enviar o áudio ao serviço de reconhecimento dele.
- O mesmo consentimento é pedido se o reconhecimento local se declarar disponível mas parar de transcrever em uso — ver **Recuperação automática** abaixo.
- A síntese de respostas prefere uma voz marcada pelo navegador como local. Se não houver nenhuma em português, ela usa a voz pt-BR disponível — inclusive remota — porque ficar em silêncio deixa a extensão inutilizável. Só o texto gerado pela extensão é sintetizado, nunca o seu áudio.
- Toda mensagem também aparece como aviso visível no canto inferior esquerdo da página, e é anunciada por leitores de tela.
- Apenas uma aba pode manter o reconhecimento ativo por vez.

## Comandos

Exemplos: `é quatro`, `cavalo efe três`, `bispo captura cê seis`, `cavalo de bê um para dê dois`, `roque curto`, `roque longo` e `é oito promoção dama`.

Também são aceitos `lances legais`, `desistir`, `cancelar` e `desativar modo`. Lances ambíguos, promoções sem a peça escolhida e comandos ilegais não são executados.

Quando nenhum lance legal corresponde exatamente ao que foi ouvido, a extensão diz o que entendeu e oferece o lance legal mais próximo — sempre pedindo confirmação antes de tocar no tabuleiro.

## Recuperação automática

O reconhecedor no dispositivo do Chrome pode engolir uma fala inteira: dispara `audiostart`, `soundstart`, `speechstart`, `speechend` e `audioend` e depois não devolve resultado, erro nem sequer o evento `end`. A sessão fica pendurada, `isRecognitionActive` nunca volta a `false` e a extensão fica surda para sempre depois da primeira frase.

O travamento pode ser específico de um idioma. Já foi observado `pt-BR` pendurar indefinidamente numa página onde `en-US` transcrevia normalmente, com resultados parciais e tudo, no mesmo instante — e `SpeechRecognition.available()` respondendo `available` o tempo todo. Nesse caso **reiniciar o Chrome resolveu**; a disponibilidade relatada pela API não é garantia de que o serviço vai responder.

Quando uma sessão captura fala e não produz transcrição em até 3 segundos, a extensão escala um passo por vez, do mais barato para o mais invasivo:

1. Descarta as dicas contextuais (`SpeechRecognitionPhrase`) e recria o reconhecedor.
2. Se já estiver sem dicas e ainda travar no modo local, oferece a troca para o reconhecimento online — pedindo consentimento, porque isso envia áudio ao serviço do navegador.
3. Só depois disso desativa, avisando para reiniciar o navegador.

Uma única sessão que termina sem transcrição é tratada como normal; só a segunda seguida — ou um travamento sem `end`, que nunca é normal — dispara a escalada.

## Depuração

Avisos (`console.warn`) saem sempre. `localStorage.freedomChessDebug = "1"` no console da página do Chess.com liga o rastreamento passo a passo: transcrições recebidas, forma normalizada de cada alternativa, resultado do casamento, ciclo de vida do reconhecedor (`audiostart` → `speechstart` → `result`) e disponibilidade de vozes.

Esse rastreamento é a ferramenta de diagnóstico principal. Se o microfone abre mas nada acontece, a última linha do ciclo de vida diz onde parou: sem `soundstart` é captura muda, sem `speechstart` é som que não vira fala, e `speechend` sem `result` é o serviço de reconhecimento não respondendo.

## Instalação local

1. Rode `npm test` e `npm run build` (Node.js 18 ou mais recente).
2. Abra `chrome://extensions`, ative o modo do desenvolvedor e escolha **Carregar sem compactação**.
3. Selecione a pasta `dist/extension`.
4. Abra uma página do Chess.com que contenha um tabuleiro e use o botão **Ativar controle de voz** junto aos controles do tabuleiro, ou o ícone da extensão.

O Chrome pode solicitar permissão de microfone e oferecer o download gratuito do pacote local pt-BR na primeira ativação.

## Desenvolvimento

```sh
npm test       # testes do parser e matching determinístico
npm run check  # manifesto, arquivos distribuídos e sintaxe
npm run build  # extensão descompactada em dist/extension
npm run package # ZIP determinístico em dist/release
```

Os arquivos carregados em produção estão definidos por uma lista explícita em `scripts/build-extension.mjs`; o código legado permanece fora do pacote.
