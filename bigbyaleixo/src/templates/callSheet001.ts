import type { CallSheetTemplate, ColumnDef, SectionDef } from './types';

/*
 * CALL SHEET — TEMPLATE 001
 *
 * Baseado no call sheet de produção broadcast fornecido pelo utilizador.
 * Todos os rótulos estão na forma normalizada usada pelo parser: minúsculas,
 * sem acentos e sem pontuação ("Ass. Realização" → "ass realizacao").
 */

const NUMBER: ColumnDef = { key: 'number', label: 'Nº', aliases: ['n', 'no', 'num', 'numero', '#', 'cam', 'pos'], align: 'center', weight: 0.8 };
const NAME: ColumnDef = { key: 'name', label: 'Nome', aliases: ['nome', 'nomes', 'operador', 'elemento'], align: 'left', weight: 4 };
const STATUS: ColumnDef = { key: 'status', label: 'Estado', aliases: ['estado', 'ok', 'conf', 'confirmado', 'confirmacao', 'status'], align: 'center', weight: 1.1 };
const TRANS_PK: ColumnDef = {
  key: 'transPk',
  label: 'Trans/Pk',
  aliases: ['trans pk', 'transpk', 'trans', 'pk', 't pk', 'transporte', 'transp', 'parque'],
  align: 'center',
  weight: 1.3,
};
const LOCATION: ColumnDef = { key: 'location', label: 'Local', aliases: ['local', 'base'], align: 'center', weight: 1.1 };

const PERSON_COLUMNS = [NAME, STATUS, LOCATION];
const CAMERA_COLUMNS = [NUMBER, NAME, STATUS, TRANS_PK, LOCATION];

const role = (key: SectionDef['key'], group: string, title: string, roleLabel: string, aliases: string[]): SectionDef => ({
  key,
  title,
  roleLabel,
  group,
  layout: 'role',
  aliases,
  columns: PERSON_COLUMNS,
});

const list = (key: SectionDef['key'], title: string, aliases: string[]): SectionDef => ({ key, title, layout: 'list', aliases, columns: PERSON_COLUMNS });

