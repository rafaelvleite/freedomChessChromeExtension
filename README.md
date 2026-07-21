# Freedom Chess for Chess.com

Extensão Chrome Manifest V3 para controlar o tabuleiro do Chess.com por voz em português do Brasil. A versão 2 valida cada comando contra os lances legais da posição atual e pede confirmação antes de interagir com o tabuleiro.

## Privacidade e custo

- Não usa API paga, servidor próprio, analytics ou armazenamento de transcrições.
- Prefere o reconhecimento local (`processLocally`) da Web Speech API.
- Se o pacote pt-BR local não estiver disponível, o modo online só é ativado após consentimento explícito. Nesse modo, o navegador pode enviar o áudio ao serviço de reconhecimento dele.
- A síntese de respostas usa somente uma voz marcada pelo navegador como local; sem ela, o texto continua disponível na região acessível de status.
- Apenas uma aba pode manter o reconhecimento ativo por vez.

## Comandos

Exemplos: `é quatro`, `cavalo efe três`, `bispo captura cê seis`, `cavalo de bê um para dê dois`, `roque curto`, `roque longo` e `é oito promoção dama`.

Também são aceitos `lances legais`, `desistir`, `cancelar` e `desativar modo`. Lances ambíguos, promoções sem a peça escolhida e comandos ilegais não são executados.

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
