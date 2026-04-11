export class DomainError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly statusCode = 500,
	) {
		super(message);
		this.name = "DomainError";
	}
}

export class NotFoundError extends DomainError {
	constructor(resource: string, id: string) {
		super("NOT_FOUND", `${resource} with id "${id}" not found`, 404);
	}
}

export class ValidationError extends DomainError {
	constructor(message: string) {
		super("VALIDATION_ERROR", message, 400);
	}
}

export class UnauthorizedError extends DomainError {
	constructor(message = "Unauthorized") {
		super("UNAUTHORIZED", message, 401);
	}
}
