import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeroStack } from './hero-stack';
import { RecordFilm } from './record-film';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-home',
  imports: [RouterLink, HeroStack, RecordFilm, Icon],
  templateUrl: './home.page.html',
})
export class HomePage {
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
      question: 'Which languages does it read?',
      answer:
        'Lab reports in Polish, German and English, from any lab, and it lines up the same test across languages. The app itself is in English for now.',
    },
    {
      question: 'What if a personal detail is missed?',
      answer:
        'Check every page before approving it. You can hide words, draw a box over a stamp or signature, turn a sideways page upright, and reopen a saved document to hide more.',
    },
  ];
}
