import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MetadataViewerComponent } from './metadata-viewer/metadata-viewer';

@Component({
  selector: 'app-root',
  imports: [MetadataViewerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('doc-metadata-viewer');
}
