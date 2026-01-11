import { PxgDbV1 } from './pxg-db.model';

export interface PxgExportV1 {
  exportVersion: 1;
  syncCode: string;
  db: PxgDbV1;
}
