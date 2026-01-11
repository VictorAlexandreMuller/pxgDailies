import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CountdownComponent, CountdownEvent } from 'ngx-countdown';
import { DateTime } from 'luxon';
import { PxgStoreService } from '../core/services/pxg-store.service';
import { clearActiveUser, getActiveUser, saveDb } from '../core/data/storage';
import { DEFAULT_TASK_SIGNATURES, defaultTasks } from '../core/data/default-tasks';
import { currentKey } from '../core/utils/period-keys';
import { Character, PxgDbV1, Task, Period } from '../core/models/pxg-db.model';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PxgExportV1 } from '../core/models/pxg-export.model';

@Component({
  selector: 'app-dailies',
  standalone: true,
  imports: [CommonModule, FormsModule, CountdownComponent, DragDropModule],
  templateUrl: './dailies.html',
  styleUrl: './dailies.scss',
})
export class DailiesComponent implements OnDestroy {
  displayName = '';
  syncCode = '';
  db: PxgDbV1 | null = null;
  archivedModalOpen = false;
  newCharacterName = '';

  activeCharacterId: string | null = null;

  readonly periods: Period[] = ['daily', 'weekly', 'monthly'];

  donePanelOpen: Record<Period, boolean> = {
    daily: false,
    weekly: false,
    monthly: false,
  };

  // ===== Focus (cooldown) =====
  readonly FOCUS_SECONDS = 60 * 60;
  private focusConfigs = new Map<string, any>();
  private focusCooling = new Set<string>();

  focusPromptOpen = false;
  focusPromptTaskTitle = '';
  private focusPromptCharacterId: string | null = null;
  private focusPromptTaskId: string | null = null;

  // ===== Reset Engine =====
  private readonly TZ = 'America/Sao_Paulo';
  private readonly RESET_HOUR = 7;
  private readonly RESET_MINUTE = 40;
  private resetTicker: ReturnType<typeof setInterval> | null = null;

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

