import { Component, inject, OnInit, signal } from '@angular/core';
import { ConfigService, PublicConfig } from '../core/config.service';

/** The server reports what is enabled; the interface must not assume encryption. */
@Component({
  selector: 'app-storage-notice',
  template: `
    @if (protection() === 'development-plaintext') {
      <div role="alert" class="rounded-box border border-warning bg-warning/10 p-4 text-sm"><strong>Development storage: encryption is not enabled.</strong> Only use fictional test documents on this installation. Personal details you leave visible in an approved copy will be stored as readable files.</div>
    } @else if (protection() === 'encrypted-new-files') {
      <p class="text-sm text-base-content/80">New saved files are encrypted on this server. Check every page before saving: any personal detail left visible remains part of the stored copy.</p>
    } @else if (failed()) {
      <p role="alert" class="text-sm text-error">Storage protection could not be checked. Use fictional documents until the server's settings are confirmed.</p>
    }
  `,
})
export class StorageNotice implements OnInit {
  private readonly config = inject(ConfigService);
  protected readonly protection = signal<PublicConfig['storageProtection']>(undefined);
  protected readonly failed = signal(false);
  async ngOnInit() {
    try { const config = await this.config.get(); this.protection.set(config.storageProtection); this.failed.set(!config.storageProtection); }
    catch { this.failed.set(true); }
  }
}
