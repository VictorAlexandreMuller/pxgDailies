import { CommonModule } from '@angular/common';
import { Component, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PxgStoreService } from '../core/services/pxg-store.service';
import { clearActiveUser, getActiveUser, saveDb } from '../core/data/storage';
import { defaultTasks } from '../core/data/default-tasks';
import { currentKey } from '../core/utils/period-keys';
import { Character, PxgDbV1, Task, Period } from '../core/models/pxg-db.model';

@Component({
  selector: 'app-dailies',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dailies.html',
  styleUrl: './dailies.scss',
})
export class DailiesComponent {
  displayName = '';
  syncCode = '';
  db: PxgDbV1 | null = null;

  newCharacterName = '';

  importError = '';
  importing = false;

  readonly periods: Period[] = ['daily', 'weekly', 'monthly'];

  constructor(
    private readonly router: Router,
    private readonly store: PxgStoreService,
    private readonly destroyRef: DestroyRef
  ) {
    const active = getActiveUser();
    if (!active) {
      this.router.navigateByUrl('/enter');
      return;
    }

    this.displayName = active.name;
    this.syncCode = active.syncCode;

    const loaded = this.store.load(this.displayName, this.syncCode);
    if (!loaded) {
      this.router.navigateByUrl('/enter');
      return;
    }

    this.store.dbObs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((db) => (this.db = db));
  }

  periodLabel(period: Period): string {
    if (period === 'daily') return 'Diárias';
    if (period === 'weekly') return 'Semanais';
    return 'Mensais';
  }

  tasksOf(character: Character, period: Period): Task[] {
    return character.tasks.filter((t) => t.period === period);
  }

  isDoneNow(task: Task): boolean {
    return task.doneForKey === currentKey(task.period);
  }

  addCharacter(): void {
    const name = this.newCharacterName.trim();
    if (!name) return;

    this.store.update((db) => ({
      ...db,
      characters: [
        ...db.characters,
        {
          id: crypto.randomUUID(),
          name,
          createdAt: new Date().toISOString(),
          tasks: defaultTasks(),
        },
      ],
    }));

    this.newCharacterName = '';
  }

  removeCharacter(characterId: string): void {
    if (!this.db) return;
    const ok = confirm('Remover este boneco?');
    if (!ok) return;

    this.store.update((db) => ({
      ...db,
      characters: db.characters.filter((c) => c.id !== characterId),
    }));
  }

  toggleTask(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const key = currentKey(t.period);
            return { ...t, doneForKey: t.doneForKey === key ? undefined : key };
          }),
        };
      }),
    }));
  }

  resetTaskNow(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, doneForKey: undefined } : t)),
        };
      }),
    }));
  }

  exportJsonDownload(): void {
    if (!this.db) return;

    const blob = new Blob([JSON.stringify(this.db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const safeName = this.displayName.trim().replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `pxgDaily-${safeName}-${this.syncCode}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async exportJsonClipboard(): Promise<void> {
    if (!this.db) return;
    await navigator.clipboard.writeText(JSON.stringify(this.db, null, 2));
    alert('JSON copiado para a área de transferência.');
  }

  onImportFileSelected(evt: Event): void {
    this.importError = '';
    const input = evt.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importing = true;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '');
        const parsed = JSON.parse(raw) as PxgDbV1;

        if (!parsed || parsed.schemaVersion !== 1 || !parsed.profile || !Array.isArray(parsed.characters)) {
          throw new Error('Arquivo JSON inválido para o pxgDaily.');
        }

        saveDb(this.displayName, this.syncCode, parsed);

        this.store.load(this.displayName, this.syncCode);

        alert('Import concluído com sucesso.');
      } catch (e: any) {
        this.importError = e?.message ?? 'Falha ao importar.';
      } finally {
        this.importing = false;
        input.value = '';
      }
    };

    reader.onerror = () => {
      this.importError = 'Falha ao ler o arquivo.';
      this.importing = false;
      input.value = '';
    };

    reader.readAsText(file);
  }

  logout(): void {
    clearActiveUser();
    this.router.navigateByUrl('/enter');
  }
}
