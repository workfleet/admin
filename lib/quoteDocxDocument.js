// The Word version of the quotation. Shares its wording and section
// order with the PDF via quoteTemplate.js - only the drawing differs -
// and is kept out of the route handler so it can be rendered from a
// preview or a test without going through auth and Supabase.
//
// Typeset as a business letter, matching quotePdfDocument.js: letterhead,
// addressee block, serif body, money on a ruled line, somewhere to sign.
// Two-column arrangements use borderless tables rather than tab stops -
// a tabbed line depends on how wide the reader's font renders, and Word
// collapses it the moment the left-hand text overruns a stop.
import {
  Document, Paragraph, TextRun, Tab, Table, TableRow, TableCell, Footer,
  AlignmentType, BorderStyle, WidthType, PageNumber, TabStopType,
} from 'docx';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta } from './quoteTemplate';

const PLATFORM_INK = PLATFORM.ink.replace('#', '');
const INK = '1A1D1E';
const MUTED = '55605F';
const FAINT = '8B9697';
const RULE = 'C9D0CF';
const HAIRLINE = 'E3E8E7';

const BODY_FONT = 'Times New Roman';
const HEAD_FONT = 'Arial';

// A4 in twips, with the margins the section below uses. textWidth is what
// a full-width right tab stop has to sit on.
const PAGE = { width: 11906, height: 16838, marginX: 1080, marginTop: 1000, marginBottom: 1400 };
PAGE.textWidth = PAGE.width - PAGE.marginX * 2;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function line(text, opts = {}) {
  const { size = 21, color = INK, bold = false, font, align, spacing, indent, border } = opts;
  return new Paragraph({
    children: [new TextRun({ text, size, color, bold, ...(font ? { font } : {}) })],
    ...(align ? { alignment: align } : {}),
    ...(indent ? { indent } : {}),
    ...(border ? { border } : {}),
    spacing: { after: 0, ...(spacing || {}) },
  });
}

function borderlessCell(children, width) {
  return new TableCell({ children, borders: NO_BORDERS, width: { size: width, type: WidthType.PERCENTAGE } });
}

function twoColumn(left, right, widths = [58, 42]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [new TableRow({ children: [borderlessCell(left, widths[0]), borderlessCell(right, widths[1])] })],
  });
}

function cell(text, { bold = false, align = AlignmentType.LEFT, width, keepNext = true, total = false } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, size: 20, bold, color: INK })],
      alignment: align,
      spacing: { before: 50, after: 50 },
      keepNext,
    })],
    borders: {
      left: NO_BORDER,
      right: NO_BORDER,
      top: total ? { style: BorderStyle.SINGLE, size: 6, color: INK } : NO_BORDER,
      bottom: total ? NO_BORDER : { style: BorderStyle.SINGLE, size: 2, color: HAIRLINE },
    },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

function headCell(text, { align = AlignmentType.LEFT, width } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, size: 17, color: INK, bold: true, font: HEAD_FONT })],
      alignment: align,
      spacing: { before: 30, after: 50 },
      keepNext: true,
    })],
    borders: {
      left: NO_BORDER,
      right: NO_BORDER,
      top: NO_BORDER,
      bottom: { style: BorderStyle.SINGLE, size: 6, color: INK },
    },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

const COLUMN_WIDTHS = {
  2: [62, 38],
  3: [40, 36, 24],
  4: [33, 22, 19, 26],
};

function signatureColumn(heading) {
  const ruled = () => new Paragraph({
    children: [new TextRun({ text: '', size: 20 })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 2 } },
    spacing: { before: 260, after: 40 },
  });

  return [
    line(heading, { size: 17, font: HEAD_FONT, bold: true, spacing: { after: 60 } }),
    ruled(),
    line('Signature', { size: 16, color: FAINT, font: HEAD_FONT, spacing: { after: 60 } }),
    ruled(),
    line('Name and date', { size: 16, color: FAINT, font: HEAD_FONT }),
  ];
}

function renderBlock(block, company) {
  switch (block.type) {
    case 'para':
      return [line(block.text, { spacing: { after: 120 } })];

    case 'subhead':
      return [line(block.text, { bold: true, spacing: { before: 100, after: 60 } })];

    case 'bullets':
      return block.items.map((item) => new Paragraph({
        children: [new TextRun({ text: item, size: 21, color: INK })],
        bullet: { level: 0 },
        spacing: { after: 20 },
      }));

    case 'kv':
      return [
        ...block.items.map((item) => new Paragraph({
          children: [
            new TextRun({ text: `${item.label}:  `, size: 21, color: MUTED }),
            new TextRun({ text: String(item.value), size: 21, color: INK }),
          ],
          spacing: { after: 20 },
          indent: { left: 220 },
        })),
        new Paragraph({ spacing: { after: 120 } }),
      ];

    // The total, ruled above and below the way an invoice line is - not a
    // tinted card with an oversized number in it.
    case 'price':
      return [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: PAGE.textWidth }],
          border: {
            top: { style: BorderStyle.SINGLE, size: 8, color: INK, space: 4 },
            bottom: { style: BorderStyle.SINGLE, size: 8, color: INK, space: 4 },
          },
          spacing: { before: 120, after: 220 },
          children: [
            new TextRun({ text: block.label, size: 22, bold: true, color: INK }),
            new TextRun({ children: [new Tab()], size: 22 }),
            new TextRun({ text: block.value, size: 28, bold: true, color: INK }),
          ],
        }),
      ];

    case 'table': {
      const widths = COLUMN_WIDTHS[block.columns.length] || COLUMN_WIDTHS[2];
      const lastIndex = block.rows.length - 1;
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              cantSplit: true,
              children: block.columns.map((col, i) => headCell(col, {
                align: i === block.columns.length - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                width: widths[i],
              })),
            }),
            ...block.rows.map((row, r) => new TableRow({
              cantSplit: true,
              children: row.map((value, c) => cell(value, {
                bold: block.strongLastRow && r === lastIndex,
                total: block.strongLastRow && r === lastIndex,
                align: c === row.length - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                width: widths[c],
                keepNext: r !== lastIndex,
              })),
            })),
          ],
        }),
        new Paragraph({ spacing: { after: 160 } }),
      ];
    }

    case 'signature':
      return [
        twoColumn(signatureColumn(`FOR AND ON BEHALF OF ${company.name.toUpperCase()}`), signatureColumn('ACCEPTED BY THE CLIENT'), [48, 48]),
      ];

    default:
      return [];
  }
}

