import type { Occupation } from '@job-market/db';

/**
 * Дерево профессий для экстрактора: перечисление схемы ответа и строки промпта. Дерево
 * приходит от вызывающего — набор берёт снимок из файла, перенос читает базу, — поэтому
 * экстрактор не знает, откуда оно.
 */
export type OccupationNode = Readonly<
  Pick<Occupation, 'id' | 'parentId' | 'name' | 'description'>
> & {
  /** Узел архивирован (`archived_at` не NULL): он и всё под ним не предлагаются модели. */
  readonly archived?: boolean;
};

const ROOT = 'root';
const PATH_SEPARATOR = ' › ';

/**
 * Действующие узлы от корня вглубь: дети узла — по id. Архивный узел и всё под ним в дерево
 * не попадают. Порядок не зависит от порядка строк: одно дерево — одна схема ответа (E4).
 */
function activeInPathOrder(tree: readonly OccupationNode[]): readonly OccupationNode[] {
  const children = new Map<string | null, OccupationNode[]>();
  for (const node of tree) {
    if (node.archived === true) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const visit = (node: OccupationNode): readonly OccupationNode[] => [
    node,
    ...(children.get(node.id) ?? [])
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .flatMap((child) => visit(child)),
  ];
  const root = (children.get(null) ?? []).find((node) => node.id === ROOT);
  return root === undefined ? [] : visit(root);
}

/** Id действующих узлов в порядке пути дерева — значения `z.enum` профессии (П19, E4). */
export function occupationEnum(tree: readonly OccupationNode[]): readonly string[] {
  return activeInPathOrder(tree).map((node) => node.id);
}

/** Предки узла от родителя к корню: `frontend` → `engineering`, `it`, `root`. */
export function ancestors(tree: readonly OccupationNode[], id: string): readonly string[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const result: string[] = [];
  let parent = byId.get(id)?.parentId ?? null;
  while (parent !== null && !result.includes(parent)) {
    result.push(parent);
    parent = byId.get(parent)?.parentId ?? null;
  }
  return result;
}

/** Узел — лист: у него нет действующих детей. */
export function isLeaf(tree: readonly OccupationNode[], id: string): boolean {
  return !activeInPathOrder(tree).some((node) => node.parentId === id);
}

/**
 * Дерево для промпта: строка на действующий узел — путь от корня без `root` и определение:
 * «it › engineering › frontend — Интерфейсы в браузере…». У корня путь — `root`.
 */
export function occupationsPrompt(tree: readonly OccupationNode[]): string {
  return activeInPathOrder(tree)
    .map((node) => {
      const path = [...ancestors(tree, node.id).toReversed(), node.id].filter((id) => id !== ROOT);
      return `${path.length === 0 ? ROOT : path.join(PATH_SEPARATOR)} — ${node.description}`;
    })
    .join('\n');
}
