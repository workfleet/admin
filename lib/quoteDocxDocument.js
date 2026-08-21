// The Word version of the quotation. Shares its wording and section
// order with the PDF via quoteTemplate.js - only the drawing differs -
// and is kept out of the route handler so it can be rendered from a
// preview or a test without going through auth and Supabase.
import {
  Document, Paragraph, TextRun, Tab, Table, TableRow, TableCell, Footer,
  AlignmentType, BorderStyle, WidthType, PageNumber, TabStopType, TabStopPosition,
} from 'docx';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta, QUOTE_STRAPLINE } from './quoteTemplate';

const BRAND = COMPANY.brandColor.replace('#', '');
const PLATFORM_INK = PLATFORM.ink.replace('#', '');
const INK = '1E2526';
const MUTED = '5B6768';
const FAINT = '8B9697';
const RULE = 'DFE5E5';

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function para(text, opts = {}) {
  const { size = 21, color = INK, bold = false, spacing } = opts;
  return new Paragraph({
    children: [new TextRun({ text, size, color, bold })],
    spacing: { after: 120, ...(spacing || {}) },
  });
}

function cell(text, { bold = false, align = AlignmentType.LEFT, width } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, size: 19, bold, color: INK })],
      alignment: align,
      spacing: { before: 60, after: 60 },
    })],
    borders: {
      top: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'EEF2F2' },
    },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

function headCell(text, { align = AlignmentType.LEFT, width } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text.toUpperCase(), size: 16, color: MUTED, bold: true })],
      alignment: align,
      spacing: { before: 40, after: 60 },
    })],
    borders: {
      top: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND },
    },
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

// Percentages per column count, matching the PDF's proportions.
const COLUMN_WIDTHS = {
  2: [60, 40],
  3: [38, 37, 25],
  4: [32, 22, 19, 27],
};

function renderBlock(block) {
  switch (block.type) {
    case 'para':
      return [para(block.text)];

    case 'subhead':
      return [new Paragraph({
        children: [new TextRun({ text: block.text, size: 20, bold: true, color: INK })],
        spacing: { before: 120, after: 60 },
        keepNext: true,
      })];

    case 'bullets':
      return block.items.map((item) => new Paragraph({
        children: [new TextRun({ text: item, size: 21, color: INK })],
        bullet: { level: 0 },
        spacing: { after: 40 },
      }));

    case 'kv':
      return [
        ...block.items.map((item) => new Paragraph({
          children: [
            new TextRun({ text: `${item.label}:  `, size: 20, color: MUTED }),
            new TextRun({ text: String(item.value), size: 20, color: INK }),
          ],
          spacing: { after: 40 },
          indent: { left: 240 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
        })),
        new Paragraph({ spacing: { after: 120 } }),
      ];

    case 'price':
      return [
        new Paragraph({
          children: [new TextRun({ text: block.label.toUpperCase(), size: 16, color: MUTED, bold: true })],
          alignment: AlignmentType.CENTER,
          shading: { fill: 'F0FDFD' },
          spacing: { before: 160, after: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: block.value, size: 48, bold: true, color: BRAND })],
          alignment: AlignmentType.CENTER,
          shading: { fill: 'F0FDFD' },
          spacing: { after: 200 },
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
              children: block.columns.map((col, i) => headCell(col, {
                align: i === block.columns.length - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                width: widths[i],
              })),
            }),
            ...block.rows.map((row, r) => new TableRow({
              children: row.map((value, c) => cell(value, {
                bold: block.strongLastRow && r === lastIndex,
                align: c === row.length - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
                width: widths[c],
              })),
            })),
          ],
        }),
        new Paragraph({ spacing: { after: 160 } }),
      ];
    }

    default:
      return [];
  }
}


export function buildQuoteDocx(quote) {
  const meta = quoteDocumentMeta(quote);
  const summary = quoteSummaryLines(quote);
  const sections = quoteSections(quote);

  // Everything that repeats lives at the foot of the page, matching the
  // PDF: contact, platform credit and page number across one line, the
  // statutory detail small beneath it. Tab() rather than a tab escape in
  // text - a tab character in a run is emitted literally, it does not
  // advance to the tab stop.
  const footerTab = () => new TextRun({ children: [new Tab()], size: 15, color: FAINT });

  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },
          { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
        ],
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
        spacing: { after: 20 },
        children: [
          new TextRun({ text: `${COMPANY.name} · ${COMPANY.website} · ${COMPANY.phone}`, size: 15, color: FAINT }),
          footerTab(),
          new TextRun({ text: 'Prepared with ', size: 15, color: FAINT }),
          // The Route W wordmark is a weight contrast, not a colour one -
          // light "Work" against a heavier "Fleet", both in graphite.
          new TextRun({ text: 'Work', size: 15, color: PLATFORM_INK }),
          new TextRun({ text: 'Fleet', size: 15, color: PLATFORM_INK, bold: true }),
          footerTab(),
          new TextRun({ text: 'Page ', size: 15, color: FAINT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: FAINT }),
          new TextRun({ text: ' of ', size: 15, color: FAINT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: FAINT }),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: legalFooterLine(), size: 13, color: FAINT })],
      }),
    ],
  });

  const children = [
    new Paragraph({
      children: [new TextRun({ text: 'QUOTATION', size: 18, bold: true, color: BRAND, characterSpacing: 60 })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.recipient, size: 44, bold: true, color: INK })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.serviceLabel, size: 24, color: MUTED })],
      spacing: { after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 8 } },
    }),
    new Paragraph({ spacing: { after: 120 } }),

    ...summary.map((line) => new Paragraph({
      tabStops: [{ type: TabStopType.LEFT, position: 2200 }],
      children: [
        new TextRun({ text: line.label, size: 19, color: FAINT }),
        new TextRun({ text: `\t${line.value}`, size: 20, color: INK }),
      ],
      spacing: { after: 40 },
    })),
    new Paragraph({ spacing: { after: 240 } }),

    ...sections.flatMap((section) => [
      new Paragraph({
        children: [new TextRun({ text: `${section.number}. ${section.title}`, size: 24, bold: true, color: BRAND })],
        spacing: { before: 260, after: 120 },
        keepNext: true,
      }),
      ...section.blocks.flatMap(renderBlock),
    ]),

    new Paragraph({
      children: [new TextRun({ text: COMPANY.name, size: 22, bold: true, color: BRAND })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: QUOTE_STRAPLINE, size: 18, color: MUTED })],
      alignment: AlignmentType.CENTER,
    }),
  ];

  const doc = new Document({
    title: `Quotation ${meta.reference} - ${meta.recipient}`,
    creator: COMPANY.legalName,
    description: `${meta.serviceLabel} quotation prepared with ${PLATFORM.name}`,
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1400, left: 1080, right: 1080 } } },
      footers: { default: footer },
      children,
    }],
  });

  return doc;
}
