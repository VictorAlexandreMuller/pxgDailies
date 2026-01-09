import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { generateSyncCode } from '../core/utils/sync-code';
import { getActiveUser, loadDb, saveDb, setActiveUser } from '../core/data/storage';
import { PxgDbV1 } from '../core/models/pxg-db.model';

@Component({
  selector: 'app-enter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './enter.html',
  styleUrl: './enter.scss',
})
export class EnterComponent implements OnInit {
  displayName = '';
  syncCode = '';
  error = '';

  constructor(private readonly router: Router) {}

  ngOnInit(): void {
    // SSR-safe: no servidor getActiveUser() retorna null (por causa do isBrowser()).
    const active = getActiveUser();

    if (active) {
      // Preenche campos (caso o usuário caia no /enter manualmente)
      this.displayName = active.name;
      this.syncCode = active.syncCode;

      // ✅ auto-login: só redireciona se o DB existir para essa combinação
      const db = loadDb(active.name, active.syncCode);
      if (db) {
        this.router.navigateByUrl('/dailies');
      }
    }
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  generateNewCode(): void {
    this.syncCode = generateSyncCode(4);
    this.error = '';
  }

  async copyCode(): Promise<void> {
    if (!this.syncCode) return;
    await navigator.clipboard.writeText(this.normalizeCode(this.syncCode));
    alert('Sync Code copiado.');
  }

  enter(): void {
    this.error = '';

    const name = this.displayName.trim();
    const code = this.normalizeCode(this.syncCode);

    if (!name) {
      this.error = 'Informe seu nome.';
      return;
    }

    if (!code || code.length !== 4) {
      this.error = 'Informe o seu Sync Code (ou gere um).';
      return;
    }

    const existing = loadDb(name, code);

    if (existing) {
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

      saveDb(name, code, updated);
      setActiveUser(name, code);
      this.router.navigateByUrl('/dailies');
      return;
    }

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
}
