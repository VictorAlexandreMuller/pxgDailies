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
import { ModalExcluirComponent } from '../modals/modal-excluir.component/modal-excluir.component';

@Component({
  selector: 'app-dailies',
  standalone: true,
  imports: [CommonModule, FormsModule, CountdownComponent, DragDropModule, ModalExcluirComponent],
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
  deleteModalOpen = false;
  deleteModalTitle = 'Confirmar exclusão';
  deleteModalMessage = 'Você realmente deseja excluir este item?';
  deleteModalItemLabel = '';

  private deleteAction: 'character' | 'task' | null = null;
  private deleteCharacterId: string | null = null;
  private deleteTaskId: string | null = null;

  readonly periods: Period[] = ['daily', 'weekly', 'monthly'];

  donePanelOpen: Record<Period, boolean> = {
    daily: false,
    weekly: false,
    monthly: false,
  };

  readonly FOCUS_SECONDS = 60 * 60;
  private focusConfigs = new Map<string, any>();
  private focusCooling = new Set<string>();

  focusPromptOpen = false;
  focusPromptTaskTitle = '';
  private focusPromptCharacterId: string | null = null;
  private focusPromptTaskId: string | null = null;

  private readonly TZ = 'America/Sao_Paulo';
  private readonly RESET_HOUR = 7;
  private readonly RESET_MINUTE = 40;
  private resetTicker: ReturnType<typeof setInterval> | null = null;

  readonly wallpapers: Array<{ key: string; label: string; file: string }> = [
    { key: 'rayquaza', label: 'Rayquaza', file: '/images/rayquaza.png' },
    { key: 'johto', label: 'Johto', file: '/images/johto.jpg' },
    { key: 'palkya', label: 'Palkya', file: '/images/palkya.jpg' },
    { key: 'regirock', label: 'Regirock', file: '/images/regirock.png' },
    { key: 'registeel', label: 'Registeel', file: '/images/registeel.png' },
    { key: 'digglets', label: 'Digglets', file: '/images/digglets.png' },
    { key: 'eevolutions', label: 'Eevolutions', file: '/images/eevolutions.png' },
    { key: 'unowns', label: 'Unowns', file: '/images/unowns.jpg' },
    { key: 'poke-balls', label: 'Poke Balls', file: '/images/pokeballs.jpg' },
    { key: 'pokemon-cards', label: 'Pokemon Cards', file: '/images/pokemon-cards.png' },
    { key: 'pikachus', label: 'Pikachus', file: '/images/pikachus.jpg' },
    { key: 'pikachu-relax', label: 'Pikachu Relax', file: '/images/pikachu-relax.jpg' },
    { key: 'malefic', label: 'Malefic', file: '/images/malefic.jpg' },
    { key: 'naturia', label: 'Naturia', file: '/images/naturia.jpg' },
    { key: 'ocean-pokemons', label: 'Ocean Pokemons', file: '/images/ocean-pokemons.jpg' },
    {
      key: 'hamburguers-pokemons',
      label: 'Hamburguers Pokemons',
      file: '/images/hamburguers-pokemons.jpg',
    },
    { key: 'celabi-temple', label: 'Celebi Temple', file: '/images/celebi-temple.jpg' },
    { key: 'baby-legendaries', label: 'Baby Legendaries', file: '/images/baby-legendaries.png' },
    { key: 'deoxys', label: 'Deoxys', file: '/images/deoxys.jpg' },
    { key: 'floral-pikachu', label: 'Floral Pikachu', file: '/images/floral-pikachu.png' },
    { key: 'minimalist-digglet', label: 'Minimalist Digglet', file: '/images/minimalist-digglet.jpg' },
    { key: 'protagonists', label: 'Protagonists', file: '/images/protagonists.jpg' },
    { key: 'raibolt', label: 'Raibolt', file: '/images/raibolt.jpg' },
    { key: 'seavell', label: 'Seavell', file: '/images/seavell.jpg' },
    { key: 'wailmer', label: 'Wailmer', file: '/images/wailmer.jpg' },
  ];

  selectedWallpaperKey = 'rayquaza';

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
    this.loadWallpaperPreference();

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

    this.resetTicker = setInterval(() => {
      this.applyResetsIfNeeded();
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.resetTicker) {
      clearInterval(this.resetTicker);
      this.resetTicker = null;
    }
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
    return character.tasks.filter((t) => t.period === period && !t.archivedAt);
  }

  isDoneNow(task: Task): boolean {
    if (!task.resetAt) return false;

    const now = DateTime.now().setZone(this.TZ);
    const resetAt = DateTime.fromISO(task.resetAt, { zone: this.TZ });

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
    this.openDeleteCharacterModal(characterId);
  }

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
    this.openDeleteTaskModal(characterId, taskId);
  }

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

            const resetAtDt = this.computeResetAt(t, now);

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

  private applyResetsIfNeeded(): void {
    if (!this.db) return;

    const now = DateTime.now().setZone(this.TZ);

    let changed = false;

    const nextCharacters = this.db.characters.map((c) => {
      const nextTasks = c.tasks.map((t) => {
        if (!t.resetAt) return t;

        const resetAt = DateTime.fromISO(t.resetAt, { zone: this.TZ });

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

  private computeResetAt(task: Task, nowBrt: DateTime): DateTime {
    if (task.period === 'daily') {
      return nowBrt
        .plus({ days: 1 })
        .set({ hour: this.RESET_HOUR, minute: this.RESET_MINUTE, second: 0, millisecond: 0 });
    }

    if (task.period === 'weekly') {
      const nextWeekStart = nowBrt.plus({ weeks: 1 }).startOf('week');
      return nextWeekStart.set({
        hour: this.RESET_HOUR,
        minute: this.RESET_MINUTE,
        second: 0,
        millisecond: 0,
      });
    }

    const title = (task.title ?? '').trim().toLowerCase();
    if (title === 'clones') {
      return nowBrt.plus({ days: 30 });
    }

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
    return [...c.tasks]
      .filter((t) => !!t.archivedAt)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }

  archiveTask(characterId: string, taskId: string): void {
    const ok = confirm('Arquivar esta task padrão? Você poderá resgatar depois em "Arquivados".');
    if (!ok) return;

    const nowIso = new Date().toISOString();

    this.cancelFocus(taskId);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;

        return {
          ...c,
          tasks: c.tasks.map((t) => {
            if (t.id !== taskId) return t;

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
    const total = this.tasksOf(character, period).length;
    if (total === 0) return false;

    const done = this.doneTasksOfPeriod(character, period).length;
    return done === total;
  }

  onDropOpen(event: CdkDragDrop<Task[]>, characterId: string, period: Period): void {
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

        const reordered: Task[] = [];
        for (const id of orderedIds) {
          const found = byId.get(id);
          if (found) reordered.push(found);
        }

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

  openDeleteCharacterModal(characterId: string): void {
    if (!this.db) return;

    const ch = this.db.characters.find((c) => c.id === characterId);
    if (!ch) return;

    this.deleteAction = 'character';
    this.deleteCharacterId = characterId;
    this.deleteTaskId = null;

    this.deleteModalTitle = 'EXCLUIR BONECO';
    this.deleteModalMessage =
      'ESSA AÇÃO REMOVERÁ TODAS AS TASKS DESSE BONECO E NÃO PODERÁ SER DESFEITA.';
    this.deleteModalItemLabel = `Boneco: ${ch.name}`;

    this.deleteModalOpen = true;
  }

  openDeleteTaskModal(characterId: string, taskId: string): void {
    if (!this.db) return;

    const ch = this.db.characters.find((c) => c.id === characterId);
    const task = ch?.tasks.find((t) => t.id === taskId);
    if (!ch || !task) return;

    if (task.origin === 'system') {
      alert('Esta task é padrão do sistema e não pode ser excluída. Use Arquivar.');
      return;
    }

    this.deleteAction = 'task';
    this.deleteCharacterId = characterId;
    this.deleteTaskId = taskId;

    this.deleteModalTitle = 'Excluir task';
    this.deleteModalMessage = 'Você realmente deseja excluir esta task?';
    this.deleteModalItemLabel = `Task: ${task.title}`;

    this.deleteModalOpen = true;
  }

  closeDeleteModal(): void {
    this.deleteModalOpen = false;

    this.deleteAction = null;
    this.deleteCharacterId = null;
    this.deleteTaskId = null;

    this.deleteModalItemLabel = '';
  }

  confirmDeleteModal(): void {
    if (!this.deleteAction) {
      this.closeDeleteModal();
      return;
    }

    if (this.deleteAction === 'character') {
      const characterId = this.deleteCharacterId;
      if (!characterId) {
        this.closeDeleteModal();
        return;
      }

      this.store.update((db) => ({
        ...db,
        characters: db.characters.filter((c) => c.id !== characterId),
      }));

      if (this.activeCharacterId === characterId) {
        this.activeCharacterId = null;
      }

      this.closeDeleteModal();
      return;
    }

    const characterId = this.deleteCharacterId;
    const taskId = this.deleteTaskId;

    if (!characterId || !taskId) {
      this.closeDeleteModal();
      return;
    }

    this.cancelFocus(taskId);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => {
        if (c.id !== characterId) return c;
        return { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) };
      }),
    }));

    this.closeDeleteModal();
  }

  private wallpaperStorageKey(): string {
    return `pxg.wallpaper.${this.displayName}.${this.syncCode}`;
  }

  private loadWallpaperPreference(): void {
    const saved = localStorage.getItem(this.wallpaperStorageKey());
    const exists = saved && this.wallpapers.some((w) => w.key === saved);
    this.selectedWallpaperKey = exists ? (saved as string) : 'rayquaza';
  }

  onWallpaperChange(): void {
    localStorage.setItem(this.wallpaperStorageKey(), this.selectedWallpaperKey);
  }

  bgStyle(): string {
    const found = this.wallpapers.find((w) => w.key === this.selectedWallpaperKey);
    const file = found?.file ?? '/images/rayquaza.png';
    return `url('${file}')`;
  }
}
