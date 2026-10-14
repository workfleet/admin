// The Word version of the quotation. Shares its wording and section
// order with the PDF via quoteTemplate.js - only the drawing differs -
// and is kept out of the route handler so it can be rendered from a
// preview or a test without going through auth and Supabase.
//
// Branded like the Swansea Bus Station document pack, matching
// quotePdfDocument.js: CrewConnect wordmark over a teal rule, Poppins, a
// navy title, a details grid with grey label cells, navy section bars,
// tables with a teal header row, and a declaration grid to sign.
// Two-column arrangements use tables rather than tab stops - a tabbed
// line depends on how wide the reader's font renders, and Word collapses
// it the moment the left-hand text overruns a stop.
import {
  Document, Paragraph, TextRun, Tab, Table, TableRow, TableCell, Footer,
  AlignmentType, BorderStyle, WidthType, PageNumber, TabStopType, ShadingType, VerticalAlign,
} from 'docx';
import { COMPANY, PLATFORM, legalFooterLine } from './companyBranding';
import { quoteSections, quoteSummaryLines, quoteDocumentMeta } from './quoteTemplate';

const PLATFORM_INK = PLATFORM.ink.replace('#', '');
const NAVY = '16313F';
const INK = '1F2A30';
const MUTED = '5B6870';
const FAINT = '8A969C';
const LINE = 'D5DCDF';
const GREY_CELL = 'EEF4F4';
const PRICE_BG = 'F0F7F7';
const WHITE = 'FFFFFF';

const FONT = 'Poppins';

// A4 in twips, with the margins the section below uses. textWidth is what
// a full-width right tab stop has to sit on.
const PAGE = { width: 11906, height: 16838, marginX: 800, marginTop: 720, marginBottom: 1100 };
PAGE.textWidth = PAGE.width - PAGE.marginX * 2;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const THIN = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const THIN_BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN };

const shade = (fill) => ({ type: ShadingType.CLEAR, color: 'auto', fill });

function line(text, opts = {}) {
  const { size = 18, color = INK, bold = false, align, spacing, indent, border, shading } = opts;
  return new Paragraph({
    children: [new TextRun({ text, size, color, bold })],
    ...(align ? { alignment: align } : {}),
    ...(indent ? { indent } : {}),
    ...(border ? { border } : {}),
    ...(shading ? { shading } : {}),
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

// One cell of a ruled grid. `fill` gives the grey label cells and the
// teal header row.
function gridCell(text, { width, bold = false, color = INK, fill, align = AlignmentType.LEFT, keepNext = true, height } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text ?? ''), size: 18, bold, color })],
      alignment: align,
      spacing: { before: height ? 140 : 50, after: height ? 140 : 50 },
      keepNext,
    })],
    borders: THIN_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    margins: { left: 100, right: 100 },
    ...(fill ? { shading: shade(fill) } : {}),
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

function gridTable(rows) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

const COLUMN_WIDTHS = {
  2: [62, 38],
  3: [40, 36, 24],
  4: [33, 22, 19, 26],
};

function signatureGrid(company) {
  const row = (who) => new TableRow({
    cantSplit: true,
    children: [
      gridCell(who, { width: 24, bold: true, fill: GREY_CELL, height: true }),
      gridCell('Signature', { width: 13, bold: true, fill: GREY_CELL, height: true }),
      gridCell('', { width: 30, height: true }),
      gridCell('Date', { width: 9, bold: true, fill: GREY_CELL, height: true }),
      gridCell('', { width: 24, height: true, keepNext: false }),
    ],
  });
  return gridTable([row(`For ${company.name}`), row('Accepted by the client')]);
}

function renderBlock(block, company, teal) {
  switch (block.type) {
    case 'para':
      return [line(block.text, { spacing: { after: 100 } })];

    case 'subhead':
      return [line(block.text, { bold: true, color: NAVY, spacing: { before: 80, after: 40 } })];

    case 'bullets':
      return block.items.map((item) => new Paragraph({
        children: [new TextRun({ text: item, size: 18, color: INK })],
        bullet: { level: 0 },
        spacing: { after: 20 },
      }));

    case 'kv':
      return [
        gridTable(block.items.map((item) => new TableRow({
          cantSplit: true,
          children: [
            gridCell(item.label, { width: 32, bold: true, fill: GREY_CELL }),
            gridCell(item.value, { width: 68 }),
          ],
        }))),
        new Paragraph({ spacing: { after: 120 } }),
      ];

    // The quoted price: a tinted panel with a teal edge, as the pack's
    // callouts are.
    case 'price':
      return [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: PAGE.textWidth - 200 }],
          shading: shade(PRICE_BG),
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: teal, space: 6 } },
          spacing: { before: 60, after: 160 },
          indent: { left: 120 },
          children: [
            new TextRun({ text: block.label, size: 20, bold: true, color: NAVY }),
            new TextRun({ children: [new Tab()], size: 20 }),
            new TextRun({ text: block.value, size: 28, bold: true, color: NAVY }),
          ],
        }),
      ];

    case 'table': {
      const widths = COLUMN_WIDTHS[block.columns.length] || COLUMN_WIDTHS[2];
      const lastIndex = block.rows.length - 1;
      const align = (i, n) => (i === n - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT);
      return [
        gridTable([
          new TableRow({
            tableHeader: true,
            cantSplit: true,
            children: block.columns.map((col, i) => gridCell(col, {
              width: widths[i], bold: true, color: WHITE, fill: teal, align: align(i, block.columns.length),
            })),
          }),
          ...block.rows.map((row, r) => {
            const total = block.strongLastRow && r === lastIndex;
            return new TableRow({
              cantSplit: true,
              children: row.map((value, c) => gridCell(value, {
                width: widths[c],
                bold: total,
                ...(total ? { fill: GREY_CELL } : {}),
                align: align(c, row.length),
                keepNext: r !== lastIndex,
              })),
            });
          }),
        ]),
        new Paragraph({ spacing: { after: 140 } }),
      ];
    }

    case 'signature':
      return [signatureGrid(company)];

    default:
      return [];
  }
}

