export interface User {
	id: string;
	name: string;
	email: string;
	role: "admin" | "user";
	createdAt: string;
}

export interface Order {
	id: string;
	userId: string;
	productIds: string[];
	total: number;
	status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
	createdAt: string;
}

export interface Product {
	id: string;
	name: string;
	description: string;
	price: number;
	stock: number;
	tags: string[];
}

export interface PaginatedResponse<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
	hasMore: boolean;
}
