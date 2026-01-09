import { Task } from '../models/pxg-db.model';

function make(period: Task['period'], title: string): Task {
  return { id: crypto.randomUUID(), period, title };
}

export function defaultTasks(): Task[] {
  return [
    make('daily', 'NW Falkner/Bruno/Lorelay'),
    make('daily', 'T1H Cosmic'),
    
    make('weekly', 'NW Misty'),

    make('monthly', 'Clones'),
  ];
}