// Navy bar with the section's number and title in white.
function sectionBar(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, bold: true, color: WHITE })],
    shading: shade(NAVY),
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: NAVY, space: 3 }, bottom: { style: BorderStyle.SINGLE, size: 1, color: NAVY, space: 3 } },
    indent: { left: 60, right: 60 },
    spacing: { before: 220, after: 120 },
    keepNext: true,
  });
}

export function buildQuoteDocx(quote, company = COMPANY, template = null) {
  const meta = quoteDocumentMeta(quote);
  const sections = quoteSections(quote, company, template);
  const teal = (company.brandColor || COMPANY.brandColor).replace('#', '');

  // Who it's from is the masthead; who it's for and where are the
  // title and subtitle. Everything else goes in the grid.
  const cells = quoteSummaryLines(quote, company).filter(
    (l) => !['Prepared by', 'Site'].includes(l.label)
  );
  const gridRows = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    while (pair.length < 2) pair.push({ label: '', value: '' });
    gridRows.push(new TableRow({
      cantSplit: true,
      children: pair.flatMap((c) => [
        gridCell(c.label, { width: 15, bold: true, fill: GREY_CELL }),
        gridCell(c.value, { width: 35 }),
      ]),
    }));
  }

  const footerTab = () => new TextRun({ children: [new Tab()], size: 14, color: FAINT });
  const rightStop = [{ type: TabStopType.RIGHT, position: PAGE.textWidth }];

  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: rightStop,
        spacing: { after: 20 },
        children: [
          new TextRun({ text: `${company.name} — Quotation — ${meta.reference} — ${company.phone} · ${company.email}`, size: 14, color: FAINT }),
          footerTab(),
          new TextRun({ text: 'Prepared with ', size: 14, color: FAINT }),
          // The Route W wordmark is a weight contrast, not a colour one -
          // light "Work" against a heavier "Fleet", both in graphite.
          new TextRun({ text: 'Work', size: 14, color: PLATFORM_INK }),
          new TextRun({ text: 'Fleet', size: 14, color: PLATFORM_INK, bold: true }),
          new TextRun({ text: ' · Page ', size: 14, color: FAINT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 14, color: FAINT }),
          new TextRun({ text: ' of ', size: 14, color: FAINT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: FAINT }),
        ],
      }),
      line(legalFooterLine(company), { size: 12, color: FAINT }),
    ],
  });

  const children = [
    // Wordmark left, document type right, teal rule under both.
    twoColumn(
      [
        new Paragraph({
          spacing: { after: 0 },
          children: [
            new TextRun({ text: 'Crew', size: 34, bold: true, color: NAVY }),
            new TextRun({ text: 'Connect', size: 34, bold: true, color: teal }),
          ],
        }),
        new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({ text: 'CLEANING', size: 13, color: MUTED, characterSpacing: 48 })],
        }),
      ],
      [
        line('Quotation', { size: 16, color: MUTED, align: AlignmentType.RIGHT }),
        line(meta.recipient, { size: 16, color: MUTED, align: AlignmentType.RIGHT }),
      ]
    ),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: teal, space: 4 } },
      spacing: { before: 60, after: 240 },
      children: [],
    }),

    line(`Quotation — ${meta.serviceLabel}`, { size: 36, bold: true, color: NAVY }),
    line(meta.siteAddress || meta.recipient, { size: 20, color: MUTED, spacing: { before: 20, after: 160 } }),
    gridTable(gridRows),

    ...sections.flatMap((section) => [
      sectionBar(`${section.number}. ${section.title}`),
      ...section.blocks.flatMap((block) => renderBlock(block, company, teal)),
    ]),
  ];

  return new Document({
    title: `Quotation ${meta.reference} - ${meta.recipient}`,
    creator: company.legalName,
    description: `${meta.serviceLabel} quotation prepared with ${PLATFORM.name}`,
    styles: { default: { document: { run: { font: FONT, size: 18, color: INK } } } },
    sections: [{
      properties: { page: { margin: { top: PAGE.marginTop, bottom: PAGE.marginBottom, left: PAGE.marginX, right: PAGE.marginX } } },
      footers: { default: footer },
      children,
    }],
  });
}
