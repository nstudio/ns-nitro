import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { PageRouterOutlet } from '@nativescript/angular';
import { EventData, View } from '@nativescript/core';
import { DuoService } from './duo/duo.service';

@Component({
  selector: 'ns-app',
  templateUrl: './app.component.html',
  imports: [PageRouterOutlet],
  schemas: [NO_ERRORS_SCHEMA],
})
export class AppComponent {
  private readonly duo = inject(DuoService);

  onRootLoaded(args: EventData): void {
    this.duo.attach(args.object as View);
  }
}