      this.migrateTaskOriginsIfNeeded();
      this.applyResetsIfNeeded();
    });

    // Também roda de tempos em tempos (se o app ficar aberto atravessando o horário)
    this.resetTicker = setInterval(() => {
      this.applyResetsIfNeeded();
    }, 60_000); // 1 minuto
  }

  ngOnDestroy(): void {
    if (this.resetTicker) {
      clearInterval(this.resetTicker);
      this.resetTicker = null;
    }
  }

  // ===== Getters / seleção =====
  get activeCharacter(): Character | null {
    if (!this.db || !this.activeCharacterId) return null;
    return this.db.characters.find((c) => c.id === this.activeCharacterId) ?? null;
  }

  selectCharacter(id: string): void {
    this.activeCharacterId = id;
    this.donePanelOpen = { daily: false, weekly: false, monthly: false };
  }

  // ===== Labels / queries =====
  periodLabel(period: Period): string {
    if (period === 'daily') return 'Diárias';
    if (period === 'weekly') return 'Semanais';
    return 'Mensais';
  }

  tasksOf(character: Character, period: Period): Task[] {
    return character.tasks.filter((t) => t.period === period && !t.archivedAt);
  }

  /**
   * DONE real agora passa a ser definido por:
   * - se existe resetAt
   * - e se "agora" (BRT) ainda é antes de resetAt
   */
  isDoneNow(task: Task): boolean {
    if (!task.resetAt) return false;

    const now = DateTime.now().setZone(this.TZ);
    const resetAt = DateTime.fromISO(task.resetAt, { zone: this.TZ });

    // Se já passou do resetAt, não é done mais
    return resetAt.isValid ? now < resetAt : false;
  }

  isDoingNow(task: Task): boolean {
    return task.doingForKey === currentKey(task.period);
  }

  doneTasksOfPeriod(character: Character, period: Period): Task[] {
    return character.tasks.filter((t) => t.period === period && !t.archivedAt && this.isDoneNow(t));
  }

  openTasksOf(character: Character, period: Period): Task[] {
    return character.tasks.filter(
      (t) => t.period === period && !t.archivedAt && !this.isDoneNow(t)
    );
  }

  // ===== Personagens =====
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

    this.activeCharacterId = newId;
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

  // ===== Export / Import / Logout =====
  exportJsonDownload(): void {
    if (!this.db) return;

    const payload: PxgExportV1 = {
      exportVersion: 1,
      syncCode: this.syncCode,
      db: this.db,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
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

  logout(): void {
    clearActiveUser();
    this.router.navigateByUrl('/enter');
  }

  // ===== Tasks CRUD =====
  addTask(characterId: string, period: Period): void {
    const title = prompt(`Nome da task (${this.periodLabel(period)}):`)?.trim();
    if (!title) return;

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;
        return {
          ...c,
          tasks: [...c.tasks, { id: crypto.randomUUID(), title, period, origin: 'user' }],
        };
      }),
    }));
  }

  editTask(characterId: string, taskId: string): void {
    if (!this.db) return;

    const character = this.db.characters.find((c) => c.id === characterId);
    const task = character?.tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (!this.canRename(task)) {
      alert('Esta task é padrão do sistema e não pode ser renomeada.');
      return;
    }

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

  // ===== Done / Doing =====
  toggleDone(characterId: string, taskId: string): void {
    this.cancelFocus(taskId);

    const now = DateTime.now().setZone(this.TZ);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;

            // Se estava done e o usuário clicou, ele está desmarcando manualmente:
            const currentlyDone = this.isDoneNow(t);

            if (currentlyDone) {
              return {
                ...t,
                doneForKey: undefined,
                doingForKey: undefined,
                doneAt: undefined,
                resetAt: undefined,
              };
            }

            // Marcando como concluída agora:
            const resetAtDt = this.computeResetAt(t, now);

            // IMPORTANTÍSSIMO: Luxon toISO() é string | null -> normaliza para undefined
            const doneAtIso = now.toISO() ?? undefined;
            const resetAtIso = resetAtDt.toISO() ?? undefined;

            return {
              ...t,
              doneForKey: currentKey(t.period),
              doingForKey: undefined,
              doneAt: doneAtIso,
              resetAt: resetAtIso,
            };
          }),
        };
      }),
    }));
  }

  toggleDonePanel(period: Period): void {
    this.donePanelOpen[period] = !this.donePanelOpen[period];
  }

  // ===== Focus (ngx-countdown) =====
  isFocusCoolingDown(taskId: string): boolean {
    return this.focusCooling.has(taskId);
  }

  focusConfig(taskId: string): any {
    let cfg = this.focusConfigs.get(taskId);
    if (!cfg) {
      cfg = { leftTime: this.FOCUS_SECONDS, format: 'HH:mm:ss' };
      this.focusConfigs.set(taskId, cfg);
    }
    return cfg;
  }

  startFocusCooldown(characterId: string, task: Task): void {
    if (this.isDoneNow(task)) return;
    if (this.isFocusCoolingDown(task.id)) return;

    this.setDoingOn(characterId, task.id);

    this.focusConfigs.set(task.id, { leftTime: this.FOCUS_SECONDS, format: 'HH:mm:ss' });
    this.focusCooling.add(task.id);
  }

  onFocusCountdownEvent(e: CountdownEvent, characterId: string, task: Task): void {
    if (e.action !== 'done') return;

    // Se durante o timer a task foi marcada como concluída, cancela o fluxo
    if (this.isDoneNow(task)) {
      this.cancelFocus(task.id);
      return;
    }

    this.focusCooling.delete(task.id);

    this.focusPromptOpen = true;
    this.focusPromptTaskTitle = task.title;
    this.focusPromptCharacterId = characterId;
    this.focusPromptTaskId = task.id;
  }

  confirmFocusResult(didFinish: boolean): void {
    const characterId = this.focusPromptCharacterId;
    const taskId = this.focusPromptTaskId;

    this.focusPromptOpen = false;
    this.focusPromptTaskTitle = '';
    this.focusPromptCharacterId = null;
    this.focusPromptTaskId = null;

    if (!characterId || !taskId) return;

    if (didFinish) {
      this.toggleDone(characterId, taskId);
    } else {
      this.setDoingOff(characterId, taskId);
    }
  }

  /** Helpers para evitar estados errados */
  private setDoingOn(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const key = currentKey(t.period);
            return { ...t, doingForKey: key };
          }),
        };
      }),
    }));
  }

  private setDoingOff(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, doingForKey: undefined } : t)),
        };
      }),
    }));
  }

  noDoneMessage(period: Period): string {
    if (period === 'daily') return 'Não há Tasks Diárias concluídas.';
    if (period === 'weekly') return 'Não há Tasks Semanais concluídas.';
    return 'Não há Tasks Mensais concluídas.';
  }

  private cancelFocus(taskId: string): void {
    this.focusCooling.delete(taskId);
    this.focusConfigs.delete(taskId);

    if (this.focusPromptOpen && this.focusPromptTaskId === taskId) {
      this.focusPromptOpen = false;
      this.focusPromptTaskTitle = '';
      this.focusPromptCharacterId = null;
      this.focusPromptTaskId = null;
    }
  }

  // ======================================================================================
  //                                   RESET RULES (Luxon)
  // ======================================================================================

  /**
   * Aplica os resets expirados, voltando tasks para "abertas" quando now >= resetAt.
   * Roda:
   * - quando dbObs emite
   * - a cada 60 segundos (app aberto)
   */
  private applyResetsIfNeeded(): void {
    if (!this.db) return;

    const now = DateTime.now().setZone(this.TZ);

    let changed = false;

    const nextCharacters = this.db.characters.map((c) => {
      const nextTasks = c.tasks.map((t) => {
        if (!t.resetAt) return t;

        const resetAt = DateTime.fromISO(t.resetAt, { zone: this.TZ });

        // se resetAt inválido, limpa por segurança
        if (!resetAt.isValid) {
          changed = true;
          return {
            ...t,
            doneForKey: undefined,
            doingForKey: undefined,
            doneAt: undefined,
            resetAt: undefined,
          };
        }

        // expirou: limpa estado de done
        if (now >= resetAt) {
          changed = true;
          return {
            ...t,
            doneForKey: undefined,
            doingForKey: undefined,
            doneAt: undefined,
            resetAt: undefined,
          };
        }

        return t;
      });

      return { ...c, tasks: nextTasks };
    });

    if (changed) {
      this.store.update((db) => ({
        ...db,
        characters: nextCharacters,
      }));
    }
  }

  /**
   * Calcula o resetAt conforme suas regras.
   * Entrada: a task que está sendo marcada + "agora" em BRT.
   */
  private computeResetAt(task: Task, nowBrt: DateTime): DateTime {
    if (task.period === 'daily') {
      // amanhã 07:40 BRT
      return nowBrt
        .plus({ days: 1 })
        .set({ hour: this.RESET_HOUR, minute: this.RESET_MINUTE, second: 0, millisecond: 0 });
    }

    if (task.period === 'weekly') {
      // PRÓXIMA segunda às 07:40 (sempre na semana seguinte)
      const nextWeekStart = nowBrt.plus({ weeks: 1 }).startOf('week'); // segunda 00:00
      return nextWeekStart.set({
        hour: this.RESET_HOUR,
        minute: this.RESET_MINUTE,
        second: 0,
        millisecond: 0,
      });
    }

    // monthly
    const title = (task.title ?? '').trim().toLowerCase();
    if (title === 'clones') {
      // 30 dias a partir de quando marcou (mantém o horário exato da marcação)
      return nowBrt.plus({ days: 30 });
    }

    // 1º dia do mês seguinte às 07:40 BRT
    return nowBrt
      .plus({ months: 1 })
      .startOf('month')
      .set({ hour: this.RESET_HOUR, minute: this.RESET_MINUTE, second: 0, millisecond: 0 });
  }

  canRename(task: Task): boolean {
    return task.origin === 'user';
  }

  private migrateTaskOriginsIfNeeded(): void {
    if (!this.db) return;

    const signatureSet = new Set(
      DEFAULT_TASK_SIGNATURES.map(([period, title]) => `${period}::${title.trim().toLowerCase()}`)
    );

    let changed = false;

    const nextCharacters = this.db.characters.map((c) => {
      const nextTasks = c.tasks.map((t) => {
        if (t.origin) return t;

        const sig = `${t.period}::${(t.title ?? '').trim().toLowerCase()}`;
        const origin: Task['origin'] = signatureSet.has(sig) ? 'system' : 'user';

        changed = true;

        return { ...t, origin };
      });

      return { ...c, tasks: nextTasks };
    });

    if (changed) {
      this.store.update((db) => ({
        ...db,
        characters: nextCharacters,
      }));
    }
  }

  hasArchivedForActive(): boolean {
    const c = this.activeCharacter;
    if (!c) return false;
    return c.tasks.some((t) => !!t.archivedAt);
  }

  archivedTasksOfActive(): Task[] {
    const c = this.activeCharacter;
    if (!c) return [];
    // você pode ordenar pela data mais recente se quiser:
    return [...c.tasks]
      .filter((t) => !!t.archivedAt)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }

  archiveTask(characterId: string, taskId: string): void {
    const ok = confirm('Arquivar esta task padrão? Você poderá resgatar depois em "Arquivados".');
    if (!ok) return;

    const nowIso = new Date().toISOString();

    // se estava em focus/doing, cancela
    this.cancelFocus(taskId);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;

            // ao arquivar, limpa estados transitórios para não “vazar”
            return {
              ...t,
              archivedAt: nowIso,
              doneForKey: undefined,
              doingForKey: undefined,
              doneAt: undefined,
              resetAt: undefined,
            };
          }),
        };
      }),
    }));
  }

  restoreArchivedTask(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, archivedAt: undefined } : t)),
        };
      }),
    }));

    this.archivedModalOpen = false;
  }

  allDoneForPeriod(character: Character, period: Period): boolean {
    const total = this.tasksOf(character, period).length; // já exclui arquivadas
    if (total === 0) return false;

    const done = this.doneTasksOfPeriod(character, period).length;
    return done === total;
  }

  onDropOpen(event: CdkDragDrop<Task[]>, characterId: string, period: Period): void {
    // segurança
    if (event.previousIndex === event.currentIndex) return;

    const list = [...event.container.data];
    moveItemInArray(list, event.previousIndex, event.currentIndex);

    this.applyReorder(
      characterId,
      period,
      list.map((t) => t.id),
      'open'
    );
  }

  onDropDone(event: CdkDragDrop<Task[]>, characterId: string, period: Period): void {
    if (event.previousIndex === event.currentIndex) return;

    const list = [...event.container.data];
    moveItemInArray(list, event.previousIndex, event.currentIndex);

    this.applyReorder(
      characterId,
      period,
      list.map((t) => t.id),
      'done'
    );
  }

  /**
   * Reordena apenas o "subgrupo" (open/done) daquele período, mantendo:
   * - tasks de outros períodos intactas
   * - tasks arquivadas intactas
   * - posições relativas do resto do array intactas
   */
  private applyReorder(
    characterId: string,
    period: Period,
    orderedIds: string[],
    which: 'open' | 'done'
  ): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        const original = c.tasks;
        const positions: number[] = [];
        const group: Task[] = [];

        for (let i = 0; i < original.length; i++) {
          const t = original[i];

          if (t.period !== period) continue;
          if (t.archivedAt) continue;

          const isDone = this.isDoneNow(t);
          const matches = which === 'done' ? isDone : !isDone;

          if (!matches) continue;

          positions.push(i);
          group.push(t);
        }

        if (group.length <= 1) return c;

        const byId = new Map(group.map((t) => [t.id, t]));

        // monta lista reordenada na ordem pedida
        const reordered: Task[] = [];
        for (const id of orderedIds) {
          const found = byId.get(id);
          if (found) reordered.push(found);
        }

        // garante que qualquer item faltante entre no fim, mantendo ordem antiga
        for (const t of group) {
          if (!reordered.some((x) => x.id === t.id)) reordered.push(t);
        }

        const next = [...original];
        for (let k = 0; k < positions.length; k++) {
          next[positions[k]] = reordered[k];
        }

        return { ...c, tasks: next };
      }),
    }));
  }

  trackByTaskId(_: number, t: Task): string {
    return t.id;
  }
}
