import type { PaginatedResponse } from "./types.js";

export function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResponse<T> {
	const start = (page - 1) * pageSize;
	const sliced = items.slice(start, start + pageSize);
	return {
		items: sliced,
		total: items.length,
		page,
		pageSize,
		hasMore: start + pageSize < items.length,
	};
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
	const result = { ...obj };
	for (const key of keys) {
		delete result[key];
	}
	return result as Omit<T, K>;
}
