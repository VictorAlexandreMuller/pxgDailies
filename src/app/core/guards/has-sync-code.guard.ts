import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { getActiveUser } from '../data/storage';

export const hasSyncCodeGuard: CanActivateFn = () => {
  const router = inject(Router);
  const active = getActiveUser();
  if (!active) return router.parseUrl('/enter');
  return true;
};
