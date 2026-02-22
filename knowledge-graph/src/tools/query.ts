import { Retriever } from '../engine/retriever.js';
import { QueryResult, QueryFilters, StepEmitter } from '../types.js';

export async function handleQuery(
  retriever: Retriever,
  query: string,
  filters?: QueryFilters,
  onStep?: StepEmitter,
): Promise<QueryResult> {
  return retriever.search(query, filters, onStep);
}
