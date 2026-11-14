// A Word file from an AI draft, made in the browser. The document is the
// company's own (CrewConnect's letterhead, not WorkFleet's): trading name
// over a rule in the brand colour, and the legal line in the footer.
// [CONFIRM: ...] blanks are highlighted yellow so nobody sends one by
// mistake.
import { Document, Packer, Paragraph, TextRun, Footer, AlignmentType, BorderStyle, LevelFormat } from 'docx';
import { parseDraft, inlineRuns } from './aiDrafting';
import { COMPANY, legalFooterLine } from './companyBranding';

const FONT = 'Calibri';
const INK = '1F2A30';
const MUTED = '5B6870';

function runsFor(text, { size = 22, bold = false, color = INK } = {}) {
  return inlineRuns(text).map((r) => new TextRun({
    text: r.text,
    bold: bold || r.bold,
    size,
    color,
    font: FONT,
    highlight: r.placeholder ? 'yellow' : undefined,
  }));
}

export function buildDraftDocx(body, company = COMPANY) {
  const brand = String(company.brandColor || COMPANY.brandColor).replace('#', '');
  const blocks = parseDraft(body);

  const children = [
    new Paragraph({
      children: [new TextRun({ text: company.name, bold: true, size: 30, color: brand, font: FONT })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: brand, space: 6 } },
      spacing: { after: 280 },
    }),
  ];

  for (const b of blocks) {
    if (b.type === 'h1') {
      children.push(new Paragraph({ children: runsFor(b.text, { size: 32, bold: true }), spacing: { before: 120, after: 200 } }));
    } else if (b.type === 'h2') {
      children.push(new Paragraph({ children: runsFor(b.text, { size: 26, bold: true, color: brand }), spacing: { before: 240, after: 120 } }));
    } else if (b.type === 'h3') {
      children.push(new Paragraph({ children: runsFor(b.text, { size: 23, bold: true }), spacing: { before: 200, after: 80 } }));
    } else if (b.type === 'bullet') {
      children.push(new Paragraph({ children: runsFor(b.text), numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 } }));
    } else if (b.type === 'numbered') {
      children.push(new Paragraph({ children: runsFor(b.text), numbering: { reference: 'numbers', level: 0 }, spacing: { after: 80 } }));
    } else {
      children.push(new Paragraph({ children: runsFor(b.text), spacing: { after: 160, line: 300 } }));
    }
  }

  return new Document({
    creator: company.name,
    title: blocks.find((b) => b.type === 'h1')?.text || 'Draft',
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
        { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1100, left: 1100, right: 1100 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: legalFooterLine(company), size: 15, color: MUTED, font: FONT })] })],
        }),
      },
      children,
    }],
  });
}

export async function downloadDraftDocx(body, company, fileName) {

  const blob = await Packer.toBlob(buildDraftDocx(body, company));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
