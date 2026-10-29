import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DocumentManifest, SavedDocument, SavedDocumentSummary } from './models';
import { RecordsResponse } from './records';
import { Observation, ResultsResponse } from './results';
import { RecoveryResponse, RecoveryStartRequest, RecoveryAcceptRequest, RecoveryRejectRequest } from './recovery';

/** The only place documents leave the device: already-redacted pages. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly http = inject(HttpClient);

  list(): Promise<SavedDocumentSummary[]> {
    return firstValueFrom(this.http.get<SavedDocumentSummary[]>('/api/documents'));
  }

  get(id: string): Promise<SavedDocument> {
    return firstValueFrom(this.http.get<SavedDocument>(`/api/documents/${encodeURIComponent(id)}`));
  }

  pageImage(id: string, index: number): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`/api/documents/${encodeURIComponent(id)}/pages/${index}`, { responseType: 'blob' }),
    );
  }

  create(manifest: DocumentManifest, images: (Blob | null)[]): Promise<SavedDocumentSummary> {
    return firstValueFrom(this.http.post<SavedDocumentSummary>('/api/documents', toForm(manifest, images)));
  }

  replace(id: string, manifest: DocumentManifest, images: (Blob | null)[]): Promise<SavedDocumentSummary> {
    return firstValueFrom(
      this.http.put<SavedDocumentSummary>(`/api/documents/${encodeURIComponent(id)}`, toForm(manifest, images)),
    );
  }

  /** Every printed result across the account, each with its document, page and box. */
  results(): Promise<ResultsResponse> {
    return firstValueFrom(this.http.get<ResultsResponse>('/api/results'));
  }

  /** Each recognised test over time, grouped into charts, plus what was left out and why. */
  records(): Promise<RecordsResponse> {
    return firstValueFrom(this.http.get<RecordsResponse>('/api/records'));
  }

  correct(documentId: string, observationId: string, change: { name: string; valueText: string; unit: string | null; date: string | null; note: string; expectedRevision: string }): Promise<Observation> {
    return firstValueFrom(this.http.patch<Observation>(`/api/results/${encodeURIComponent(documentId)}/observations/${encodeURIComponent(observationId)}`, change));
  }

  retryRecords(): Promise<RecordsResponse> {
    return firstValueFrom(this.http.post<RecordsResponse>('/api/records/retry', {}));
  }

  recovery(documentId: string): Promise<RecoveryResponse> {
    return firstValueFrom(this.http.get<RecoveryResponse>(`/api/recovery/${encodeURIComponent(documentId)}`));
  }

  findMissedReadings(documentId: string, request: RecoveryStartRequest): Promise<RecoveryResponse> {
    return firstValueFrom(this.http.post<RecoveryResponse>(`/api/recovery/${encodeURIComponent(documentId)}`, request));
  }

  acceptRecoveredReading(documentId: string, proposalId: string, request: RecoveryAcceptRequest): Promise<RecoveryResponse> {
    return firstValueFrom(this.http.post<RecoveryResponse>(`/api/recovery/${encodeURIComponent(documentId)}/proposals/${encodeURIComponent(proposalId)}/accept`, request));
  }

  rejectRecoveredReading(documentId: string, proposalId: string, request: RecoveryRejectRequest): Promise<RecoveryResponse> {
    return firstValueFrom(this.http.post<RecoveryResponse>(`/api/recovery/${encodeURIComponent(documentId)}/proposals/${encodeURIComponent(proposalId)}/reject`, request));
  }

  delete(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/documents/${encodeURIComponent(id)}`));
  }
}

function toForm(manifest: DocumentManifest, images: (Blob | null)[]): FormData {
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  images.forEach((img, i) => {
    if (img) form.append('pages', img, `page-${manifest.pages[i].index}.jpg`);
  });
  return form;
}


