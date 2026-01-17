import { Task } from '../models/pxg-db.model';

function make(period: Task['period'], title: string): Task {
  return { id: crypto.randomUUID(), period, title, origin: 'system' };
}

// Exporta as assinaturas para migração (period + title)
export const DEFAULT_TASK_SIGNATURES = [
  ['daily', 'NW Falkner/Bruno'],
  ['daily', 'NW Mite'],
  ['daily', 'NW Lance'],
  ['daily', 'NW T1H Cosmic'],
  ['daily', 'NW T1H Desert'],
  ['daily', 'NW Brotherhood'],
  ['daily', 'NW Jenny'],
  ['daily', 'NW Yellow Parachute'],
  ['daily', 'NW Sidis S-3'],
  ['daily', 'Jenny Kill'],
  ['daily', 'Daily Caught 1'],
  ['daily', 'Daily Caught 2'],
  ['daily', 'Daily DZ'],
  ['daily', 'Johto - Shiny Bellsprout'],
  ['daily', 'BH Kanto'],
  ['daily', 'BH Johto'],
  ['daily', 'MissingNo'],
  ['daily', '2000 Eleanor'],
  ['daily', '2000 Fawkes'],

  ['weekly', 'Cão Lendário'],
  ['weekly', 'Lavender Curse'],
  ['weekly', 'Shiny Giant Tentacruel'],
  ['weekly', 'NW Lorelay'],
  ['weekly', 'NW Misty'],
  ['weekly', 'NW Barry'],
  ['weekly', 'NW Zedd'],
  ['weekly', 'NW Subject'],
  ['weekly', 'Battle Factory'],
  ['weekly', 'Embedded Tower'],
  ['weekly', 'Terror Machamp'],
  ['weekly', 'Terror Blastoise'],
  ['weekly', 'Terror Aerodactyl'],
  ['weekly', 'Terror Venusaur'],
  ['weekly', 'Terror Charizard'],
  ['weekly', 'Terror Electabuzz'],
  ['weekly', 'Terror Gyarados'],
  ['weekly', 'Terror Gengar/Alaka'],
  ['weekly', 'Terror Zoroark'],
  ['weekly', 'Turnback Cave'],

  ['monthly', 'Clones'],
  ['monthly', 'NW Secret Lab'],
] as const;

export function defaultTasks(): Task[] {
  return DEFAULT_TASK_SIGNATURES.map(([period, title]) => make(period, title));
}
