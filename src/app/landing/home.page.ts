import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeroStack } from './hero-stack';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-home',
  imports: [RouterLink, HeroStack, Icon],
  templateUrl: './home.page.html',
})
export class HomePage {
  protected readonly steps = [
    {
      icon: 'upload' as const,
      title: 'Add your results',
      text: 'Choose a photo, PDF, Word file, or text document from any lab.',
    },
    {
      icon: 'scan' as const,
      title: 'Check personal details',
      text: 'Your device suggests details to hide. Review every page and add any missing black bars.',
    },
    {
      icon: 'check-circle' as const,
      title: 'View your history',
      text: 'Save the approved copy in this browser, explore results over time, and print them for your appointment.',
    },
  ];

  protected readonly faq = [
    {
      question: 'Where are my documents saved?',
      answer:
        'The original file is read on your device. After you approve a copy, its results and page images are saved in this browser. “Delete all my data from this browser”, at the bottom of every page, removes them.',
    },
    {
      question: 'Does Carryover tell me what my results mean?',
      answer:
        'No. Carryover organizes your records so you can review them with your doctor. It does not interpret results or give medical advice.',
    },
    {
      question: 'What if a personal detail is missed?',
      answer:
        'Check every page before saving. You can hide words or draw a box over a stamp or signature, and reopen a saved document to hide more.',
    },
  ];
}
