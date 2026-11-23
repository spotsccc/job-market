import { GeonamesParseError } from '../errors/index.ts';

/** Положение строки в дампе: для текста ошибки. */
export type RowPosition = { readonly file: string; readonly line: number };

/**
 * Делит строку дампа по табуляции. Другое число столбцов значит, что GeoNames поменял
 * формат: строку нельзя ни пропустить, ни прочитать наугад.
 */
export function splitRow(
  text: string,
  columns: number,
  position: RowPosition,
): GeonamesParseError | string[] {
  const cells = text.split('\t');
  if (cells.length !== columns) {
    return new GeonamesParseError({
      ...position,
      problem: `expected ${String(columns)} columns, got ${String(cells.length)}`,
    });
  }
  return cells;
}

/** Ячейка по номеру; после `splitRow` номер всегда в пределах строки. */
export function cell(cells: readonly string[], index: number): string {
  return cells[index] ?? '';
}

export function parseInteger(
  value: string,
  column: string,
  position: RowPosition,
): GeonamesParseError | number {
  if (!/^-?\d+$/u.test(value)) {
    return new GeonamesParseError({
      ...position,
      problem: `${column} is not an integer: ${value}`,
    });
  }
  return Number(value);
}

export function parseCoordinate(
  value: string,
  column: string,
  position: RowPosition,
): GeonamesParseError | number {
  const number = Number(value);
  if (value === '' || !Number.isFinite(number)) {
    return new GeonamesParseError({ ...position, problem: `${column} is not a number: ${value}` });
  }
  return number;
}
