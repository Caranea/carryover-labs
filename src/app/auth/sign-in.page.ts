import { afterNextRender, Component, ElementRef, inject, input, OnDestroy, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeroStack } from '../landing/hero-stack';
import { Icon } from '../ui/icon';
import { AuthService } from './auth.service';

/** The public landing page, modelled on daisyUI's homepage, ending in sign-in. */
@Component({
  selector: 'app-sign-in',
  imports: [HeroStack, Icon, RouterLink],
  templateUrl: './sign-in.page.html',
})
export class SignInPage implements OnDestroy {
  protected readonly auth = inject(AuthService);
  readonly problem = input<string>();
  private readonly el = viewChild.required<ElementRef<HTMLDivElement>>('signIn');
  protected readonly mountError = signal<string | null>(null);

  protected readonly steps = [
    {
      icon: 'upload' as const,
      title: 'Add your results',
      text: 'Photos of printouts, scanned or downloaded PDFs, Word files. From any lab, in Polish, German or English.',
    },
    {
      icon: 'scan' as const,
      title: 'Check personal details',
      text: 'Your device suggests which names and personal details to hide. Check every page: automatic detection can miss things.',
    },
    {
      icon: 'check-circle' as const,
      title: 'View and share your history',
      text: 'Approve the copy to save, then see your tests over time. Bring a printable appointment record with links back to each source.',
    },
  ];

  protected readonly removed = ['Your name', 'PESEL', 'Doctors', 'Lab technicians', 'Addresses', 'Phone numbers', 'Insurance and card numbers'];
  protected readonly kept = ['Test names', 'Results', 'Units', 'Reference ranges', 'Collection dates', 'Lab name'];

  protected readonly faq = [
    {
      q: 'Are my documents sent anywhere?',
      a: 'Not the originals. Reading and finding personal details happen in your browser. Only after you approve is a new image saved, with the black bars burned in, plus the words that are still visible.',
    },
    {
      q: 'Does Carryover tell me what my results mean?',
      a: 'No. Carryover keeps records in order so you and your doctors can see each test over time. It never interprets results or gives medical advice.',
    },
    {
      q: 'What if something personal is missed?',
      a: 'You see every page before saving and can hide any word with a click, or draw a box over a stamp or signature. You can also reopen a saved document and hide more later.',
    },
    {
      q: 'Which labs and languages work?',
      a: 'Printouts and PDFs from any lab. Text recognition reads Polish, German and English today.',
    },
  ];

  constructor() {
    afterNextRender(() =>
      this.auth.mountSignIn(this.el().nativeElement).catch((e: unknown) => {
        console.error(e);
        this.mountError.set(e instanceof Error ? e.message : String(e));
      }),
    );
  }

  protected scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }

  ngOnDestroy() {
    void this.auth.unmountSignIn(this.el().nativeElement);
  }
}

