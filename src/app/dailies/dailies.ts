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

  activeCharacterId: string | null = null;

  // ====== Focus Cooldown + Prompt ======
  private focusTimers = new Map<string, any>(); // taskId -> timeoutId
  private focusCooldownUntil = new Map<string, number>(); // taskId -> epoch ms

  focusPromptOpen = false;
  focusPromptTaskTitle = '';
  private focusPromptCharacterId: string | null = null;
  private focusPromptTaskId: string | null = null;

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

    this.store.dbObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((db) => {
      this.db = db;

      if (db?.characters?.length) {
        const exists = this.activeCharacterId
          ? db.characters.some((c) => c.id === this.activeCharacterId)
          : false;

        if (!exists) this.activeCharacterId = db.characters[0].id;
      } else {
        this.activeCharacterId = null;
      }
    });
  }

  get activeCharacter(): Character | null {
    if (!this.db || !this.activeCharacterId) return null;
    return this.db.characters.find((c) => c.id === this.activeCharacterId) ?? null;
  }

  selectCharacter(id: string): void {
    this.activeCharacterId = id;
    this.donePanelOpen = { daily: false, weekly: false, monthly: false };
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

  isDoingNow(task: Task): boolean {
    return task.doingForKey === currentKey(task.period);
  }

  addCharacter(): void {
    const name = this.newCharacterName.trim();
    if (!name) return;

    const newId = crypto.randomUUID();

    this.store.update((db) => ({
      ...db,
      characters: [
        ...db.characters,
        {
          id: newId,
          name,
          createdAt: new Date().toISOString(),
          tasks: defaultTasks(),
        },
      ],
    }));

    this.activeCharacterId = newId; // seleciona a aba nova
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

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '');
        const parsed = JSON.parse(raw) as PxgDbV1;

        if (
          !parsed ||
          parsed.schemaVersion !== 1 ||
          !parsed.profile ||
          !Array.isArray(parsed.characters)
        ) {
          throw new Error('Arquivo JSON inválido para o pxgDaily.');
        }

        saveDb(this.displayName, this.syncCode, parsed);

        this.store.load(this.displayName, this.syncCode);

        alert('Import concluído com sucesso.');
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

  logout(): void {
    clearActiveUser();
    this.router.navigateByUrl('/enter');
  }

  toggleDone(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const key = currentKey(t.period);
            const turningOn = t.doneForKey !== key;

            return {
              ...t,
              doneForKey: turningOn ? key : undefined,
              // se marcou DONE, tira DOING
              doingForKey: turningOn ? undefined : t.doingForKey,
            };
          }),
        };
      }),
    }));
  }

  toggleDoing(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const key = currentKey(t.period);
            const turningOn = t.doingForKey !== key;

            return {
              ...t,
              doingForKey: turningOn ? key : undefined,
              // se marcou DOING, tira DONE
              doneForKey: turningOn ? undefined : t.doneForKey,
            };
          }),
        };
      }),
    }));
  }

  editTask(characterId: string, taskId: string): void {
    const newTitle = prompt('Novo nome da task:');
    if (!newTitle) return;

    const title = newTitle.trim();
    if (!title) return;

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, title } : t)),
        };
      }),
    }));
  }

  deleteTask(characterId: string, taskId: string): void {
    const ok = confirm('Excluir esta task?');
    if (!ok) return;

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;
        return { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) };
      }),
    }));
  }

  addTask(characterId: string, period: Period): void {
    const title = prompt(`Nome da task (${this.periodLabel(period)}):`)?.trim();
    if (!title) return;

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: [...c.tasks, { id: crypto.randomUUID(), title, period }],
        };
      }),
    }));
  }

  donePanelOpen: Record<Period, boolean> = {
    daily: false,
    weekly: false,
    monthly: false,
  };

  toggleDonePanel(period: Period): void {
    this.donePanelOpen[period] = !this.donePanelOpen[period];
  }

  doneTasksOfPeriod(character: Character, period: Period): Task[] {
    return character.tasks.filter((t) => t.period === period && this.isDoneNow(t));
  }

  openTasksOf(character: Character, period: Period): Task[] {
    return character.tasks.filter((t) => t.period === period && !this.isDoneNow(t));
  }

  isFocusCoolingDown(taskId: string): boolean {
    const until = this.focusCooldownUntil.get(taskId);
    if (!until) return false;
    return Date.now() < until;
  }

  focusCooldownLeft(taskId: string): number {
    const until = this.focusCooldownUntil.get(taskId) ?? 0;
    const leftMs = until - Date.now();
    return Math.max(0, Math.ceil(leftMs / 1000));
  }

  startFocusCooldown(characterId: string, task: Task): void {
    // não permite iniciar cooldown se já estiver done
    if (this.isDoneNow(task)) return;

    // se já estiver em cooldown, ignora
    if (this.isFocusCoolingDown(task.id)) return;

    // liga o DOING imediatamente (mantém o comportamento atual)
    this.toggleDoing(characterId, task.id);

    // marca cooldown de 60s
    const until = Date.now() + 60_000;
    this.focusCooldownUntil.set(task.id, until);

    // limpa timer anterior se existir
    const existing = this.focusTimers.get(task.id);
    if (existing) clearTimeout(existing);

    // agenda o prompt após 1 minuto
    const timeoutId = setTimeout(() => {
      // encerrou o cooldown
      this.focusCooldownUntil.delete(task.id);
      this.focusTimers.delete(task.id);

      // abre prompt na tela
      this.focusPromptOpen = true;
      this.focusPromptTaskTitle = task.title;
      this.focusPromptCharacterId = characterId;
      this.focusPromptTaskId = task.id;
    }, 60_000);

    this.focusTimers.set(task.id, timeoutId);
  }

  confirmFocusResult(didFinish: boolean): void {
    const characterId = this.focusPromptCharacterId;
    const taskId = this.focusPromptTaskId;

    // fecha modal
    this.focusPromptOpen = false;

    // se perdeu referência, sai
    if (!characterId || !taskId) {
      this.focusPromptTaskTitle = '';
      this.focusPromptCharacterId = null;
      this.focusPromptTaskId = null;
      return;
    }

    if (didFinish) {
      // marca como DONE
      this.toggleDone(characterId, taskId);
    } else {
      // opcional: se NÃO concluiu, tirar DOING para "liberar" visualmente
      // (se você preferir manter DOING, basta remover esta linha)
      this.toggleDoing(characterId, taskId);
    }

    // limpa referência
    this.focusPromptTaskTitle = '';
    this.focusPromptCharacterId = null;
    this.focusPromptTaskId = null;
  }
}