export function buildQuoteDocx(quote, company = COMPANY, template = null) {
  const meta = quoteDocumentMeta(quote);
  const sections = quoteSections(quote, company, template);

  // The reference block takes the short facts; who it's from and who
  // it's for are already stated by the letterhead and addressee block.
  const reference = quoteSummaryLines(quote, company).filter(
    (l) => !['Prepared by', 'Prepared for', 'Site'].includes(l.label)
  );

  const footerTab = () => new TextRun({ children: [new Tab()], size: 15, color: FAINT });
  const rightStop = [{ type: TabStopType.RIGHT, position: PAGE.textWidth }];

  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: rightStop,
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
        spacing: { after: 20 },
        children: [
          new TextRun({ text: `${company.name} · ${company.website} · ${company.phone}`, size: 15, color: FAINT, font: HEAD_FONT }),
          footerTab(),
          new TextRun({ text: 'Prepared with ', size: 15, color: FAINT, font: HEAD_FONT }),
          // The Route W wordmark is a weight contrast, not a colour one -
          // light "Work" against a heavier "Fleet", both in graphite.
          new TextRun({ text: 'Work', size: 15, color: PLATFORM_INK, font: HEAD_FONT }),
          new TextRun({ text: 'Fleet', size: 15, color: PLATFORM_INK, bold: true, font: HEAD_FONT }),
          new TextRun({ text: ' · Page ', size: 15, color: FAINT, font: HEAD_FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: FAINT, font: HEAD_FONT }),
          new TextRun({ text: ' of ', size: 15, color: FAINT, font: HEAD_FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: FAINT, font: HEAD_FONT }),
        ],
      }),
      line(legalFooterLine(company), { size: 13, color: FAINT, font: HEAD_FONT }),
    ],
  });

  const children = [
    // Letterhead: who is writing, and how to reach them.
    twoColumn(
      [
        line(company.name, { size: 30, bold: true, font: HEAD_FONT }),
        line(company.legalName, { size: 15, color: FAINT, font: HEAD_FONT, spacing: { before: 20 } }),
      ],
      [
        line(company.address, { size: 17, color: MUTED, align: AlignmentType.RIGHT }),
        line(`${company.phone} · ${company.email}`, { size: 17, color: MUTED, align: AlignmentType.RIGHT }),
      ]
    ),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: company.brandColor.replace('#', ''), space: 4 } },
      spacing: { before: 100, after: 240 },
      children: [],
    }),

    // Addressee left, reference right - the arrangement of a letter.
    twoColumn(
      [
        line('QUOTATION FOR', { size: 16, color: FAINT, font: HEAD_FONT, spacing: { after: 40 } }),
        line(meta.recipient, { size: 23, bold: true }),
        ...(meta.siteAddress ? [line(meta.siteAddress, { size: 20, color: MUTED, spacing: { before: 20 } })] : []),
      ],
      reference.map((l) => new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 4000 }],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: `${l.label}   `, size: 18, color: FAINT, font: HEAD_FONT }),
          new TextRun({ text: String(l.value), size: 19, color: INK }),
        ],
      }))
    ),

    line(`Quotation for ${meta.serviceLabel}`, {
      size: 24,
      bold: true,
      spacing: { before: 280, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
    }),
    new Paragraph({ spacing: { after: 200 }, children: [] }),

    ...sections.flatMap((section) => [
      line(`${section.number}. ${section.title}`, {
        size: 20,
        bold: true,
        font: HEAD_FONT,
        spacing: { before: 240, after: 100 },
      }),
      ...section.blocks.flatMap((block) => renderBlock(block, company)),
    ]),
  ];

  return new Document({
    title: `Quotation ${meta.reference} - ${meta.recipient}`,
    creator: company.legalName,
    description: `${meta.serviceLabel} quotation prepared with ${PLATFORM.name}`,
    styles: { default: { document: { run: { font: BODY_FONT, size: 21, color: INK } } } },
    sections: [{
      properties: { page: { margin: { top: PAGE.marginTop, bottom: PAGE.marginBottom, left: PAGE.marginX, right: PAGE.marginX } } },
      footers: { default: footer },
      children,
    }],
  });
}
