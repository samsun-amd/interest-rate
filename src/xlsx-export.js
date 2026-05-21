const encoder = new TextEncoder();
const chartPalette = ["2563EB", "10B981", "F59E0B", "EF4444", "64748B", "7C3AED"];

export function downloadWorkbook({ fileName, sheets }) {
  const blob = createWorkbookBlob({ sheets });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${fileName}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createWorkbookBlob({ sheets }) {
  const files = buildWorkbookFiles(sheets);
  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function buildWorkbookFiles(inputSheets) {
  const sheets = prepareSheets(inputSheets);
  const sheetLookup = buildSheetLookup(sheets);
  const files = [];
  const worksheetOverrides = [];
  const drawingOverrides = [];
  const chartOverrides = [];
  const workbookRels = [];
  const workbookSheets = [];
  let drawingIndex = 0;
  let chartIndex = 0;

  sheets.forEach((sheet, index) => {
    const sheetIndex = index + 1;
    const sheetPath = `xl/worksheets/sheet${sheetIndex}.xml`;
    let chartEntries = prepareSheetCharts(sheet, sheetLookup);
    const hasChart = chartEntries.length > 0;
    let drawingPath = null;

    if (hasChart) {
      drawingIndex += 1;
      drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
      chartEntries = chartEntries.map((chart, localIndex) => {
        chartIndex += 1;
        return {
          chart,
          chartIndex,
          relId: `rId${localIndex + 1}`
        };
      });
    }

    files.push({ path: sheetPath, content: worksheetXml(sheet, hasChart ? drawingIndex : null) });
    worksheetOverrides.push(`<Override PartName="/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);

    if (hasChart) {
      files.push({ path: `xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`, content: worksheetRelsXml(drawingIndex) });
      files.push({ path: drawingPath, content: drawingXml(chartEntries) });
      files.push({ path: `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`, content: drawingRelsXml(chartEntries) });
      drawingOverrides.push(`<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      chartEntries.forEach(({ chart, chartIndex: entryChartIndex }) => {
        const chartPath = `xl/charts/chart${entryChartIndex}.xml`;
        files.push({ path: chartPath, content: chartXml(chart) });
        chartOverrides.push(`<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      });
    }

    workbookRels.push(`<Relationship Id="rId${sheetIndex}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetIndex}.xml"/>`);
    workbookSheets.push(`<sheet name="${escapeXml(sheet.name).slice(0, 31)}" sheetId="${sheetIndex}" r:id="rId${sheetIndex}"/>`);
  });

  files.push({ path: "[Content_Types].xml", content: contentTypesXml([...worksheetOverrides, ...drawingOverrides, ...chartOverrides]) });
  files.push({ path: "_rels/.rels", content: rootRelsXml() });
  files.push({ path: "xl/workbook.xml", content: workbookXml(workbookSheets) });
  files.push({ path: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(workbookRels) });
  files.push({ path: "xl/styles.xml", content: stylesXml() });
  files.push({ path: "docProps/core.xml", content: coreXml() });
  files.push({ path: "docProps/app.xml", content: appXml(sheets.length) });

  return files;
}

function prepareSheets(inputSheets) {
  const usedNames = new Set();
  return inputSheets.map((sheet, index) => {
    const originalName = sheet.name;
    const name = uniqueSheetName(safeSheetName(originalName, index + 1), usedNames, index + 1);
    return {
      ...sheet,
      originalName,
      name,
      rows: Array.isArray(sheet.rows) ? sheet.rows : []
    };
  });
}

function buildSheetLookup(sheets) {
  const byName = new Map();
  const aliases = new Map();
  sheets.forEach((sheet) => {
    byName.set(sheet.name, sheet);
    aliases.set(sheet.name, sheet.name);
    if (sheet.originalName !== undefined && sheet.originalName !== null) {
      aliases.set(String(sheet.originalName), sheet.name);
    }
  });
  return { byName, aliases };
}

function prepareSheetCharts(sheet, sheetLookup) {
  const charts = Array.isArray(sheet.charts) ? sheet.charts : sheet.chart ? [sheet.chart] : [];
  return charts
    .map((chart) => prepareChart(chart, sheet, sheetLookup))
    .filter(Boolean);
}

function prepareChart(chart, fallbackSheet, sheetLookup) {
  if (!chart || !Array.isArray(chart.series) || chart.series.length === 0) {
    return null;
  }

  const requestedSource = chart.sourceSheetName || chart.sourceSheet || fallbackSheet.name;
  const sourceSheetName = sheetLookup.aliases.get(String(requestedSource)) || fallbackSheet.name;
  const sourceSheet = sheetLookup.byName.get(sourceSheetName);
  if (!sourceSheet) {
    return null;
  }

  const firstDataRow = normalizePositiveInteger(chart.firstDataRow, 2);
  const lastDataRow = Math.min(
    normalizePositiveInteger(chart.lastDataRow, sourceSheet.rows.length),
    sourceSheet.rows.length
  );
  if (lastDataRow < firstDataRow) {
    return null;
  }

  const pointCount = lastDataRow - firstDataRow + 1;
  return {
    ...chart,
    sourceSheetName,
    firstDataRow,
    lastDataRow,
    categoryLabelInterval: normalizePositiveInteger(
      chart.categoryLabelInterval,
      categoryLabelInterval(pointCount)
    )
  };
}

function worksheetXml(sheet, drawingIndex) {
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => cellXml(rowIndex + 1, columnIndex + 1, value)).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const drawing = drawingIndex ? `<drawing r:id="rId1"/>` : "";

  return xmlDecl(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows}</sheetData>${drawing}</worksheet>`);
}

function cellXml(row, column, rawValue) {
  const ref = `${columnName(column)}${row}`;
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return `<c r="${ref}"><v>${rawValue}</v></c>`;
  }
  if (rawValue instanceof Date) {
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(rawValue.toISOString().slice(0, 10))}</t></is></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(rawValue ?? "")}</t></is></c>`;
}

function worksheetRelsXml(drawingIndex) {
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIndex}.xml"/></Relationships>`);
}

function drawingXml(chartEntries) {
  const anchors = chartEntries.map((entry, index) => chartAnchorXml(entry, index)).join("");
  return xmlDecl(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);
}

function chartAnchorXml({ chart, chartIndex, relId }, index) {
  const anchor = chart.anchor || defaultChartAnchor(index);
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartIndex + 1}" name="${escapeXml(chart.title || `Chart ${chartIndex}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

function defaultChartAnchor(index) {
  const fromRow = 1 + index * 22;
  return {
    fromCol: 0,
    fromRow,
    toCol: 14,
    toRow: fromRow + 19
  };
}

function drawingRelsXml(chartEntries) {
  const relationships = chartEntries.map(({ chartIndex, relId }) => `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartIndex}.xml"/>`).join("");
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
}

function chartXml(chart) {
  const firstDataRow = chart.firstDataRow || 2;
  const lastDataRow = chart.lastDataRow;
  const categoryAxisId = chart.categoryAxisId || 123456;
  const valueAxisId = chart.valueAxisId || 654321;
  const categories = rangeRef(chart.sourceSheetName, chart.categoriesColumn, firstDataRow, lastDataRow);
  const seriesXml = chart.series.map((series, index) => {
    const values = rangeRef(chart.sourceSheetName, series.valuesColumn, firstDataRow, lastDataRow);
    const color = normalizeHexColor(series.color || chartPalette[index % chartPalette.length]);
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${escapeXml(series.name)}</c:v></c:tx><c:spPr>${lineShapeXml(color)}</c:spPr><c:marker><c:symbol val="${series.marker || "none"}"/></c:marker><c:cat><c:strRef><c:f>${escapeXml(categories)}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${escapeXml(values)}</c:f></c:numRef></c:val><c:smooth val="${series.smooth === false ? 0 : 1}"/></c:ser>`;
  }).join("");
  const categoryLabelIntervalXml = chart.categoryLabelInterval > 1
    ? `<c:tickLblSkip val="${chart.categoryLabelInterval}"/><c:tickMarkSkip val="${chart.categoryLabelInterval}"/>`
    : "";

  return xmlDecl(`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="zh-TW"/><c:roundedCorners val="0"/><c:style val="13"/><c:chart><c:title>${chartTitleXml(chart.title)}</c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${seriesXml}<c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:lineChart><c:catAx><c:axId val="${categoryAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${axisTitleXml(chart.xAxisTitle)}<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisShapeXml()}<c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${categoryLabelIntervalXml}</c:catAx><c:valAx><c:axId val="${valueAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines>${gridlineShapeXml()}</c:majorGridlines>${axisTitleXml(chart.yAxisTitle)}<c:numFmt formatCode="${escapeXml(chart.yAxisFormat || "#,##0")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisShapeXml()}<c:crossAx val="${categoryAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr>${textPropertiesXml(900, "475569")}</c:txPr></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:txPr>${textPropertiesXml(900, "475569")}</c:txPr></c:chartSpace>`);
}

function chartTitleXml(title) {
  return `<c:tx><c:rich>${richTextXml(title || "", 1400, "0F172A", true)}</c:rich></c:tx><c:layout/><c:overlay val="0"/>`;
}

function axisTitleXml(title) {
  if (!title) {
    return "";
  }
  return `<c:title><c:tx><c:rich>${richTextXml(title, 900, "475569", false)}</c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>`;
}

function axisShapeXml() {
  return `<c:spPr>${lineShapeXml("CBD5E1", 9525)}</c:spPr><c:txPr>${textPropertiesXml(900, "475569")}</c:txPr>`;
}

function gridlineShapeXml() {
  return `<c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr>`;
}

function lineShapeXml(color, width = 28575) {
  return `<a:ln w="${width}" cap="rnd"><a:solidFill><a:srgbClr val="${normalizeHexColor(color)}"/></a:solidFill><a:round/><a:headEnd type="none"/><a:tailEnd type="none"/></a:ln>`;
}

function richTextXml(text, size, color, bold) {
  const boldAttr = bold ? ` b="1"` : "";
  return `<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"${boldAttr}><a:solidFill><a:srgbClr val="${normalizeHexColor(color)}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Microsoft JhengHei"/></a:defRPr></a:pPr><a:r><a:rPr lang="zh-TW" sz="${size}"${boldAttr}><a:solidFill><a:srgbClr val="${normalizeHexColor(color)}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Microsoft JhengHei"/></a:rPr><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function textPropertiesXml(size, color) {
  return `<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${normalizeHexColor(color)}"/></a:solidFill><a:latin typeface="Aptos"/><a:ea typeface="Microsoft JhengHei"/></a:defRPr></a:pPr></a:p>`;
}

function normalizeHexColor(color) {
  const value = String(color || "").replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(value) ? value : "2563EB";
}

function contentTypesXml(overrides) {
  return xmlDecl(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides.join("")}</Types>`);
}

function rootRelsXml() {
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
}

function workbookXml(sheets) {
  return xmlDecl(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.join("")}</sheets></workbook>`);
}

function workbookRelsXml(relationships) {
  const styleId = relationships.length + 1;
  return xmlDecl(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
}

function stylesXml() {
  return xmlDecl(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
}

function coreXml() {
  const now = new Date().toISOString();
  return xmlDecl(`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>interest-rate</dc:creator><cp:lastModifiedBy>interest-rate</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
}

function appXml(sheetCount) {
  return xmlDecl(`<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>interest-rate</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetCount}</vt:i4></vt:variant></vt:vector></HeadingPairs></Properties>`);
}

function createZip(files) {
  const entries = [];
  let offset = 0;
  const localParts = [];

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);
    entries.push({ file, nameBytes, crc, size: data.length, offset });
    offset += localHeader.length + data.length;
  });

  const centralParts = [];
  let centralSize = 0;
  entries.forEach((entry) => {
    const header = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint32(42, entry.offset, true);
    header.set(entry.nameBytes, 46);
    centralParts.push(header);
    centralSize += header.length;
  });

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatUint8Arrays([...localParts, ...centralParts, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[index]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function concatUint8Arrays(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function columnName(index) {
  let value = index;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function rangeRef(sheetName, column, firstRow, lastRow) {
  const safeName = sheetName.replace(/'/g, "''");
  const col = columnName(column);
  return `'${safeName}'!$${col}$${firstRow}:$${col}$${lastRow}`;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }
  return Math.floor(number);
}

function categoryLabelInterval(pointCount) {
  if (pointCount <= 12) {
    return 1;
  }
  return Math.ceil(pointCount / 10);
}

function uniqueSheetName(name, usedNames, index) {
  const baseName = name || `Sheet${index}`;
  let candidate = baseName;
  let suffix = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffixText = ` ${suffix}`;
    candidate = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function safeSheetName(name, index) {
  const safe = String(name || `Sheet${index}`)
    .replace(/[\[\]:*?/\\]/g, " ")
    .trim()
    .slice(0, 31);
  return safe || `Sheet${index}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlDecl(xml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`;
}
