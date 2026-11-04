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
      question: 'What actually leaves my device?',
      answer:
        'Only the copy you approve. Each page opens in your browser and you cover personal details with black boxes. When you tap “Approve and send”, that blacked-out copy goes to Meta’s AI. Your original files, their names and the words you hid stay on your device. If you accept analytics cookies, Google Analytics also counts your visits to our home and demo pages. It doesn’t run on your documents or results.',
    },
    {
      question: 'Can the black bars be removed later?',
      answer:
        'No. The covered details are burned into a new image before it leaves your device, so nothing is hiding underneath. If you reopen a saved document, you can hide more, but you can’t uncover anything.',
    },
    {
      question: 'What if a personal detail is missed?',
      answer:
        'You decide what’s covered, so check every page before approving it, including doctors’ names, stamps and signatures. Anything left visible is sent. You can turn a sideways page upright, undo a box, and reopen a saved document to cover more.',
    },
    {
      question: 'Where are my documents saved?',
      answer:
        'In this browser, on this device. There’s no account, so they won’t appear on your other devices. Our server holds a page in memory only while it’s being read, for 15 minutes at most, and never saves it to disk. “Delete all my data from this browser”, at the bottom of every page, removes everything. Clearing your browser data does too, so export a PDF of anything you want to keep.',
    },
    {
      question: 'Does Carryover tell me what my results mean?',
      answer:
        'No. Carryover organizes your records so you can review them with your doctor. It does not interpret results or give medical advice. High and low flags and reference ranges are copied from your reports.',
    },
    {
      question: 'How do I know the numbers are right?',
      answer:
        'Meta’s AI copies what’s printed on the page. Unit conversions use fixed formulas, not AI. Each result links back to the page it came from, so you can compare them. If a value, date or unit can’t be confirmed, it stays out of the charts and is listed for you to check. Mistakes are still possible, so check anything important against the original report.',
    },
    {
      question: 'Which documents can I add?',
      answer:
        'Lab reports from any lab and any year: PDFs, scans, phone photos, or Word, text and CSV files. You can mix old and new reports in one go. Up to 40 pages can be read at a time, so split longer files.',
    },
    {
      question: 'Which languages does it read?',
      answer: 'Polish, German and English. The app itself is in English for now.',
    },
    {
      question: 'What do I do with the results at my appointment?',
      answer:
        'Export a PDF, then print it or bring it on your phone. Your doctor gets your results in one table, by date, with the lab’s flags, instead of a pile of separate reports. Bring the originals too, in case your doctor wants to see them.',
    },
    {
      question: 'Why doesn’t Carryover hide my details for me?',
      answer:
        'Finding them automatically would mean a model reading your pages before you’ve approved anything. Carryover doesn’t do that: no AI sees a page until you approve it, and then only Meta’s models read the copy you covered.',
    },
  ];
}