export const callSheet001: CallSheetTemplate = {
  id: 'CALL_SHEET_001',
  name: 'CALL SHEET — TEMPLATE 001',

  headerFields: [
    { key: 'client', label: 'Cliente / Canal', aliases: ['cliente', 'canal', 'broadcaster', 'operador'], kind: 'text', group: 'title' },
    { key: 'competition', label: 'Competição', aliases: ['competicao', 'prova', 'campeonato', 'liga'], kind: 'text', group: 'title' },
    { key: 'event', label: 'Evento / Jogo', aliases: ['evento', 'jogo', 'programa'], kind: 'text', group: 'title' },
    { key: 'pf', label: 'PF', aliases: ['pf'], kind: 'code', group: 'title' },
    { key: 'day', label: 'Dia', aliases: ['dia'], kind: 'date', group: 'title' },
    { key: 'date', label: 'Data', aliases: ['data', 'data dia', 'data do jogo'], kind: 'date', group: 'info' },
    { key: 'location', label: 'Local', aliases: ['local', 'localizacao', 'recinto'], kind: 'place', group: 'info' },
    { key: 'means', label: 'Meios', aliases: ['meios', 'meio', 'unidade movel', 'um'], kind: 'text', group: 'info' },
    { key: 'kickoff', label: 'KO', aliases: ['ko', 'k0', 'kick off', 'kickoff', 'hora do jogo', 'inicio'], kind: 'time', group: 'info' },
    { key: 'setup', label: 'Modelo', aliases: ['modelo', 'setup', 'configuracao'], kind: 'text', group: 'info' },
    { key: 'id', label: 'ID', aliases: ['id'], kind: 'code', group: 'info' },
    {
      key: 'crew',
      label: 'Nº de elementos',
      aliases: ['n elementos', 'n de elementos', 'no elementos', 'no de elementos', 'numero de elementos', 'num elementos', 'elementos'],
      kind: 'count',
      group: 'info',
    },
    { key: 'missing', label: 'Faltam', aliases: ['faltam', 'falta', 'em falta'], kind: 'count', group: 'info' },
    { key: 'lx', label: 'LX', aliases: ['lx', 'lisboa'], kind: 'count', group: 'info' },
    { key: 'pt', label: 'PT', aliases: ['pt', 'porto'], kind: 'count', group: 'info' },
    { key: 'departure', label: 'Saída', aliases: ['saida', 'hora de saida', 'partida'], kind: 'time', group: 'logistics' },
    { key: 'origin', label: 'De', aliases: ['de', 'origem', 'partida de'], kind: 'place', group: 'logistics' },
    { key: 'notes', label: 'Observações', aliases: ['observacoes', 'observacao', 'obs', 'notas'], kind: 'note', group: 'notes' },
    { key: 'footer', label: 'Nota de rodapé', aliases: ['nota', 'nota final'], kind: 'note', group: 'notes' },
  ],

  groups: [
    { key: 'team', title: 'EQUIPA' },
    { key: 'technical', title: 'TÉCNICA' },
  ],

  sections: [
    role('production', 'team', 'PRODUÇÃO', 'Produtor', ['producao', 'produtor', 'produtora', 'produtores', 'dir producao', 'chefe de producao']),
    role('clientProducer', 'team', 'PRODUTOR CLIENTE', 'Produtor Cliente', ['produtor cliente', 'produtora cliente', 'producao cliente', 'prod cliente']),
    role('realization', 'team', 'REALIZAÇÃO', 'Realizador', ['realizacao', 'realizador', 'realizadora']),
    role('assistantRealization', 'team', 'ASS. REALIZAÇÃO', 'Ass. Realização', [
      'ass realizacao',
      'assistente de realizacao',
      'assistente realizacao',
      'assist realizacao',
      'ass real',
    ]),
    role('anotadora', 'team', 'ANOTADORA', 'Anotadora', ['anotadora', 'anotador', 'anotadoras']),
    role('technicalManagers', 'technical', 'CHEFE TÉCNICO', 'Chefe Técnico', ['chefe tecnico', 'chefes tecnicos', 'chefia tecnica', 'ch tecnico', 'responsavel tecnico']),
    role('ccu', 'technical', 'CCU', 'CCU', ['ccu', 'op ccu', 'controlo de camaras', 'controlo de imagem']),
    role('materialManagers', 'technical', 'RESP. MATERIAL', 'Resp. Material', ['resp material', 'responsavel material', 'responsavel de material', 'resp de material', 'resp mat']),
    role('dsngRf', 'technical', 'DSNG / RF', 'DSNG / RF', ['dsng rf', 'dsng', 'dsngrf', 'dsng e rf', 'sng']),
    role('cablecam', 'technical', 'CABLECAM', 'Cablecam', ['cablecam', 'cable cam', 'cabocam']),
    { key: 'cameras', title: 'Op. Câmara', layout: 'list', aliases: ['camaras', 'camara', 'cameras', 'camera', 'op camara', 'operadores de camara', 'cam'], columns: CAMERA_COLUMNS },
    list('evs', 'Op. EVS', ['evs', 'op evs', 'operador evs', 'operadores evs']),
    list('soundOperators', 'Op. Som', ['op som', 'operador de som', 'operadores de som', 'operador som', 'op de som']),
    list('soundAssistants', 'Ass. Som', ['ass som', 'assistente de som', 'assistentes de som', 'assistente som', 'ass de som']),
    list('videoAssistants', 'Ass. Vídeo', ['ass video', 'assistente de video', 'assistentes de video', 'assistente video', 'ass de video']),
    list('varTechnicians', 'Tec. VAR', ['tec var', 'tecnico var', 'tecnicos var', 'var']),
    {
      key: 'workPlan',
      title: 'PLANO DE TRABALHO',
      layout: 'table',
      aliases: ['plano de trabalho', 'plano trabalho', 'plano'],
      columns: [
        { key: 'phase', label: 'Fase', aliases: ['fase'], align: 'left', weight: 1.4 },
        { key: 'time', label: 'Hora', aliases: ['hora', 'horas'], align: 'left', weight: 0.9 },
        { key: 'description', label: 'Descrição', aliases: ['descricao'], align: 'left', weight: 5 },
        { key: 'means', label: 'Meios / Obs.', aliases: ['meios obs', 'meios', 'obs'], align: 'left', weight: 1.4 },
      ],
      // Antes do pré-jogo. A hora fica por preencher: só entra a que vier do documento ou do utilizador.
      fixedRows: [
        { values: { description: 'Início da Montagem' }, aliases: ['inicio da montagem', 'inicio montagem', 'montagem']},
        { values: { description: 'Testes' }, aliases: ['testes', 'teste']},
        { values: { description: 'Almoço' }, aliases: ['almoco']},
        // No fim do pós-jogo (hora por preencher).
        {
          values: { description: 'Hora prevista de desmontagem' },
          aliases: ['hora prevista de desmontagem', 'desmontagem', 'inicio da desmontagem'],
          position: 'end',
        },
        {
          values: { description: 'Hora prevista de chegada ao armazém' },
          aliases: ['hora prevista de chegada ao armazem', 'chegada ao armazem', 'chegada armazem', 'hora prevista de chegada armazem'],
          position: 'end',
        },
      ],
    },
    {
      key: 'drivers',
      title: 'LOGÍSTICA / TRANSPORTES',
      layout: 'table',
      aliases: ['logistica transportes', 'logistica', 'transportes', 'condutores', 'motoristas'],
      columns: [
        { key: 'name', label: 'Condutor', aliases: ['condutor', 'condutores', 'motorista'], align: 'left', weight: 2 },
        { key: 'vehicle', label: 'Viatura', aliases: ['viatura', 'viaturas', 'carro', 'veiculo'], align: 'left', weight: 2.1 },
        { key: 'passengers', label: 'Passageiros', aliases: ['passageiros', 'passageiro'], align: 'left', weight: 3.1 },
      ],
    },
  ],

  numberedRoleSection: 'cameras',
  roleColumnAliases: ['funcao', 'funcoes', 'posicao', 'cargo'],

  vocabulary: {
    status: ['ok', 'sim', 'nao', 'conf', 'confirmado', 'pendente', 'aguarda', 'x', '?', 's', 'n'],
    transPk: ['trans', 'pk', 'transporte', 'parque', 'boleia', 'comboio', 'aviao'],
    location: ['lx', 'pt', 'lisboa', 'porto'],
  },

  genericTitles: ['call sheet', 'callsheet', 'folha de servico', 'equipa tecnica', 'mapa de equipa', 'equipa', 'tecnica', 'convocatoria'],
};
