export type Workplace = 'remote' | 'hybrid' | 'onsite';

export const WORKPLACES: readonly Workplace[] = ['remote', 'hybrid', 'onsite'];

export function isWorkplace(value: string): value is Workplace {
  return WORKPLACES.some((workplace) => workplace === value);
}
