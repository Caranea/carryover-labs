import { Component } from '@angular/core';

@Component({
  selector: 'app-storage-notice',
  template: `
    <p class="rounded-box border border-base-300 bg-base-200 p-4 text-sm">
      Your approved documents and result history are saved in this browser. Meta AI checks use approved result text. Clearing site data removes your saved history.
    </p>
  `,
})
export class StorageNotice {}
