import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { generateSyncCode } from '../core/utils/sync-code';
import { findLatestDbByName, getActiveUser, loadDb, saveDb, setActiveUser } from '../core/data/storage';
import { PxgDbV1 } from '../core/models/pxg-db.model';
import { PxgExportV1 } from '../core/models/pxg-export.model';

@Component({
  selector: 'app-enter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './enter.html',
  styleUrl: './enter.scss',
})
export class EnterComponent implements OnInit {
  displayName = '';
  error = '';
  importError = '';

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    const active = getActiveUser();

    if (active) {
      const db = loadDb(active.name, active.syncCode);
      if (db) {
        this.displayName = active.name;
        this.router.navigateByUrl('/dailies');
      }
    }
  }

  canExport(): boolean {
    const active = getActiveUser();
    if (!active) return false;
    const db = loadDb(active.name, active.syncCode);
    return !!db;
  }

  enter(): void {
    this.error = '';

    const name = this.displayName.trim();
    if (!name) {
      this.error = 'Informe seu nome.';
      return;
    }

    const found = findLatestDbByName(name);
    if (found?.db && found?.syncCode) {
      const existing = found.db as PxgDbV1;

      const updated: PxgDbV1 = {
        ...existing,
        profile: {
          ...existing.profile,
          displayName: name,
          lastOpenAt: new Date().toISOString(),
        },
        meta: {
          ...existing.meta,
          updatedAt: new Date().toISOString(),
          revision: (existing.meta?.revision ?? 0) + 1,
        },
      };

      saveDb(name, found.syncCode, updated);
      setActiveUser(name, found.syncCode);
      this.router.navigateByUrl('/dailies');
      return;
    }

    const code = generateSyncCode(4);
    const now = new Date().toISOString();

    const fresh: PxgDbV1 = {
      schemaVersion: 1,
      profile: {
        displayName: name,
        createdAt: now,
        lastOpenAt: now,
      },
      meta: {
        updatedAt: now,
        revision: 0,
      },
      characters: [],
    };

    saveDb(name, code, fresh);
    setActiveUser(name, code);
    this.router.navigateByUrl('/dailies');
  }

  exportJsonDownload(): void {
    this.error = '';

    const active = getActiveUser();
    if (!active) {
      this.error = 'Nenhum usuário ativo para exportar.';
      return;
    }

    const db = loadDb(active.name, active.syncCode) as PxgDbV1 | null;
    if (!db) {
      this.error = 'Não foi possível localizar os dados para exportar.';
      return;
    }

    const payload: PxgExportV1 = {
      exportVersion: 1,
      syncCode: active.syncCode,
      db,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const safeName = active.name.trim().replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `pxgDaily-${safeName}-${active.syncCode}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  onImportFileSelected(evt: Event): void {
    this.importError = '';
    this.error = '';

    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '');
        const parsed = JSON.parse(raw);

        let db: PxgDbV1;
        let syncCode: string;

        if (parsed?.exportVersion === 1 && parsed?.db && typeof parsed?.syncCode === 'string') {
          const p = parsed as PxgExportV1;
          db = p.db;
          syncCode = String(p.syncCode || '').trim().toUpperCase();
        } else {
          db = parsed as PxgDbV1;
          syncCode = generateSyncCode(4);
        }

        if (!db || db.schemaVersion !== 1 || !db.profile || !Array.isArray(db.characters)) {
          throw new Error('Arquivo JSON inválido para o PXG Dailies.');
        }

        const name = String(db.profile.displayName ?? '').trim();
        if (!name) throw new Error('Arquivo inválido: displayName ausente.');

        saveDb(name, syncCode, db);
        setActiveUser(name, syncCode);

        this.router.navigateByUrl('/dailies');
      } catch (e: any) {
        this.importError = e?.message ?? 'Falha ao importar.';
      } finally {
        input.value = '';
      }
    };

    reader.onerror = () => {
      this.importError = 'Falha ao ler o arquivo.';
      input.value = '';
    };

    reader.readAsText(file);
  }
}
