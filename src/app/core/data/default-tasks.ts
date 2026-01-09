import { Task } from '../models/pxg-db.model';

export function defaultTasks(): Task[] {
  return [
    { id: crypto.randomUUID(), title: 'Daily 1', period: 'daily' },
    { id: crypto.randomUUID(), title: 'Weekly 1', period: 'weekly' },
    { id: crypto.randomUUID(), title: 'Monthly 1', period: 'monthly' },
  ];
}