import {
  Badge,
  Table,
  TableScrollContainer,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
} from '@mantine/core';
import type { ReactNode } from 'react';

import type { AliasItem } from './geo-data.ts';

/** Названия места из `geo_aliases`: по ним работают разбор и автодополнение. */
export function AliasesTable({ aliases }: Readonly<{ aliases: readonly AliasItem[] }>): ReactNode {
  if (aliases.length === 0) return <Text c="dimmed">Названий нет</Text>;
  return (
    <TableScrollContainer minWidth={500}>
      <Table striped withTableBorder>
        <TableThead>
          <TableTr>
            <TableTh>Название</TableTh>
            <TableTh>Нормализованное (П9)</TableTh>
            <TableTh>Язык</TableTh>
            <TableTh>Источник</TableTh>
          </TableTr>
        </TableThead>
        <TableTbody>
          {aliases.map((alias) => (
            <TableTr key={alias.id}>
              <TableTd>{alias.alias}</TableTd>
              <TableTd>
                <Text ff="monospace" size="sm">
                  {alias.normalized}
                </Text>
              </TableTd>
              <TableTd>{alias.lang ?? <Text c="dimmed">—</Text>}</TableTd>
              <TableTd>
                <Badge variant="light" color={alias.source === 'manual' ? 'grape' : 'teal'}>
                  {alias.source}
                </Badge>
              </TableTd>
            </TableTr>
          ))}
        </TableTbody>
      </Table>
    </TableScrollContainer>
  );
}
