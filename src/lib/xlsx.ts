/**
 * Minimal .xlsx writer: inline strings, numbers and live formulas, a few cell styles, column widths.
 * Files are stored uncompressed in the ZIP, which every spreadsheet app accepts. Formulas carry no
 * cached values; the workbook asks the app to calculate everything when it opens.
 */

export type CellStyle = "default" | "header" | "title" | "note" | "money" | "total" | "input" | "inputText" | "rate" | "inputRate";

export type CellValue = string | number | null | undefined | { f: string; style?: CellStyle } | { v: string | number; style?: CellStyle };

export type Sheet = { name: string; widths?: number[]; rows: CellValue[][] };

// Order matches <cellXfs> in styles(); the index is the `s` attribute.
const STYLE_INDEX: Record<CellStyle, number> = { default: 0, header: 1, title: 2, note: 3, money: 4, total: 5, input: 6, inputText: 7, rate: 8, inputRate: 9 };

export function colName(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A1-style reference; `row` is 1-based, `col` 0-based. */
export const ref = (col: number, row: number, absolute = false) => (absolute ? `$${colName(col)}$${row}` : `${colName(col)}${row}`);

/** Quoted sheet-qualified reference, e.g. 'Monthly TDS'!B12. */
export const sheetRef = (sheet: string, col: number, row: number) => `'${sheet.replace(/'/g, "''")}'!${ref(col, row, true)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cellXml(value: CellValue, col: number, row: number) {
  if (value === null || value === undefined || value === "") return "";
  const r = ref(col, row);
  if (typeof value === "string") return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  if (typeof value === "number") return `<c r="${r}" s="${STYLE_INDEX.money}"><v>${value}</v></c>`;
  const s = STYLE_INDEX[value.style ?? "default"];
  if ("f" in value) return `<c r="${r}" s="${s}"><f>${esc(value.f)}</f></c>`;
  if (typeof value.v === "number") return `<c r="${r}" s="${s}"><v>${value.v}</v></c>`;
  return `<c r="${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(value.v)}</t></is></c>`;
}

function sheetXml(sheet: Sheet, selected: boolean) {
  const cols = sheet.widths?.length ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rows = sheet.rows
    .map((cells, i) => {
      const xml = cells.map((c, j) => cellXml(c, j, i + 1)).join("");
      return xml ? `<row r="${i + 1}">${xml}</row>` : "";
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}/></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

function stylesXml() {
  // Fonts: 0 normal, 1 bold, 2 bold large, 3 italic grey. Fills: 0/1 required, 2 input yellow, 3 header grey.
  const xf = (font: number, fill: number, numFmt: number, wrap = false) =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ""}${font ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${wrap ? ' applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' : "/>"}`;
  const xfs = [xf(0, 0, 0), xf(1, 3, 0), xf(2, 0, 0), xf(3, 0, 0), xf(0, 0, 3), xf(1, 0, 3), xf(0, 2, 3), xf(0, 2, 0), xf(0, 0, 164), xf(0, 2, 164)];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.##"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2B3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE7DD"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

/** Builds the workbook. `active` is the index of the sheet that opens first. */
export function buildXlsx(sheets: Sheet[], active = 0): Uint8Array<ArrayBuffer> {
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${active}"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ],
    ["xl/styles.xml", stylesXml()],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i === active)])
  ];
  return zipStored(files.map(([name, text]) => [name, new TextEncoder().encode(text)]));
}

// ---------- ZIP (stored, no compression) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(entries: [string, Uint8Array][]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fixed timestamp (1 Jan 2026, 00:00) keeps output deterministic.
  const time = 0;
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
