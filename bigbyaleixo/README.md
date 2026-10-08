# BIG by Aleixo

**CALL SHEET → PDF.** Aplicação web que lê a imagem (JPG/PNG, ou HEIC no Safari) de um call sheet de produção broadcast, identifica os campos, mostra-os para validação e correção, e gera um PDF estruturado e profissional — com texto real, pesquisável e selecionável.

Tudo corre no browser: a imagem nunca sai do computador do utilizador. Não há backend, contas, cookies, analytics nem APIs pagas.

```
ORIGINAL → OCR → DADOS ESTRUTURADOS → EDIÇÃO → PDF
```

## Requisitos

- Node.js 20.19+ ou 22.12+
- npm

## Instalação e desenvolvimento

```bash
npm install
npm run dev        # http://localhost:5173
```

Outros comandos:

```bash
npm run build      # verifica tipos e gera a versão de produção em dist/
npm run preview    # serve dist/ localmente
npm test           # testes automáticos (parser, confiança, validação, PDF)
```

`npm run dev` e `npm run build` correm antes `npm run ocr:assets`, que copia o motor de OCR (worker do Tesseract.js, WebAssembly e o modelo de português) de `node_modules` para `public/ocr/<versão>/`. Assim a aplicação serve estes ficheiros a partir do próprio domínio e não depende de nenhum CDN. Esta pasta é gerada e está no `.gitignore`.

## Como funciona

| Fase | O que acontece | Ficheiros |
|---|---|---|
| Preparar imagem | Descodifica a imagem (sem a alterar), retira anotações à mão (riscos de caneta coloridos), estima o tamanho do texto, remove o fundo de cada célula (cores, cabeçalhos escuros com texto branco), reconstrói títulos em letra grande e deixa texto escuro sobre branco. Corre num Web Worker. | `src/ocr/imagePreprocessor.ts`, `src/ocr/prepare.ts` |
| Identificar tabelas | Deteta os traços da grelha (guarda-os como separadores de células e apaga-os) e agrupa as letras em zonas de texto — cada zona é o conteúdo de uma célula. | `src/ocr/tableDetector.ts` |
| OCR | Tesseract.js lê cada zona separadamente, com a posição X/Y e a confiança. Leituras duvidosas são repetidas a outras escalas e decididas por maioria. | `src/ocr/ocrEngine.ts` |
| Organizar campos | Reconhece os blocos e os campos do cabeçalho pelo template, decide as colunas pela posição (e pelos cabeçalhos de coluna, quando existem) e atribui confiança a cada campo. Nunca inventa valores. | `src/ocr/textParser.ts`, `src/ocr/parsing/` |
| Validar | Ecrã com todos os campos editáveis, linhas para adicionar/remover, a imagem original ao lado e o campo em foco assinalado nela. | `src/pages/PreviewPage.tsx`, `src/components/` |
| PDF | Reconstruído com pdf-lib a partir dos dados (não usa a imagem), no design do call sheet (logo, cliente/competição/jogo, PF e dia; à esquerda Equipa, Op. Câmara, Op. EVS, Op. Som, Ass. Som, Ass. Vídeo e Tec. VAR; e o Mapa de câmaras com o Local por cima; à direita Plano de Trabalho, Logística e Observações), com paginação. Logótipo Medialuso por omissão (`src/pdf/medialuso-logo.png`), que pode ser trocado por outro (PNG/JPG). O mapa de câmaras de cada jogo escolhe-se na página do PDF (PNG/JPG); se não couber na primeira página junto com as observações, as observações passam para a página seguinte. | `src/pdf/` |

### Confiança

| Nível | Limiar | No ecrã |
|---|---|---|
| Alta confiança | ≥ 0,90 | ponto verde |
| Confirmar | 0,70 – 0,89 | ponto e fundo amarelos |
| Não reconhecido | < 0,70 | ponto e fundo vermelhos |

Valores deduzidos do contexto (ex.: o número de uma câmara reposto pela sequência, ou um campo do cabeçalho sem rótulo reconhecido pela forma) ficam sempre em "Confirmar". Campos corrigidos pelo utilizador passam a "Editado".

### Formatos reconhecidos

O template `CALL SHEET — TEMPLATE 001` (`src/templates/callSheet001.ts`) define:

- **cabeçalho**: cliente, competição, jogo, PF, dia, data, local, meios, KO, montagem, ID, nº de elementos, faltam, LX, PT, saída/origem, observações e nota de rodapé (outros campos encontrados são preservados);
- **Equipa**: Produtor, Produtor Cliente, Realizador, Ass. Realização, Anotadora;
- **Técnica**: Chefe Técnico, CCU, Resp. Material, DSNG / RF, Cablecam;
- **listas**: Op. Câmara, Op. EVS, Op. Som, Ass. Som, Ass. Vídeo, Tec. VAR;
- **tabelas**: Plano de Trabalho (fase, hora, descrição, meios; começa sempre com Início da Montagem, Testes e Almoço, com horas calculadas do KO: 5 h antes, 3 h antes e 2 h 30 antes; e acaba com a hora prevista de desmontagem, KO + 90 min + 1 h, e de chegada ao armazém, 1 h 30 depois; tudo em "Confirmar") e Logística / Transportes (condutor, viatura, passageiros).

O parser aceita as disposições habituais, mesmo misturadas na mesma folha:

