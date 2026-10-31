// Read an .xlsx workbook and write edits back *into the original file*.
//
// The important trick: we never rebuild the workbook. We parse only the XML parts
// we need, patch the individual <c> cells the user actually edited, and re-zip the
// original entries untouched. Styles, charts, images, formulas, other sheets, print
// settings and conditional formatting all survive, because we never rewrite them.

import { unzip, zip } from './zip.js';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/* ---------------------------------------------------------------- helpers */

// Prefix-agnostic DOM lookups: some writers emit <x:worksheet>, most emit <worksheet>.
function descendants(root, localName) {
  const out = [];
  for (const el of root.getElementsByTagName('*')) {
    if (el.localName === localName) out.push(el);
  }
  return out;
}

function firstDescendant(root, localName) {
  for (const el of root.getElementsByTagName('*')) {
    if (el.localName === localName) return el;
  }
  return null;
}

function childrenNamed(parent, localName) {
  return Array.from(parent.children).filter((el) => el.localName === localName);
}

export function colToIndex(letters) {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index;
}

export function indexToCol(index) {
  let letters = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function parseRef(ref) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref || '');
  if (!match) return null;
  return { col: match[1].toUpperCase(), row: Number(match[2]) };
}

// "Sheet 1"!$B$2:$B$40, B2:B40, $B:$B, or a single cell. Rows are omitted for
// whole-column references. Returns null for anything that isn't a plain range.
function parseRange(text) {
  let ref = String(text || '').trim().replace(/^=/, '');
  let sheet = null;
  const bang = ref.lastIndexOf('!');
  if (bang >= 0) {
    sheet = ref.slice(0, bang).trim();
    if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
    ref = ref.slice(bang + 1);
  }
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)?(?::\$?([A-Za-z]{1,3})\$?(\d+)?)?$/.exec(ref);
  if (!match) return null;
  const fromCol = match[1].toUpperCase();
  const toCol = (match[3] || match[1]).toUpperCase();
  const fromRow = match[2] ? Number(match[2]) : 1;
  const toRow = match[4] ? Number(match[4]) : (match[2] && !match[3] ? Number(match[2]) : Infinity);
  return {
    sheet,
    fromCol: colToIndex(fromCol),
    toCol: colToIndex(toCol),
    fromRow: Math.min(fromRow, toRow),
    toRow: Math.max(fromRow, toRow),
  };
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function parseXml(bytes) {
  const doc = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml');
  const failure = doc.querySelector('parsererror');
  if (failure) throw new Error(`Malformed XML in workbook: ${failure.textContent.slice(0, 200)}`);
  return doc;
}

function serializeXml(doc) {
  return encoder.encode(XML_DECL + new XMLSerializer().serializeToString(doc.documentElement));
}

