import { Routes } from '@angular/router';
import { EnterComponent } from './enter/enter';
import { DailiesComponent } from './dailies/dailies';
import { hasSyncCodeGuard } from './core/guards/has-sync-code.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'enter', pathMatch: 'full' },
  { path: 'enter', component: EnterComponent },
  { path: 'dailies', component: DailiesComponent, canActivate: [hasSyncCodeGuard] },
  { path: '**', redirectTo: 'enter' },
];
