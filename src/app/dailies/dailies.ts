import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CountdownComponent, CountdownEvent } from 'ngx-countdown';
import { DateTime } from 'luxon';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

import { PxgStoreService } from '../core/services/pxg-store.service';
import { clearActiveUser, getActiveUser } from '../core/data/storage';
import { DEFAULT_TASK_SIGNATURES, defaultTasks } from '../core/data/default-tasks';
import { currentKey } from '../core/utils/period-keys';
import { Character, PxgDbV1, Task, Period } from '../core/models/pxg-db.model';
import { PxgExportV1 } from '../core/models/pxg-export.model';
import { ModalExcluirComponent } from '../modals/modal-excluir.component/modal-excluir.component';

type PeriodVm = {
  open: Task[];
  done: Task[];
  total: number;
  doneCount: number;
  allDone: boolean;
};

type ActiveVm = {
  character: Character;
  byPeriod: Record<Period, PeriodVm>;
  archived: Task[];
};

@Component({
  selector: 'app-dailies',
  standalone: true,
  imports: [CommonModule, FormsModule, CountdownComponent, DragDropModule, ModalExcluirComponent],
  templateUrl: './dailies.html',
  styleUrl: './dailies.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DailiesComponent {
  // ===== DI (inject para permitir usar em field initializers) =====
  private readonly router = inject(Router);
  private readonly store = inject(PxgStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  // ===== UI state básico =====
  displayName = '';
  syncCode = '';
  archivedModalOpen = false;
  newCharacterName = '';

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

  // ===== Focus =====
  readonly FOCUS_SECONDS = 60 * 60; // 1h
  private focusConfigs = new Map<string, any>();
  private focusCooling = new Set<string>();

  focusPromptOpen = false;
  focusPromptTaskTitle = '';
  private focusPromptCharacterId: string | null = null;
  private focusPromptTaskId: string | null = null;

  // ===== Reset rules =====
  private readonly TZ = 'America/Sao_Paulo';
  private readonly RESET_HOUR = 7;
  private readonly RESET_MINUTE = 40;

  // ===== Wallpapers =====
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
  bgStyleStr = `url('/images/rayquaza.png')`;

  // ===== Signals / VM =====
  private readonly dbSig = toSignal(this.store.dbObs, { initialValue: null as PxgDbV1 | null });
  private readonly activeCharacterIdSig = signal<string | null>(null);

  // “now” só precisa mudar em baixa frequência (1 min) para reset de done.
  private readonly nowMsSig = signal<number>(Date.now());

  readonly activeCharacter = computed<Character | null>(() => {
    const db = this.dbSig();
    const id = this.activeCharacterIdSig();
    if (!db || !id) return null;
    return db.characters.find((c) => c.id === id) ?? null;
  });

  readonly vm = computed<ActiveVm | null>(() => {
    const c = this.activeCharacter();
    if (!c) return null;

    const nowMs = this.nowMsSig();

    const byPeriod: Record<Period, PeriodVm> = {
      daily: { open: [], done: [], total: 0, doneCount: 0, allDone: false },
      weekly: { open: [], done: [], total: 0, doneCount: 0, allDone: false },
      monthly: { open: [], done: [], total: 0, doneCount: 0, allDone: false },
    };

    const archived: Task[] = [];

    for (const t of c.tasks) {
      if (t.archivedAt) {
        archived.push(t);
        continue;
      }

      const pv = byPeriod[t.period];
      pv.total++;

      const done = isDoneFast(t.resetAt, nowMs);
      if (done) {
        pv.done.push(t);
        pv.doneCount++;
      } else {
        pv.open.push(t);
      }
    }

    for (const p of this.periods) {
      const pv = byPeriod[p];
      pv.allDone = pv.total > 0 && pv.doneCount === pv.total;
    }

    archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));

    return { character: c, byPeriod, archived };
  });

  constructor() {
    const active = getActiveUser();
    if (!active) {
      this.router.navigateByUrl('/enter');
      return;
    }

    this.displayName = active.name;
    this.syncCode = active.syncCode;

    this.loadWallpaperPreference();
    this.recomputeBgStyle();

    const loaded = this.store.load(this.displayName, this.syncCode);
    if (!loaded) {
      this.router.navigateByUrl('/enter');
      return;
    }

    // Ajusta activeCharacterId quando db chega / muda
    this.store.dbObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((db) => {
      if (!db) return; // <-- CORRIGE erro 2 (null)

      if (db.characters?.length) {
        const current = this.activeCharacterIdSig();
        const exists = current ? db.characters.some((c) => c.id === current) : false;
        if (!exists) this.activeCharacterIdSig.set(db.characters[0].id);
      } else {
        this.activeCharacterIdSig.set(null);
      }

      this.migrateTaskOriginsIfNeeded(db);
      this.applyResetsIfNeeded(db);
    });

    // Timer de reset fora do Angular (evita CD desnecessário em cascata)
    this.zone.runOutsideAngular(() => {
      const id = window.setInterval(() => {
        this.zone.run(() => {
          this.nowMsSig.set(Date.now());
          const db = this.dbSig();
          if (db) this.applyResetsIfNeeded(db); // <-- CORRIGE erro 2 (null)
        });
      }, 60_000);

      this.destroyRef.onDestroy(() => window.clearInterval(id));
    });
  }

  // ===== Template helpers =====
  get db(): PxgDbV1 | null {
    return this.dbSig();
  }

  get activeCharacterId(): string | null {
    return this.activeCharacterIdSig();
  }

  selectCharacter(id: string): void {
    this.activeCharacterIdSig.set(id);
    this.donePanelOpen = { daily: false, weekly: false, monthly: false };
  }

  periodLabel(period: Period): string {
    if (period === 'daily') return 'Diárias';
    if (period === 'weekly') return 'Semanais';
    return 'Mensais';
  }

  isDoingNow(task: Task): boolean {
    return task.doingForKey === currentKey(task.period);
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

  toggleDonePanel(period: Period): void {
    this.donePanelOpen[period] = !this.donePanelOpen[period];
  }

  noDoneMessage(period: Period): string {
    if (period === 'daily') return 'Não há Tasks Diárias concluídas.';
    if (period === 'weekly') return 'Não há Tasks Semanais concluídas.';
    return 'Não há Tasks Mensais concluídas.';
  }

  canRename(task: Task): boolean {
    return task.origin === 'user';
  }

  // ===== Actions =====
  addCharacter(): void {
    const name = this.newCharacterName.trim();
    if (!name) return;

    const newId = crypto.randomUUID();

    this.store.update((db) => ({
      ...db,
      characters: [
        ...db.characters,
        { id: newId, name, createdAt: new Date().toISOString(), tasks: defaultTasks() },
      ],
    }));

    this.activeCharacterIdSig.set(newId);
    this.newCharacterName = '';
  }

  exportJsonDownload(): void {
    const db = this.dbSig();
    if (!db) return;

    const payload: PxgExportV1 = { exportVersion: 1, syncCode: this.syncCode, db };

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
    const db = this.dbSig();
    if (!db) return;
    await navigator.clipboard.writeText(JSON.stringify(db, null, 2));
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
      characters: db.characters.map((c) =>
        c.id !== characterId
          ? c
          : { ...c, tasks: [...c.tasks, { id: crypto.randomUUID(), title, period, origin: 'user' }] }
      ),
    }));
  }

  editTask(characterId: string, taskId: string): void {
    const db = this.dbSig();
    if (!db) return;

    const character = db.characters.find((c) => c.id === characterId);
    const task = character?.tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (!this.canRename(task)) {
      alert('Esta task é padrão do sistema e não pode ser renomeada.');
      return;
    }

    const newTitle = prompt('Novo nome da task:')?.trim();
    if (!newTitle) return;

    this.store.update((db2) => ({
      ...db2,
      characters: db2.characters.map((c) =>
        c.id !== characterId ? c : { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, title: newTitle } : t)) }
      ),
    }));
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

            const currentlyDone = isDoneFast(t.resetAt, Date.now());

            if (currentlyDone) {
              return { ...t, doneForKey: undefined, doingForKey: undefined, doneAt: undefined, resetAt: undefined };
            }

            const resetAtDt = this.computeResetAt(t, now);

            return {
              ...t,
              doneForKey: currentKey(t.period),
              doingForKey: undefined,
              doneAt: now.toISO() ?? undefined,
              resetAt: resetAtDt.toISO() ?? undefined,
            };
          }),
        };
      }),
    }));
  }

  startFocusCooldown(characterId: string, task: Task): void {
    if (isDoneFast(task.resetAt, Date.now())) return;
    if (this.focusCooling.has(task.id)) return;

    this.setDoingOn(characterId, task.id);

    this.focusConfigs.set(task.id, { leftTime: this.FOCUS_SECONDS, format: 'HH:mm:ss' });
    this.focusCooling.add(task.id);
  }

  onFocusCountdownEvent(e: CountdownEvent, characterId: string, task: Task): void {
    if (e.action !== 'done') return;

    if (isDoneFast(task.resetAt, Date.now())) {
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

    if (didFinish) this.toggleDone(characterId, taskId);
    else this.setDoingOff(characterId, taskId);
  }

  archiveTask(characterId: string, taskId: string): void {
    const ok = confirm('Arquivar esta task padrão? Você poderá resgatar depois em "Arquivados".');
    if (!ok) return;

    const nowIso = new Date().toISOString();
    this.cancelFocus(taskId);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) =>
        c.id !== characterId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) =>
                t.id !== taskId
                  ? t
                  : {
                      ...t,
                      archivedAt: nowIso,
                      doneForKey: undefined,
                      doingForKey: undefined,
                      doneAt: undefined,
                      resetAt: undefined,
                    }
              ),
            }
      ),
    }));
  }

  restoreArchivedTask(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) =>
        c.id !== characterId
          ? c
          : { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, archivedAt: undefined } : t)) }
      ),
    }));

    this.archivedModalOpen = false;
  }

  onDropOpen(event: CdkDragDrop<Task[]>, characterId: string, period: Period): void {
    if (event.previousIndex === event.currentIndex) return;
    const list = [...event.container.data];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.applyReorder(characterId, period, list.map((t) => t.id), 'open');
  }

  onDropDone(event: CdkDragDrop<Task[]>, characterId: string, period: Period): void {
    if (event.previousIndex === event.currentIndex) return;
    const list = [...event.container.data];
    moveItemInArray(list, event.previousIndex, event.currentIndex);
    this.applyReorder(characterId, period, list.map((t) => t.id), 'done');
  }

  private applyReorder(characterId: string, period: Period, orderedIds: string[], which: 'open' | 'done'): void {
    const nowMs = Date.now();

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

          const done = isDoneFast(t.resetAt, nowMs);
          const matches = which === 'done' ? done : !done;
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
        for (let k = 0; k < positions.length; k++) next[positions[k]] = reordered[k];

        return { ...c, tasks: next };
      }),
    }));
  }

  trackByTaskId(_: number, t: Task): string {
    return t.id;
  }

  openDeleteCharacterModal(characterId: string): void {
    const db = this.dbSig();
    if (!db) return;

    const ch = db.characters.find((c) => c.id === characterId);
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
    const db = this.dbSig();
    if (!db) return;

    const ch = db.characters.find((c) => c.id === characterId);
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
      if (!characterId) return this.closeDeleteModal();

      this.store.update((db) => ({ ...db, characters: db.characters.filter((c) => c.id !== characterId) }));

      if (this.activeCharacterIdSig() === characterId) this.activeCharacterIdSig.set(null);

      return this.closeDeleteModal();
    }

    const characterId = this.deleteCharacterId;
    const taskId = this.deleteTaskId;
    if (!characterId || !taskId) return this.closeDeleteModal();

    this.cancelFocus(taskId);

    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) => (c.id !== characterId ? c : { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })),
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
    this.recomputeBgStyle();
  }

  private recomputeBgStyle(): void {
    const found = this.wallpapers.find((w) => w.key === this.selectedWallpaperKey);
    const file = found?.file ?? '/images/rayquaza.png';
    this.bgStyleStr = `url('${file}')`;
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

  private setDoingOn(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) =>
        c.id !== characterId
          ? c
          : {
              ...c,
              tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, doingForKey: currentKey(t.period) } : t)),
            }
      ),
    }));
  }

  private setDoingOff(characterId: string, taskId: string): void {
    this.store.update((db) => ({
      ...db,
      characters: db.characters.map((c) =>
        c.id !== characterId
          ? c
          : { ...c, tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, doingForKey: undefined } : t)) }
      ),
    }));
  }

  private applyResetsIfNeeded(db: PxgDbV1): void {
    const nowMs = Date.now();
    let changed = false;

    const nextCharacters = db.characters.map((c) => {
      const nextTasks = c.tasks.map((t) => {
        if (!t.resetAt) return t;

        const resetMs = Date.parse(t.resetAt);
        if (!Number.isFinite(resetMs) || nowMs >= resetMs) {
          changed = true;
          return { ...t, doneForKey: undefined, doingForKey: undefined, doneAt: undefined, resetAt: undefined };
        }

        return t;
      });

      return { ...c, tasks: nextTasks };
    });

    if (changed) {
      this.store.update((db2) => ({ ...db2, characters: nextCharacters }));
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
      return nextWeekStart.set({ hour: this.RESET_HOUR, minute: this.RESET_MINUTE, second: 0, millisecond: 0 });
    }

    const title = (task.title ?? '').trim().toLowerCase();
    if (title === 'clones') return nowBrt.plus({ days: 30 });

    return nowBrt
      .plus({ months: 1 })
      .startOf('month')
      .set({ hour: this.RESET_HOUR, minute: this.RESET_MINUTE, second: 0, millisecond: 0 });
  }

  private migrateTaskOriginsIfNeeded(db: PxgDbV1): void {
    const signatureSet = new Set(
      DEFAULT_TASK_SIGNATURES.map(([period, title]) => `${period}::${title.trim().toLowerCase()}`)
    );

    let changed = false;

    const nextCharacters = db.characters.map((c) => {
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
      this.store.update((db2) => ({ ...db2, characters: nextCharacters }));
    }
  }

  hasArchivedForActive(): boolean {
    const v = this.vm();
    return !!v && v.archived.length > 0;
  }

  archivedTasksOfActive(): Task[] {
    const v = this.vm();
    return v ? v.archived : [];
  }
}

// ===== util local (hot path) =====
function isDoneFast(resetAtIso: string | undefined, nowMs: number): boolean {
  if (!resetAtIso) return false;
  const resetMs = Date.parse(resetAtIso);
  if (!Number.isFinite(resetMs)) return false;
  return nowMs < resetMs;
}