/* ------------------------------------------------------------ date coding */

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function looksLikeDateFormat(code) {
  if (!code) return false;
  // Drop literals and colour/condition blocks before sniffing for date tokens.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymd]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

function serialToDate(serial, date1904) {
  if (date1904) return new Date(Date.UTC(1904, 0, 1) + serial * 86400000);
  // Excel pretends 1900 was a leap year; serials below 61 are off by one day.
  const epoch = serial >= 61 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
  return new Date(epoch + serial * 86400000);
}

function dateToSerial(date, date1904) {
  const ms = date.getTime();
  if (date1904) return (ms - Date.UTC(1904, 0, 1)) / 86400000;
  const rough = (ms - Date.UTC(1899, 11, 30)) / 86400000;
  return rough >= 61 ? rough : (ms - Date.UTC(1899, 11, 31)) / 86400000;
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function formatDateSerial(serial, date1904) {
  const date = serialToDate(serial, date1904);
  if (Number.isNaN(date.getTime())) return String(serial);
  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  if (!hours && !minutes && !seconds) return ymd;
  const time = seconds ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}`;
  return `${ymd} ${time}`;
}

// Accepts what formatDateSerial produces, plus common locale spellings.
export function parseDateInput(text, date1904) {
  const trimmed = String(text).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (iso) {
    const ms = Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 0), +(iso[5] || 0), +(iso[6] || 0));
    return dateToSerial(new Date(ms), date1904);
  }
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const ms = Date.UTC(+slash[3], +slash[1] - 1, +slash[2]);
    return dateToSerial(new Date(ms), date1904);
  }
  return null;
}

/* -------------------------------------------------------------- workbook */

export class Workbook {
  constructor(files) {
    this.files = files;
    this.sheetDocs = new Map(); // path -> parsed Document
    this.dirtySheets = new Set();
    this.formulaTouched = false;
    this.sharedStrings = [];
    this.dateStyles = new Set();
    this.date1904 = false;
    this.sheets = [];
    this.definedNames = new Map(); // lower-cased name -> reference text
  }

  static async load(buffer) {
    const workbook = new Workbook(await unzip(buffer));
    workbook._readWorkbookPart();
    workbook._readSharedStrings();
    workbook._readStyles();
    return workbook;
  }

  _part(path) {
    return this.files.get(path);
  }

  _readWorkbookPart() {
    const bytes = this._part('xl/workbook.xml');
    if (!bytes) throw new Error('This file is not an Excel workbook (xl/workbook.xml is missing).');
    const doc = parseXml(bytes);

    const props = firstDescendant(doc, 'workbookPr');
    this.date1904 = props?.getAttribute('date1904') === '1' || props?.getAttribute('date1904') === 'true';

    const relTargets = new Map();
    const relBytes = this._part('xl/_rels/workbook.xml.rels');
    if (relBytes) {
      for (const rel of descendants(parseXml(relBytes), 'Relationship')) {
        relTargets.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
      }
    }

    this.sheets = descendants(doc, 'sheet').map((sheet, order) => {
      const relId = sheet.getAttributeNS(REL_NS, 'id') || sheet.getAttribute('r:id');
      let target = relTargets.get(relId) || `worksheets/sheet${order + 1}.xml`;
      let path;
      if (target.startsWith('/')) path = target.slice(1);
      else if (target.startsWith('../')) path = target.replace(/^\.\.\//, '');
      else path = `xl/${target}`;
      return {
        name: sheet.getAttribute('name') || `Sheet${order + 1}`,
        path,
        hidden: (sheet.getAttribute('state') || 'visible') !== 'visible',
      };
    }).filter((sheet) => this.files.has(sheet.path));

    if (!this.sheets.length) throw new Error('No worksheets found in this workbook.');

    // Named ranges, so a dropdown whose list is "=Categories" can be resolved.
    for (const name of descendants(doc, 'definedName')) {
      const key = (name.getAttribute('name') || '').toLowerCase();
      if (key && !this.definedNames.has(key)) this.definedNames.set(key, name.textContent.trim());
    }
  }

  _readSharedStrings() {
    const bytes = this._part('xl/sharedStrings.xml');
    if (!bytes) return;
    const doc = parseXml(bytes);
    this.sharedStrings = descendants(doc, 'si').map((si) => {
      // Rich text splits a string across <r><t> runs; phonetic <rPh> hints are not content.
      let text = '';
      for (const child of si.children) {
        if (child.localName === 't') text += child.textContent;
        else if (child.localName === 'r') {
          for (const run of childrenNamed(child, 't')) text += run.textContent;
        }
      }
      return text;
    });
  }

  _readStyles() {
    const bytes = this._part('xl/styles.xml');
    if (!bytes) return;
    const doc = parseXml(bytes);

    const customFormats = new Map();
    for (const fmt of descendants(doc, 'numFmt')) {
      customFormats.set(Number(fmt.getAttribute('numFmtId')), fmt.getAttribute('formatCode') || '');
    }

    const cellXfs = firstDescendant(doc, 'cellXfs');
    if (!cellXfs) return;
    childrenNamed(cellXfs, 'xf').forEach((xf, styleIndex) => {
      const numFmtId = Number(xf.getAttribute('numFmtId') || 0);
      const isDate = DATE_FORMAT_IDS.has(numFmtId) || looksLikeDateFormat(customFormats.get(numFmtId));
      if (isDate) this.dateStyles.add(styleIndex);
    });
  }

  _sheetDoc(path) {
    if (!this.sheetDocs.has(path)) this.sheetDocs.set(path, parseXml(this._part(path)));
    return this.sheetDocs.get(path);
  }

  _cellText(cell) {
    const type = cell.getAttribute('t') || 'n';
    if (type === 'inlineStr') {
      const is = firstDescendant(cell, 'is');
      return is ? descendants(is, 't').map((t) => t.textContent).join('') : '';
    }
    const v = childrenNamed(cell, 'v')[0];
    if (!v) return '';
    const raw = v.textContent;
    if (type === 's') return this.sharedStrings[Number(raw)] ?? '';
    if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
    if (type === 'e' || type === 'str') return raw;
    // Numeric: render through the style's number format only when it's a date.
    const styleIndex = Number(cell.getAttribute('s') || 0);
    if (this.dateStyles.has(styleIndex) && raw !== '') {
      return formatDateSerial(Number(raw), this.date1904);
    }
    return raw;
  }

  /**
   * Read a sheet into headers + records.
   * @param {string} path worksheet part path
   * @param {number} headerRow 1-based row holding the column titles
   */
  readSheet(path, headerRow = 1) {
    const doc = this._sheetDoc(path);
    const sheetData = firstDescendant(doc, 'sheetData');
    const rows = sheetData ? childrenNamed(sheetData, 'row') : [];

    const headers = [];
    const seenCols = new Map(); // col letter -> { texts, numeric, dates }
    const records = [];

    for (const row of rows) {
      const rowNumber = Number(row.getAttribute('r'));
      const cells = childrenNamed(row, 'c');

      if (rowNumber === headerRow) {
        for (const cell of cells) {
          const ref = parseRef(cell.getAttribute('r'));
          if (!ref) continue;
          const name = this._cellText(cell).trim();
          if (name) headers.push({ col: ref.col, index: colToIndex(ref.col), name });
        }
        continue;
      }
      if (rowNumber < headerRow) continue;

      const values = {};
      let hasContent = false;
      for (const cell of cells) {
        const ref = parseRef(cell.getAttribute('r'));
        if (!ref) continue;
        const text = this._cellText(cell);
        values[ref.col] = text;
        if (text !== '') hasContent = true;

        const stats = seenCols.get(ref.col) || { numeric: 0, dates: 0, filled: 0 };
        if (text !== '') {
          stats.filled++;
          const styleIndex = Number(cell.getAttribute('s') || 0);
          const type = cell.getAttribute('t') || 'n';
          if (this.dateStyles.has(styleIndex) && type === 'n') stats.dates++;
          else if (type === 'n' && text !== '' && !Number.isNaN(Number(text))) stats.numeric++;
        }
        seenCols.set(ref.col, stats);
      }
      if (hasContent) records.push({ rowNumber, values });
    }

    headers.sort((a, b) => a.index - b.index);
    for (const header of headers) {
      const stats = seenCols.get(header.col) || { numeric: 0, dates: 0, filled: 0 };
      if (stats.filled && stats.dates / stats.filled > 0.6) header.kind = 'date';
      else if (stats.filled && stats.numeric / stats.filled > 0.6) header.kind = 'number';
      else header.kind = 'text';
    }

    // Columns governed by an Excel dropdown (a "list" data validation) carry
    // their allowed values, so the UI can offer a menu instead of a text box.
    const validations = this._listValidations(path);
    for (const header of headers) {
      let best = null;
      let bestSpan = 0;
      for (const rule of validations) {
        for (const range of rule.ranges) {
          if (header.index < range.fromCol || header.index > range.toCol) continue;
          const span = Math.min(range.toRow, headerRow + 100000) - Math.max(range.fromRow, headerRow + 1) + 1;
          if (span > bestSpan) {
            best = rule;
            bestSpan = span;
          }
        }
      }
      if (best) {
        header.options = best.options;
        header.listSource = best.source;
      }
    }

    return { headers, records, headerRow };
  }

  /* ------------------------------------------------------ dropdown lists */

  // Every "list" validation on the sheet, whether written the classic way or
  // in the x14 extension block (which Excel uses for lists on other sheets),
  // with its allowed values already resolved. Rules whose list is computed by
  // a formula are skipped, since the cell then falls back to free text.
  _listValidations(path) {
    const doc = this._sheetDoc(path);
    const rules = [];
    for (const el of descendants(doc, 'dataValidation')) {
      if ((el.getAttribute('type') || '') !== 'list') continue;
      const formula = childrenNamed(el, 'formula1')[0];
      const sqref = el.getAttribute('sqref') || childrenNamed(el, 'sqref')[0]?.textContent || '';
      if (!formula || !sqref.trim()) continue;

      const ranges = sqref.trim().split(/\s+/).map(parseRange).filter(Boolean);
      const resolved = this._resolveList(formula.textContent, path);
      if (!ranges.length || !resolved) continue;
      rules.push({ ranges, ...resolved });
    }
    return rules;
  }

  // Turns a validation's formula1 into { options, source }: an inline list
  // ("Yes,No"), a range on any sheet, or a defined name pointing at one.
  _resolveList(formulaText, sheetPath) {
    let text = String(formulaText || '').trim().replace(/^=/, '');
    if (!text) return null;

    const inline = /^"(.*)"$/s.exec(text);
    if (inline) {
      // Excel stores the list exactly as typed, so a workbook made where the
      // list separator is ";" (most of Europe) has "Yes;No" rather than "Yes,No".
      const body = inline[1];
      const separator = body.includes(',') ? ',' : ';';
      const options = uniqueNonEmpty(body.split(separator).map((s) => s.trim()));
      return options.length ? { options, source: 'list typed into the validation rule' } : null;
    }

    const named = this.definedNames.get(text.toLowerCase());
    if (named) text = named;

    const range = parseRange(text);
    if (!range) return null;
    const sheet = range.sheet === null
      ? this.sheets.find((s) => s.path === sheetPath)
      : this.sheets.find((s) => s.name === range.sheet);
    if (!sheet) return null;

    const options = uniqueNonEmpty(this._rangeTexts(sheet.path, range));
    if (!options.length) return null;
    const fromRef = `${indexToCol(range.fromCol)}${range.fromRow === 1 && range.toRow === Infinity ? '' : range.fromRow}`;
    const toRef = `${indexToCol(range.toCol)}${range.toRow === Infinity ? '' : range.toRow}`;
    return { options, source: `${sheet.name}!${fromRef}:${toRef}` };
  }

  _rangeTexts(path, range, limit = 1000) {
    const doc = this._sheetDoc(path);
    const sheetData = firstDescendant(doc, 'sheetData');
    const texts = [];
    for (const row of sheetData ? childrenNamed(sheetData, 'row') : []) {
      const rowNumber = Number(row.getAttribute('r'));
      if (rowNumber < range.fromRow) continue;
      if (rowNumber > range.toRow) break;
      for (const cell of childrenNamed(row, 'c')) {
        const ref = parseRef(cell.getAttribute('r'));
        if (!ref) continue;
        const index = colToIndex(ref.col);
        if (index < range.fromCol || index > range.toCol) continue;
        texts.push(this._cellText(cell));
        if (texts.length >= limit) return texts;
      }
    }
    return texts;
  }

  /** Insert `node` among `parent`'s children so that `key(child)` stays ascending. */
  static _insertOrdered(parent, node, keyOf, key) {
    for (const child of parent.children) {
      if (keyOf(child) > key) {
        parent.insertBefore(node, child);
        return;
      }
    }
    parent.appendChild(node);
  }

  _createElement(doc, localName) {
    const root = doc.documentElement;
    const prefix = root.prefix;
    return doc.createElementNS(root.namespaceURI || MAIN_NS, prefix ? `${prefix}:${localName}` : localName);
  }

  /**
   * Write one cell. Style, column width and everything around it are preserved;
   * only this <c> element's value is replaced.
   */
  setCell(path, rowNumber, col, text, kind = 'text') {
    const doc = this._sheetDoc(path);
    let sheetData = firstDescendant(doc, 'sheetData');
    if (!sheetData) {
      sheetData = this._createElement(doc, 'sheetData');
      doc.documentElement.appendChild(sheetData);
    }

    let row = childrenNamed(sheetData, 'row').find((el) => Number(el.getAttribute('r')) === rowNumber);
    if (!row) {
      row = this._createElement(doc, 'row');
      row.setAttribute('r', String(rowNumber));
      Workbook._insertOrdered(sheetData, row, (el) => Number(el.getAttribute('r')), rowNumber);
    }
    // `spans` is a stale hint once we add cells; Excel recomputes it when absent.
    row.removeAttribute('spans');

    const ref = `${col}${rowNumber}`;
    const colIndex = colToIndex(col);
    let cell = childrenNamed(row, 'c').find((el) => (el.getAttribute('r') || '').toUpperCase() === ref);
    if (!cell) {
      cell = this._createElement(doc, 'c');
      cell.setAttribute('r', ref);
      Workbook._insertOrdered(row, cell, (el) => colToIndex(parseRef(el.getAttribute('r'))?.col || 'A'), colIndex);
    }

    if (childrenNamed(cell, 'f').length) this.formulaTouched = true;

    // Keep only the style index; drop value, type and any cached formula.
    const styleIndex = cell.getAttribute('s');
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    for (const attr of Array.from(cell.attributes)) {
      if (attr.name !== 'r') cell.removeAttributeNode(attr);
    }
    if (styleIndex !== null) cell.setAttribute('s', styleIndex);

    const value = String(text ?? '');
    if (value !== '') {
      const asDate = kind === 'date' ? parseDateInput(value, this.date1904) : null;
      const asNumber = kind === 'number' && value.trim() !== '' && !Number.isNaN(Number(value.trim()))
        ? Number(value.trim())
        : null;

      if (asDate !== null || asNumber !== null) {
        const v = this._createElement(doc, 'v');
        v.textContent = String(asDate !== null ? asDate : asNumber);
        cell.appendChild(v);
      } else {
        // Inline strings avoid touching the shared string table entirely.
        cell.setAttribute('t', 'inlineStr');
        const is = this._createElement(doc, 'is');
        const t = this._createElement(doc, 't');
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        t.textContent = value;
        is.appendChild(t);
        cell.appendChild(is);
      }
    }

    this._expandDimension(doc, colIndex, rowNumber);
    this.dirtySheets.add(path);
  }

  /**
   * Highest column index any cell on the sheet occupies, whether or not that
   * column has a header. Zero for an empty sheet. Used to pick the letter for
   * a new column so it never lands on top of unheaded data.
   */
  lastUsedColumnIndex(path) {
    const doc = this._sheetDoc(path);
    let max = 0;

    const dimension = firstDescendant(doc, 'dimension');
    const [, end] = (dimension?.getAttribute('ref') || '').split(':');
    const to = parseRef(end);
    if (to) max = colToIndex(to.col);

    const sheetData = firstDescendant(doc, 'sheetData');
    for (const row of sheetData ? childrenNamed(sheetData, 'row') : []) {
      for (const cell of childrenNamed(row, 'c')) {
        const ref = parseRef(cell.getAttribute('r'));
        if (ref) max = Math.max(max, colToIndex(ref.col));
      }
    }
    return max;
  }

  /**
   * Add a column: write its title into the header row, dress the new header
   * cell like its neighbours, and stretch the sheet's AutoFilter (if any) to
   * cover it so Excel shows a filter arrow on it too. Data cells are written
   * later, one at a time, through setCell — an empty column needs none.
   */
  addColumn(path, headerRow, col, name) {
    this.setCell(path, headerRow, col, name, 'text');

    const doc = this._sheetDoc(path);
    const sheetData = firstDescendant(doc, 'sheetData');
    const row = childrenNamed(sheetData, 'row').find((el) => Number(el.getAttribute('r')) === headerRow);
    const cells = childrenNamed(row, 'c');
    const colIndex = colToIndex(col);
    const cell = cells.find((el) => parseRef(el.getAttribute('r'))?.col === col);

    // Inherit the style (bold, fill, borders) of the nearest header to the left.
    if (cell && !cell.hasAttribute('s')) {
      const styled = cells
        .filter((el) => colToIndex(parseRef(el.getAttribute('r'))?.col || 'A') < colIndex && el.hasAttribute('s'))
        .pop();
      if (styled) cell.setAttribute('s', styled.getAttribute('s'));
    }

    const filter = firstDescendant(doc, 'autoFilter');
    if (filter) {
      const [start, end] = (filter.getAttribute('ref') || '').split(':');
      const from = parseRef(start);
      const to = parseRef(end || start);
      if (from && to && from.row === headerRow && colToIndex(to.col) < colIndex) {
        filter.setAttribute('ref', `${from.col}${from.row}:${col}${to.row}`);
      }
    }
  }

  /* ------------------------------------------------------- excel tables */

  // Table parts (Insert → Table) attached to a worksheet, via its .rels file.
  _tablePartsFor(path) {
    const relsPath = path.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels');
    const bytes = this._part(relsPath);
    if (!bytes) return [];
    const parts = [];
    for (const rel of descendants(parseXml(bytes), 'Relationship')) {
      if (!/\/table$/.test(rel.getAttribute('Type') || '')) continue;
      const target = rel.getAttribute('Target') || '';
      const resolved = target.startsWith('/')
        ? target.slice(1)
        : `xl/worksheets/${target}`.replace(/\/[^/]+\/\.\.\//g, '/');
      if (this.files.has(resolved)) parts.push(resolved);
    }
    return parts;
  }

  /** Does an Excel table on this sheet have its header row at `headerRow`? */
  sheetHasTable(path, headerRow) {
    return this._tablePartsFor(path).some((tablePath) => {
      const table = firstDescendant(this._sheetDoc(tablePath), 'table');
      const from = parseRef((table?.getAttribute('ref') || '').split(':')[0]);
      return from?.row === headerRow;
    });
  }

  /**
   * Rename a column: rewrite its header cell and, if the header belongs to an
   * Excel table, the matching tableColumn — Excel refuses to open a file where
   * the two disagree. Formulas that name the column are not rewritten.
   */
  renameHeader(path, headerRow, col, name) {
    this.setCell(path, headerRow, col, name, 'text');
    const colIndex = colToIndex(col);
    for (const tablePath of this._tablePartsFor(path)) {
      const doc = this._sheetDoc(tablePath);
      const table = firstDescendant(doc, 'table');
      const [start, end] = (table?.getAttribute('ref') || '').split(':');
      const from = parseRef(start);
      const to = parseRef(end || start);
      if (!from || !to || from.row !== headerRow) continue;
      if (colIndex < colToIndex(from.col) || colIndex > colToIndex(to.col)) continue;
      const columns = descendants(doc, 'tableColumn');
      const column = columns[colIndex - colToIndex(from.col)];
      if (!column) continue;
      column.setAttribute('name', name);
      this.dirtySheets.add(tablePath);
    }
  }

  _expandDimension(doc, colIndex, rowNumber) {
    const dimension = firstDescendant(doc, 'dimension');
    if (!dimension) return;
    const ref = dimension.getAttribute('ref') || '';
    const [start, end] = ref.split(':');
    const from = parseRef(start);
    const to = parseRef(end || start);
    if (!from || !to) return;
    const maxCol = Math.max(colToIndex(to.col), colIndex);
    const maxRow = Math.max(to.row, rowNumber);
    dimension.setAttribute('ref', `${from.col}${from.row}:${indexToCol(maxCol)}${maxRow}`);
  }

  get isDirty() {
    return this.dirtySheets.size > 0;
  }

  /** Serialize back to .xlsx bytes, reusing every untouched part verbatim. */
  async toBytes() {
    // Fold the patched XML back into `files` so a second save builds on the
    // first rather than resurrecting the original bytes for this sheet.
    for (const path of this.dirtySheets) {
      this.files.set(path, serializeXml(this.sheetDocs.get(path)));
    }
    // A stale calcChain after replacing a formula makes Excel offer to "repair"
    // the file. Dropping it is safe: Excel rebuilds it on next open.
    if (this.formulaTouched) this.files.delete('xl/calcChain.xml');
    return zip(this.files);
  }

  markClean() {
    this.dirtySheets.clear();
    this.formulaTouched = false;
  }
}
