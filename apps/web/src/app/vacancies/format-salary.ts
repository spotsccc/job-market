import type { SalaryPeriod } from './filters.ts';
import { SALARY_PERIOD_LABELS, SALARY_TAX_LABELS } from './labels.ts';

export type Salary = {
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly salaryCurrency: string | null;
  readonly salaryPeriod: SalaryPeriod | null;
  readonly salaryRaw: string | null;
  readonly salaryGross: boolean | null;
};

function numberFormat(currency: string | null): Intl.NumberFormat {
  if (currency !== null) {
    try {
      return new Intl.NumberFormat('ru', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 0,
      });
    } catch {
      // Не код валюты — сумма без валюты.
    }
  }
  return new Intl.NumberFormat('ru', { maximumFractionDigits: 0 });
}

/**
 * Зарплата для карточки: вилка из чисел — «80 000–95 000 € в год, до налогов»; чисел нет —
 * как в тексте; зарплаты нет — `null`.
 */
export function formatSalary(salary: Salary): string | null {
  const { salaryMin: min, salaryMax: max } = salary;
  if (min === null && max === null) return salary.salaryRaw;
  const format = numberFormat(salary.salaryCurrency);
  // Равные границы formatRange пишет «≈80 000 €»: это одна сумма, а не примерно.
  const amount =
    min !== null && max !== null
      ? min === max
        ? format.format(min)
        : format.formatRange(min, max)
      : min === null
        ? `до ${format.format(max ?? 0)}`
        : `от ${format.format(min)}`;
  const period =
    salary.salaryPeriod === null ? '' : ` ${SALARY_PERIOD_LABELS[salary.salaryPeriod]}`;
  const tax =
    salary.salaryGross === null
      ? ''
      : `, ${SALARY_TAX_LABELS[salary.salaryGross ? 'gross' : 'net']}`;
  return `${amount}${period}${tax}`;
}
