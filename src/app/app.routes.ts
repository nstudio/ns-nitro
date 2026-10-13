import { Routes } from '@angular/router';
import { NitroDashboardComponent } from './nitro/nitro-dashboard.component';
import { NitroBenchmarkDetailComponent } from './nitro/nitro-benchmark-detail.component';

export const routes: Routes = [
  { path: '', redirectTo: '/nitro', pathMatch: 'full' },
  { path: 'nitro', component: NitroDashboardComponent },
  { path: 'benchmark/:id', component: NitroBenchmarkDetailComponent },
];