- título por cima das linhas ("Câmaras" e depois 1, 2, 3…);
- função na primeira coluna de cada linha ("EVS | nome | ok | Pt");
- função em todas as linhas ("Câm 1", "Câm 2"…);
- cargo e nome na mesma linha ("Produtor  NOME"), com blocos lado a lado;
- com ou sem grelha, com células coloridas e títulos claros sobre fundo escuro.

### Acrescentar um template

Criar um ficheiro em `src/templates/` com a mesma forma de `callSheet001.ts` (campos, blocos, colunas e os rótulos que os identificam) e registá-lo em `src/templates/index.ts`. A interface, o parser e o PDF são conduzidos pelo template.

## Deploy no Cloudflare Pages

### 1. Repositório no GitHub

```bash
git remote add origin git@github.com:<utilizador>/big-by-aleixo.git
git push -u origin main
```

### 2. Projeto no Cloudflare Pages

No painel do Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, escolher o repositório e configurar:

| Campo | Valor |
|---|---|
| Framework preset | None (ou Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(vazio)* |
| Variável de ambiente | `NODE_VERSION` = `22` |

Cada `git push` para `main` publica uma nova versão; os outros ramos geram pré-visualizações.

Alternativa sem GitHub, a partir do computador:

```bash
npm run build
npx wrangler pages deploy dist --project-name big-by-aleixo
```

Os ficheiros `public/_redirects` e `public/_headers` vão para `dist/` e são lidos pelo Cloudflare Pages:

- `_redirects` faz com que `/process`, `/preview` e `/pdf` funcionem ao recarregar a página;
- `_headers` aplica uma política de segurança (CSP) que só permite carregar recursos do próprio domínio, e cache longa para o motor de OCR.

Todos os ficheiros ficam abaixo do limite de 25 MB por ficheiro do Cloudflare Pages, e o plano gratuito chega.

### 3. Domínio BIGbyAleixo.pt

Os domínios são indiferentes a maiúsculas: `bigbyaleixo.pt` é o mesmo que `BIGbyAleixo.pt`.

1. No projeto do Pages: **Custom domains → Set up a custom domain** e indicar `bigbyaleixo.pt`. Repetir para `www.bigbyaleixo.pt`.
2. **Se o DNS do domínio estiver no Cloudflare** (recomendado): adicionar o domínio ao Cloudflare (**Add a site**, plano Free) e, no registo do domínio `.pt` (no registrar onde o domínio foi comprado, gerido pela DNS.PT), trocar os nameservers pelos dois que o Cloudflare indicar. Depois disso o Pages cria os registos DNS automaticamente.
3. **Se o DNS ficar noutro fornecedor**: criar um registo `CNAME` de `www` para `big-by-aleixo.pages.dev`. O domínio de raiz (`bigbyaleixo.pt`) só funciona como domínio personalizado do Pages com o DNS no Cloudflare, por isso a opção 2 é a mais simples.
4. Para que `www` encaminhe para o domínio principal: **Rules → Redirect Rules** com origem `www.bigbyaleixo.pt/*` e destino `https://bigbyaleixo.pt/${1}` (301).

O certificado HTTPS é emitido automaticamente pelo Cloudflare (pode demorar alguns minutos).

## Privacidade

- A imagem é lida em memória no browser e processada localmente (Canvas + WebAssembly). Não é enviada para servidor nenhum.
- "Guardar dados" grava apenas os dados estruturados no `sessionStorage` do separador; desaparecem ao fechá-lo. A imagem nunca é gravada. O logo escolhido também fica só no `sessionStorage`.
- Sem cookies, analytics nem tracking. A CSP impede pedidos a outros domínios.

## Limitações conhecidas (V1)

- O OCR é o Tesseract (gratuito e local). Lê bem capturas de ecrã e exportações de folhas de cálculo; fotografias tortas, desfocadas ou com pouca resolução dão mais campos para confirmar. A imagem deve estar direita.
- O PDF usa a fonte Barlow Condensed (licença SIL OFL, em `src/pdf/fonts/`), embutida no ficheiro.
- HEIC só é descodificado nos browsers que o suportam (Safari). No iPhone, "Definições → Câmara → Formatos → Mais compatível" grava em JPG.
- Anotações à mão por cima do texto podem estragar a leitura dessas palavras; ficam assinaladas para confirmar.
- Horas escritas só como "-" não são lidas.
- A pré-visualização do PDF usa o leitor do browser. Se não aparecer, o botão de descarga e o link "abrir num novo separador" funcionam sempre.
- Só o Call Sheet; o Running Order fica para uma versão futura.

## Estrutura

```
src/
  components/   UploadArea, ImagePreview, ProcessingProgress, ConfidenceBadge,
                EditableTable, SectionEditor, HeaderEditor, HeaderFields, LogoPicker,
                OriginalViewer, PdfPreview
  ocr/          ocrEngine, imagePreprocessor, tableDetector, textParser,
                annotations, pipeline, prepare (+ worker), parsing/ (geometria, cabeçalho, blocos)
  templates/    callSheet001, tipos e registo de templates
  pdf/          pdfGenerator, pdfStyles, fonts (Barlow Condensed, OFL)
  pages/        /, /process, /preview, /pdf
  state/        sessão (dados em memória e sessionStorage)
  types/        callSheet (modelo de dados)
  utils/        formatters, validators, fields, messages
tests/          testes automáticos (Vitest)
scripts/        copy-ocr-assets.mjs
public/         _headers, _redirects, favicon
```
