import type { Occupation } from '@job-market/db';

/** Узел дерева для выбора профессии: `TreeNodeData` Mantine без React-типов. */
export type OccupationNode = {
  readonly value: string;
  readonly label: string;
  readonly children?: readonly OccupationNode[];
};

const ROOT = 'root';

/** Дерево профессий в памяти: узлов десятки, его читают целиком. */
export type OccupationTree = {
  /** Путь узла от домена: «IT › Разработка › Frontend»; у `root` — «Без профессии». */
  readonly path: (id: string) => string | null;
  /**
   * Узлы фильтра: выбранные и все их потомки. `root` — только сам `root`: его поддерево —
   * всё дерево. Неизвестные id отбрасываются.
   */
  readonly expand: (ids: readonly string[]) => string[];
  /** Дерево для выбора без `root` и архивных узлов; «Без профессии» — отдельный лист в конце. */
  readonly nodes: readonly OccupationNode[];
};

type Index = {
  readonly byId: ReadonlyMap<string, Occupation>;
  readonly children: ReadonlyMap<string, readonly Occupation[]>;
};

function indexTree(occupations: readonly Occupation[]): Index {
  const children = new Map<string, Occupation[]>();
  for (const occupation of occupations) {
    if (occupation.parentId === null) continue;
    const siblings = children.get(occupation.parentId) ?? [];
    siblings.push(occupation);
    children.set(occupation.parentId, siblings);
  }
  return { byId: new Map(occupations.map((occupation) => [occupation.id, occupation])), children };
}

function pathOf({ byId }: Index, id: string): string | null {
  const names: string[] = [];
  let current = byId.get(id);
  if (current === undefined) return null;
  if (current.id === ROOT) return current.name;
  // Предел глубины — защита от цикла в данных: дерево неглубокое.
  for (let depth = 0; current !== undefined && current.id !== ROOT && depth < 32; depth += 1) {
    names.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names.join(' › ');
}

function expandIds({ byId, children }: Index, ids: readonly string[]): string[] {
  const result = new Set<string>();
  const queue = ids.filter((id) => byId.has(id));
  for (const id of queue) {
    if (result.has(id)) continue;
    result.add(id);
    if (id === ROOT) continue;
    for (const child of children.get(id) ?? []) queue.push(child.id);
  }
  return [...result];
}

function nodesOf(index: Index, parentId: string): OccupationNode[] {
  return (index.children.get(parentId) ?? [])
    .filter((occupation) => occupation.archivedAt === null)
    .toSorted((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((occupation) => {
      const nested = nodesOf(index, occupation.id);
      return nested.length === 0
        ? { value: occupation.id, label: occupation.name }
        : { value: occupation.id, label: occupation.name, children: nested };
    });
}

export function buildOccupationTree(occupations: readonly Occupation[]): OccupationTree {
  const index = indexTree(occupations);
  const root = index.byId.get(ROOT);
  return {
    path: (id) => pathOf(index, id),
    expand: (ids) => expandIds(index, ids),
    nodes: [
      ...nodesOf(index, ROOT),
      ...(root === undefined ? [] : [{ value: ROOT, label: root.name }]),
    ],
  };
}
