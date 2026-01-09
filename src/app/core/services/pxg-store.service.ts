import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { PxgDbV1 } from '../models/pxg-db.model';
import { loadDb, saveDb } from '../data/storage';

@Injectable({ providedIn: 'root' })
export class PxgStoreService {
  private activeName: string | null = null;
  private activeCode: string | null = null;

  private db$ = new BehaviorSubject<PxgDbV1 | null>(null);
  dbObs = this.db$.asObservable();

  setActive(name: string, syncCode: string, db: PxgDbV1) {
    this.activeName = name;
    this.activeCode = syncCode;
    this.db$.next(db);
    saveDb(name, syncCode, db);
  }

  load(name: string, syncCode: string): PxgDbV1 | null {
    const db = loadDb(name, syncCode);
    if (db) {
      this.activeName = name;
      this.activeCode = syncCode;
      this.db$.next(db);
    }
    return db;
  }

  update(mutator: (db: PxgDbV1) => PxgDbV1) {
    const current = this.db$.value;
    if (!current || !this.activeName || !this.activeCode) return;

    const updated: PxgDbV1 = {
      ...mutator(current),
      meta: {
        ...current.meta,
        updatedAt: new Date().toISOString(),
        revision: current.meta.revision + 1,
      },
    };

    this.db$.next(updated);
    saveDb(this.activeName, this.activeCode, updated);
  }
}
