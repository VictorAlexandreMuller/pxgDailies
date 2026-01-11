import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

import { CountdownComponent, CountdownConfig, CountdownEvent } from 'ngx-countdown';

@Component({
  selector: 'app-modal-excluir',
  standalone: true,
  imports: [CommonModule, CountdownComponent],
  templateUrl: './modal-excluir.component.html',
  styleUrl: './modal-excluir.component.scss',
})
export class ModalExcluirComponent implements OnChanges, AfterViewInit {
  @Input() open = false;

  @Input() title = 'Confirmar exclusão';
  @Input() message = 'Você realmente deseja excluir este item?';
  @Input() itemLabel = '';

  // segundos (ex.: 5). NÃO é ms.
  @Input() countdownSeconds = 5;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('cd') cd?: CountdownComponent;

  remaining = 0;
  progress = 0;

  countdownConfig: CountdownConfig = {
    leftTime: 0,
    demand: true,
    format: 's',
    notify: 0,
  };

  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.open) this.resetAndStart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) this.resetAndStart();
      else this.resetLocal();
    }

    if (changes['countdownSeconds'] && this.open) {
      this.resetAndStart();
    }
  }

  get canConfirm(): boolean {
    return this.open && this.remaining <= 0;
  }

  private resetAndStart(): void {
    const total = Math.max(0, Math.floor(this.countdownSeconds || 0));

    this.remaining = total;
    this.progress = total > 0 ? 0 : 1;

    this.countdownConfig = {
      leftTime: total,
      demand: true,
      format: 's',
      notify: 0,
    };

    queueMicrotask(() => {
      if (!this.viewReady) return;
      this.cd?.restart();
      this.cd?.begin();
    });
  }

  private resetLocal(): void {
    this.remaining = 0;
    this.progress = 0;
  }

  onCountdown(e: CountdownEvent): void {
    const totalSec = Math.max(0, Math.floor(this.countdownSeconds || 0));

    if (typeof e.left === 'number') {
      // Alguns builds do ngx-countdown emitem left em ms (5000, 4000, ...)
      const leftMs = e.left;
      const leftSec = leftMs > 100 ? Math.ceil(leftMs / 1000) : Math.ceil(leftMs);

      this.remaining = Math.max(0, leftSec);

      const totalMs = totalSec * 1000;
      this.progress = totalSec > 0 ? Math.min(1, Math.max(0, 1 - leftMs / totalMs)) : 1;
    }

    if (e.action === 'done') {
      this.remaining = 0;
      this.progress = 1;
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onConfirm(): void {
    if (!this.canConfirm) return;
    this.confirm.emit();
  }

  onBackdropClick(): void {
    this.onCancel();
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.open) this.onCancel();
  }
}
