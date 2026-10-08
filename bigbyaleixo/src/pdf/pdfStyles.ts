/** Medidas, cores e tamanhos do PDF. Tudo em pontos (1 pt = 1/72 de polegada). */

export const PAGE = {
  /** A4 ao alto. */
  width: 595.28,
  height: 841.89,
  marginX: 28,
  marginTop: 22,
  marginBottom: 30,
};

export const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;

export type Rgb = [number, number, number];

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255];

export const COLOR = {
  /** Títulos dos blocos. */
  red: hex('#e93423'),
  /** Fundo das barras de fase e da caixa de observações. */
  blush: hex('#faeaeb'),
  /** Rótulos (cargos, "Data:", cabeçalhos de colunas). */
  ink: hex('#000000'),
  /** Valores (nomes, datas, locais). */
  navy: hex('#31375b'),
  /** Linhas de separação e texto secundário. */
  rule: hex('#9a9aa6'),
  muted: hex('#6b6f86'),
  paper: hex('#ffffff'),
};

export const SIZE = {
  client: 12.5,
  competition: 29,
  event: 19,
  pf: 37,
  day: 15,
  info: 11.5,
  heading: 17,
  /** Títulos das listas (Câmaras, EVS, …). */
  subheading: 11,
  phase: 10.5,
  body: 11,
  /** Tabela de logística (colunas estreitas). */
  table: 10.2,
  columnHeader: 11,
  footer: 10.5,
  credit: 7,
};

export const SPACE = {
  /** Altura do bloco de cabeçalho (logo, títulos, PF). */
  mastheadHeight: 68,
  logoWidth: 108,
  /** Largura da zona do PF, à direita. */
  pfWidth: 104,
  /** Altura de uma linha de dados. */
  row: 14.6,
  /** Espaço por baixo de um título de bloco. */
  headingGap: 4,
  /** Entre blocos, na vertical. */
  blockGap: 11,
  /** Entre as listas da equipa (Op. Câmara, Op. EVS, …). */
  tightGap: 2,
  /** Entre colunas. */
  columnGap: 18,
  /** Entrelinha do texto que parte em várias linhas. */
  lineHeight: 1.18,
  /** Altura mínima da caixa de observações. */
  notesMinHeight: 48,
  /** Altura máxima do mapa de câmaras. */
  cameraMapMaxHeight: 125,
  /** Abaixo disto o mapa deixa de se ler: passa para a página seguinte. */
  cameraMapMinHeight: 105,
};
