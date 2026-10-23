import { Period } from '../admin-m12/vietnam-time';
import { Cell, Sheet, buildCsv, buildXlsx } from './report-format';
import { Report } from './report-builder';

/** What the file says about itself: the time it was made, the filter, the moment each figure is counted at. A reader of a file years later can tell exactly what it holds. */
function info(report: Report, period: Period, basis: string, madeAt: string, rowCount: number): Cell[][] {
  return [
    ['Báo cáo', report.title],
    ['Kỳ (giờ Việt Nam)', period.fromDay === period.toDay ? period.fromDay : `${period.fromDay} đến ${period.toDay}`],
    ['Mốc thời gian', report.basisLabel],
    ['Bộ lọc', `range=${period.range}; basis=${basis}`],
    ['Xuất lúc (giờ Việt Nam)', madeAt],
    ['Số dòng', rowCount],
    ...report.notes.map((note): Cell[] => ['Ghi chú', note]),
  ];
}

const summaryRows = (report: Report): Cell[][] => [['Chỉ số', 'Giá trị', 'Ghi chú'], ...report.summary.map((item): Cell[] => [item.label, item.value, item.note ?? (item.value === null ? 'Không có số liệu' : null)])];
const tableRows = (report: Report): Cell[][] => [report.columns.map((column): Cell => column.label), ...report.rows.map((row): Cell[] => [...row.cells])];

export function renderExport(format: 'csv' | 'xlsx', report: Report, period: Period, basis: string, madeAt: string): Buffer {
  const table = tableRows(report);
  const meta = info(report, period, basis, madeAt, report.rows.length);
  if (format === 'csv') {
    return buildCsv([...meta, [], ['Tổng hợp'], ...summaryRows(report), [], ['Chi tiết'], ...table]);
  }
  const sheets: Sheet[] = [
    { name: 'Chi tiết', rows: table },
    { name: 'Tổng hợp', rows: summaryRows(report) },
    { name: 'Thông tin', rows: meta },
  ];
  return buildXlsx(sheets);
}
