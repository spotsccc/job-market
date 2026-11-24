/**
 * Домен компаний: справочник работодателей вакансий и ключи, по которым вакансию относят к
 * компании. Связи компаний с вакансиями лежат в домене вакансий.
 */
export { COMPANY_KEY_KINDS, companies, companyKeys } from './company.ts';
export type { CompanyKeyKind, CompanyKeyRow, CompanyRow, NewCompanyRow } from './company.ts';
export { keyOfUrl, keysOf, normalizeName, NOT_COMPANY_HOSTS } from './company-keys.ts';
export type { CompanyKey } from './company-keys.ts';
export { lockKeys, matchCompany } from './match-company.ts';
export type { CompanyInput } from './match-company.ts';
